import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// ---------------------------------------------------------------------------
// Rate limiting — in-memory, per-IP, tiered by endpoint sensitivity
// ---------------------------------------------------------------------------
interface RateBucket { count: number; resetAt: number }
const rateBuckets = new Map<string, RateBucket>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  rateBuckets.forEach((bucket, key) => {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  });
}, 5 * 60_000);

function rateLimit(
  windowMs: number,
  maxRequests: number,
  keyPrefix: string,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
        retryAfter,
      });
    }

    bucket.count++;
    next();
  };
}

// General API: 100 requests per minute per IP
app.use("/api", rateLimit(60_000, 100, "api"));

// Stricter limits on expensive/sensitive endpoints
// AI chat: 10 requests per minute (when re-enabled)
app.use("/api/chat", rateLimit(60_000, 10, "chat"));
// Exports: 10 per minute (reinforces existing per-route limiter)
app.use("/api/export", rateLimit(60_000, 10, "export"));
// Search: 30 per minute
app.use("/api/search", rateLimit(60_000, 30, "search"));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      import("./seed")
        .then(({ seedDatabase }) =>
          Promise.race([
            seedDatabase(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Seed timeout after 30s")), 30_000),
            ),
          ]),
        )
        .then(() => log("Database seeding complete"))
        .catch((err) => log(`Database seeding skipped: ${err.message}`));
    },
  );
})();
