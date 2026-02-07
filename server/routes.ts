import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.get("/api/persons", async (_req, res) => {
    try {
      const persons = await storage.getPersons();
      res.json(persons);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch persons" });
    }
  });

  app.get("/api/persons/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const person = await storage.getPersonWithDetails(id);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }
      res.json(person);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch person" });
    }
  });

  app.get("/api/documents", async (_req, res) => {
    try {
      const documents = await storage.getDocuments();
      res.json(documents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.get("/api/documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const doc = await storage.getDocumentWithDetails(id);
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json(doc);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch document" });
    }
  });

  app.get("/api/timeline", async (_req, res) => {
    try {
      const events = await storage.getTimelineEvents();
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch timeline events" });
    }
  });

  app.get("/api/network", async (_req, res) => {
    try {
      const data = await storage.getNetworkData();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch network data" });
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const query = (req.query.q as string) || "";
      if (query.length < 2) {
        return res.json({ persons: [], documents: [], events: [] });
      }
      const results = await storage.search(query);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to search" });
    }
  });

  app.get("/api/pipeline/jobs", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const jobs = await storage.getPipelineJobs(status);
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pipeline jobs" });
    }
  });

  app.get("/api/pipeline/stats", async (_req, res) => {
    try {
      const stats = await storage.getPipelineStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pipeline stats" });
    }
  });

  app.get("/api/budget", async (_req, res) => {
    try {
      const summary = await storage.getBudgetSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch budget summary" });
    }
  });

  return httpServer;
}
