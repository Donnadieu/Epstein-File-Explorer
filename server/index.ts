import { config as loadEnv } from "dotenv";
import express, { type Request, Response, NextFunction } from "express";
import fileUpload from "express-fileupload";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { runMigrations } from "./migrate";
import { startBackgroundWorker } from "./background-worker";
import pytoolsBridge from "./python-tools.js";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

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

app.use(fileUpload({
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  tempDir: '/tmp/epstein-uploads',
}));

// ---------------------------------------------------------------------------
// Rate limiting
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

// Rate limits — per-IP, tiered by endpoint cost
app.use("/api/chat", rateLimit(60_000, 20, "chat"));
app.use("/api/export", rateLimit(60_000, 10, "export"));
app.use("/api", rateLimit(60_000, 200, "api"));
app.use("/api/documents/:id/pdf", rateLimit(60_000, 60, "media"));
app.use("/api/documents/:id/image", rateLimit(60_000, 60, "media"));
app.use("/api/documents/:id/video", rateLimit(60_000, 60, "media"));
app.use("/api/documents/:id/content-url", rateLimit(60_000, 60, "media"));
app.use("/api/search", rateLimit(60_000, 60, "search"));

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
        const snippet = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${snippet.length > 200 ? snippet.slice(0, 200) + '…' : snippet}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Check Python tools availability
  const pythonToolsStatus = pytoolsBridge.verifyPythonToolsSetup();
  if (!pythonToolsStatus.ready) {
    log("⚠ Python tools not fully ready:", "python-tools");
    pythonToolsStatus.errors.forEach((err) =>
      log(`  - ${err}`, "python-tools")
    );
    if (process.env.NODE_ENV === "production") {
      log(
        "ERROR: Python tools required in production. Exiting.",
        "python-tools"
      );
      process.exit(1);
    }
  } else {
    log("✓ Python tools initialized", "python-tools");
  }

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

  try {
    log("Running database migrations...");
    await runMigrations(pool);
    log("Database migrations complete");
  } catch (err: any) {
    log(`Database migration warning: ${err.message}`);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "::";
  httpServer.listen(
    {
      port,
      host,
      ipv6Only: false,
      reusePort: true,
    },
    () => {
      log(`serving on ${host}:${port}`);

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

      (async () => {
        try {
          log("Pre-warming caches...");
          await storage.getStats();
          await storage.getSidebarCounts();
          await storage.getDocumentFilters();
          await storage.getPersons();
          await storage.getTimelineEvents();
          await storage.getDocumentsFiltered({ page: 1, limit: 50 });
          log("Cache pre-warming complete");
        } catch (err: any) {
          log(`Cache pre-warming failed: ${err.message}`);
        }
      })();

      // startBackgroundWorker();
    },
  );
})();
