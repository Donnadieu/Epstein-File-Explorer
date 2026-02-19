import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { runMigrations } from "./migrate";
import { startBackgroundWorker } from "./background-worker";
import { isTypesenseConfigured, getTypesenseClient } from "./typesense";

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
  await registerRoutes(httpServer, app);

  const { setupWebSocket } = await import("./ws");
  setupWebSocket(httpServer);

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

  if (isTypesenseConfigured()) {
    try {
      const health = await getTypesenseClient()!.health.retrieve();
      log(`Typesense: ${health.ok ? "healthy" : "unhealthy"}`);
    } catch (err: any) {
      log(`Typesense unavailable: ${err.message} — using PostgreSQL fallback`);
    }
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
