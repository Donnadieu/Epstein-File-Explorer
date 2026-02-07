import type { Express, Response } from "express";
import { createServer, type Server } from "http";
import { Readable } from "stream";
import { insertBookmarkSchema } from "@shared/schema";
import { storage } from "./storage";

const ALLOWED_PDF_DOMAINS = [
  "www.justice.gov",
  "justice.gov",
  "www.courtlistener.com",
  "courtlistener.com",
  "storage.courtlistener.com",
  "www.uscourts.gov",
  "uscourts.gov",
  "archive.org",
  "ia800500.us.archive.org",
];

function isAllowedPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_PDF_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith("." + d)
    );
  } catch {
    return false;
  }
}

const exportRateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkExportRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = exportRateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    exportRateLimiter.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv<T extends Record<string, unknown>>(headers: string[], rows: T[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(String(row[h] ?? ""))).join(","));
  }
  return lines.join("\n");
}

function parsePaginationParams(query: Record<string, unknown>): { page: number; limit: number } | null {
  const pageParam = query.page as string | undefined;
  if (!pageParam) return null;
  const page = Math.max(1, parseInt(pageParam) || 1);
  const limit = Math.min(100, Math.max(1, parseInt((query.limit as string) || "50") || 50));
  return { page, limit };
}

function sendExport(res: Response, data: unknown, filename: string, format: string, csvFn?: () => string): void {
  if (format === "csv" && csvFn) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
    res.send(csvFn());
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`);
  res.json(data);
}

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

  /**
   * GET /api/persons
   * Without ?page: returns Person[] (full array)
   * With ?page=N&limit=M: returns { data: Person[], total, page, totalPages }
   */
  app.get("/api/persons", async (req, res) => {
    try {
      const pagination = parsePaginationParams(req.query);
      if (pagination) {
        return res.json(await storage.getPersonsPaginated(pagination.page, pagination.limit));
      }
      res.json(await storage.getPersons());
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

  /**
   * GET /api/documents
   * Without ?page: returns Document[] (full array)
   * With ?page=N&limit=M: returns { data: Document[], total, page, totalPages }
   */
  app.get("/api/documents", async (req, res) => {
    try {
      const pagination = parsePaginationParams(req.query);
      if (pagination) {
        return res.json(await storage.getDocumentsPaginated(pagination.page, pagination.limit));
      }
      res.json(await storage.getDocuments());
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

  // Proxy PDF content to avoid CORS issues with DOJ source URLs
  app.get("/api/documents/:id/pdf", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const doc = await storage.getDocumentWithDetails(id);
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
      if (!doc.sourceUrl) {
        return res.status(404).json({ error: "No source URL for this document" });
      }

      if (!isAllowedPdfUrl(doc.sourceUrl)) {
        return res.status(403).json({ error: "Source URL domain not allowed" });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const response = await fetch(doc.sourceUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          return res.status(502).json({ error: "Failed to fetch PDF from source" });
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
          return res.status(502).json({ error: "Source did not return a PDF" });
        }

        const contentLength = response.headers.get("content-length");
        const MAX_SIZE = 50 * 1024 * 1024; // 50MB
        if (contentLength && parseInt(contentLength) > MAX_SIZE) {
          return res.status(413).json({ error: "PDF exceeds maximum size limit" });
        }

        res.setHeader("Content-Type", "application/pdf");
        if (contentLength) {
          res.setHeader("Content-Length", contentLength);
        }
        res.setHeader("Cache-Control", "public, max-age=86400");

        if (response.body) {
          Readable.fromWeb(response.body as any).pipe(res);
        } else {
          const arrayBuffer = await response.arrayBuffer();
          res.send(Buffer.from(arrayBuffer));
        }
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") {
          return res.status(504).json({ error: "PDF fetch timed out" });
        }
        throw err;
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to proxy PDF" });
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
      const { entityType, entityId, searchQuery, label } = req.body;
      if (!entityType || !["person", "document", "search"].includes(entityType)) {
        return res.status(400).json({ error: "entityType must be 'person', 'document', or 'search'" });
      }

      const parsed = insertBookmarkSchema.parse({
        entityType,
        entityId: entityId ?? null,
        searchQuery: searchQuery ?? null,
        label: label ?? null,
        userId: "anonymous", // Never accept userId from client
      });

      const bookmark = await storage.createBookmark(parsed);
      res.status(201).json(bookmark);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid bookmark data", details: error.errors });
      }
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
  const personCsvHeaders = ["id", "name", "role", "description", "status", "nationality", "occupation", "category", "documentCount", "connectionCount"];
  const documentCsvHeaders = ["id", "title", "documentType", "dataSet", "datePublished", "dateOriginal", "pageCount", "isRedacted", "processingStatus", "aiAnalysisStatus"];

  app.get("/api/export/persons", async (req, res) => {
    if (!checkExportRateLimit(req.ip || "unknown")) {
      return res.status(429).json({ error: "Too many export requests. Try again in a minute." });
    }
    try {
      const format = (req.query.format as string) || "json";
      const persons = await storage.getPersons();
      sendExport(res, persons, "persons", format, () => toCsv(personCsvHeaders, persons as any[]));
    } catch (error) {
      res.status(500).json({ error: "Failed to export persons" });
    }
  });

  app.get("/api/export/documents", async (req, res) => {
    if (!checkExportRateLimit(req.ip || "unknown")) {
      return res.status(429).json({ error: "Too many export requests. Try again in a minute." });
    }
    try {
      const format = (req.query.format as string) || "json";
      const documents = await storage.getDocuments();
      sendExport(res, documents, "documents", format, () => toCsv(documentCsvHeaders, documents as any[]));
    } catch (error) {
      res.status(500).json({ error: "Failed to export documents" });
    }
  });

  app.get("/api/export/search", async (req, res) => {
    if (!checkExportRateLimit(req.ip || "unknown")) {
      return res.status(429).json({ error: "Too many export requests. Try again in a minute." });
    }
    try {
      const query = (req.query.q as string) || "";
      const format = (req.query.format as string) || "json";

      if (query.length < 2) {
        return res.status(400).json({ error: "Query must be at least 2 characters" });
      }

      const results = await storage.search(query);
      sendExport(res, results, "search-results", format, () => {
        const rows: { type: string; id: number; name_or_title: string; description: string }[] = [];
        for (const p of results.persons) rows.push({ type: "person", id: p.id, name_or_title: p.name, description: p.description || "" });
        for (const d of results.documents) rows.push({ type: "document", id: d.id, name_or_title: d.title, description: d.description || "" });
        for (const e of results.events) rows.push({ type: "event", id: e.id, name_or_title: e.title, description: e.description || "" });
        return toCsv(["type", "id", "name_or_title", "description"], rows as any[]);
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to export search results" });
    }
  });

  return httpServer;
}
