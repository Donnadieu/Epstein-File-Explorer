import { Router } from "express";
import { storage } from "../../../storage";
import { envelope, sendError } from "../types";

const router = Router();

router.get("/health", async (_req, res) => {
  try {
    const stats = await storage.getStats();
    res.json(envelope({
      status: "ok",
      timestamp: new Date().toISOString(),
      counts: {
        persons: stats.personCount,
        documents: stats.documentCount,
        pages: stats.pageCount,
        connections: stats.connectionCount,
        events: stats.eventCount,
      },
    }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Health check failed");
  }
});

router.get("/stats", async (_req, res) => {
  try {
    const stats = await storage.getStats();
    res.json(envelope({
      persons: stats.personCount,
      documents: stats.documentCount,
      pages: stats.pageCount,
      connections: stats.connectionCount,
      events: stats.eventCount,
    }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch stats");
  }
});

export default router;
