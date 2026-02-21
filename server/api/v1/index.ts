import { Router } from "express";
import { v1Cors } from "./middleware/cors";
import { generalLimiter, searchLimiter, exportLimiter, networkLimiter } from "./middleware/rate-limit";
import { envelopeMiddleware } from "./middleware/envelope";
import { v1ErrorHandler } from "./middleware/error-handler";

import statsRouter from "./routes/stats";
import personsRouter from "./routes/persons";
import documentsRouter from "./routes/documents";
import connectionsRouter from "./routes/connections";
import timelineRouter from "./routes/timeline";
import searchRouter from "./routes/search";
import networkRouter from "./routes/network";
import exportRouter from "./routes/export";
import aiAnalysesRouter from "./routes/ai-analyses";
import { serveApiDocs } from "./openapi/serve";

export function createV1Router(): Router {
  const router = Router();

  // Global middleware for all v1 routes
  router.use(v1Cors);
  router.use(generalLimiter);
  router.use(envelopeMiddleware);

  // Mount sub-routers
  router.use("/", statsRouter);
  router.use("/persons", personsRouter);
  router.use("/documents", documentsRouter);
  router.use("/connections", connectionsRouter);
  router.use("/timeline", timelineRouter);
  router.use("/search", searchLimiter, searchRouter);
  router.use("/network", networkLimiter, networkRouter);
  router.use("/export", exportLimiter, exportRouter);
  router.use("/ai-analyses", aiAnalysesRouter);

  // API documentation
  serveApiDocs(router);

  // Error handler (must be last)
  router.use(v1ErrorHandler);

  return router;
}
