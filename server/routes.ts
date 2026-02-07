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

  app.get("/api/persons", async (req, res) => {
    try {
      const pageParam = req.query.page as string | undefined;
      const limitParam = req.query.limit as string | undefined;

      if (pageParam) {
        const page = Math.max(1, parseInt(pageParam) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(limitParam || "50") || 50));
        const result = await storage.getPersonsPaginated(page, limit);
        return res.json(result);
      }

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

  app.get("/api/documents", async (req, res) => {
    try {
      const pageParam = req.query.page as string | undefined;
      const limitParam = req.query.limit as string | undefined;

      if (pageParam) {
        const page = Math.max(1, parseInt(pageParam) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(limitParam || "50") || 50));
        const result = await storage.getDocumentsPaginated(page, limit);
        return res.json(result);
      }

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

  // Bookmark routes
  app.get("/api/bookmarks", async (_req, res) => {
    try {
      const bookmarks = await storage.getBookmarks();
      res.json(bookmarks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
  });

  app.post("/api/bookmarks", async (req, res) => {
    try {
      const { entityType, entityId, searchQuery, label, userId } = req.body;
      if (!entityType || !["person", "document", "search"].includes(entityType)) {
        return res.status(400).json({ error: "entityType must be 'person', 'document', or 'search'" });
      }
      const bookmark = await storage.createBookmark({
        entityType,
        entityId: entityId ?? null,
        searchQuery: searchQuery ?? null,
        label: label ?? null,
        userId: userId ?? "anonymous",
      });
      res.status(201).json(bookmark);
    } catch (error) {
      res.status(500).json({ error: "Failed to create bookmark" });
    }
  });

  app.delete("/api/bookmarks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const deleted = await storage.deleteBookmark(id);
      if (!deleted) {
        return res.status(404).json({ error: "Bookmark not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete bookmark" });
    }
  });

  // Data export routes
  app.get("/api/export/persons", async (req, res) => {
    try {
      const format = (req.query.format as string) || "json";
      const persons = await storage.getPersons();

      if (format === "csv") {
        const headers = ["id", "name", "role", "description", "status", "nationality", "occupation", "category", "documentCount", "connectionCount"];
        const csvRows = [headers.join(",")];
        for (const p of persons) {
          csvRows.push(headers.map(h => {
            const val = String((p as any)[h] ?? "");
            return val.includes(",") || val.includes('"') || val.includes("\n")
              ? `"${val.replace(/"/g, '""')}"` : val;
          }).join(","));
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=persons.csv");
        return res.send(csvRows.join("\n"));
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=persons.json");
      res.json(persons);
    } catch (error) {
      res.status(500).json({ error: "Failed to export persons" });
    }
  });

  app.get("/api/export/documents", async (req, res) => {
    try {
      const format = (req.query.format as string) || "json";
      const documents = await storage.getDocuments();

      if (format === "csv") {
        const headers = ["id", "title", "documentType", "dataSet", "datePublished", "dateOriginal", "pageCount", "isRedacted", "processingStatus", "aiAnalysisStatus"];
        const csvRows = [headers.join(",")];
        for (const d of documents) {
          csvRows.push(headers.map(h => {
            const val = String((d as any)[h] ?? "");
            return val.includes(",") || val.includes('"') || val.includes("\n")
              ? `"${val.replace(/"/g, '""')}"` : val;
          }).join(","));
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=documents.csv");
        return res.send(csvRows.join("\n"));
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=documents.json");
      res.json(documents);
    } catch (error) {
      res.status(500).json({ error: "Failed to export documents" });
    }
  });

  app.get("/api/export/search", async (req, res) => {
    try {
      const query = (req.query.q as string) || "";
      const format = (req.query.format as string) || "json";

      if (query.length < 2) {
        return res.status(400).json({ error: "Query must be at least 2 characters" });
      }

      const results = await storage.search(query);

      res.setHeader("Content-Type", format === "csv" ? "text/csv" : "application/json");
      res.setHeader("Content-Disposition", `attachment; filename=search-results.${format === "csv" ? "csv" : "json"}`);

      if (format === "csv") {
        const rows = ["type,id,name_or_title,description"];
        for (const p of results.persons) {
          const desc = (p.description || "").replace(/"/g, '""');
          rows.push(`person,${p.id},"${p.name.replace(/"/g, '""')}","${desc}"`);
        }
        for (const d of results.documents) {
          const desc = (d.description || "").replace(/"/g, '""');
          rows.push(`document,${d.id},"${d.title.replace(/"/g, '""')}","${desc}"`);
        }
        for (const e of results.events) {
          const desc = (e.description || "").replace(/"/g, '""');
          rows.push(`event,${e.id},"${e.title.replace(/"/g, '""')}","${desc}"`);
        }
        return res.send(rows.join("\n"));
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to export search results" });
    }
  });

  return httpServer;
}
