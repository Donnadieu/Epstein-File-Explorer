import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import { createServer } from "http";
import request from "supertest";
import type { Person, Document, TimelineEvent, Bookmark } from "@shared/schema";

// Mock the storage module before importing routes
vi.mock("../storage", () => ({
  storage: {
    getStats: vi.fn(),
    getPersons: vi.fn(),
    getPerson: vi.fn(),
    getPersonWithDetails: vi.fn(),
    getPersonsPaginated: vi.fn(),
    getDocuments: vi.fn(),
    getDocument: vi.fn(),
    getDocumentWithDetails: vi.fn(),
    getDocumentsFiltered: vi.fn(),
    getDocumentFilters: vi.fn(),
    getAdjacentDocumentIds: vi.fn(),
    getSidebarCounts: vi.fn(),
    getTimelineEvents: vi.fn(),
    getNetworkData: vi.fn(),
    search: vi.fn(),
    searchPages: vi.fn(),
    getBookmarks: vi.fn(),
    createBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
    getPipelineJobs: vi.fn(),
    getPipelineStats: vi.fn(),
    getBudgetSummary: vi.fn(),
    getAIAnalysisList: vi.fn(),
    getAIAnalysis: vi.fn(),
    getAIAnalysisAggregate: vi.fn(),
    getConnections: vi.fn(),
    createConnection: vi.fn(),
    createPerson: vi.fn(),
    createDocument: vi.fn(),
    createPersonDocument: vi.fn(),
    createTimelineEvent: vi.fn(),
  },
}));

// Mock R2 module
vi.mock("../r2", () => ({
  isR2Configured: vi.fn(() => false),
  getPresignedUrl: vi.fn(),
  getR2Stream: vi.fn(),
}));

// Mock chat routes
vi.mock("../chat", () => ({
  registerChatRoutes: vi.fn(),
}));

import { registerRoutes } from "../routes";
import { storage } from "../storage";

const mockedStorage = vi.mocked(storage);

let app: express.Express;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  httpServer = createServer(app);
  await registerRoutes(httpServer, app);
});

beforeEach(() => {
  vi.clearAllMocks();
});

// -- Fixture data --

const mockPerson: Person = {
  id: 1,
  name: "Test Person",
  aliases: null,
  role: "associate",
  description: "A test person",
  status: "named",
  nationality: "US",
  occupation: "Unknown",
  imageUrl: null,
  documentCount: 5,
  connectionCount: 3,
  category: "associate",
  profileSections: null,
  wikipediaUrl: null,
  emailCount: 0,
  topContacts: null,
};

const mockDocument: Document = {
  id: 1,
  title: "Test Document",
  description: "A test document",
  documentType: "legal-filing",
  dataSet: "set-a",
  sourceUrl: "https://www.justice.gov/test.pdf",
  datePublished: "2023-01-01",
  dateOriginal: null,
  pageCount: 10,
  isRedacted: false,
  keyExcerpt: "Test excerpt",
  tags: ["test"],
  mediaType: "pdf",
  processingStatus: "completed",
  aiAnalysisStatus: "completed",
  fileSizeBytes: 1024,
  fileHash: "abc123",
  localPath: "/data/downloads/test.pdf",
  r2Key: "documents/test.pdf",
  eftaNumber: null,
  mimeType: "application/pdf",
  extractedTextLength: 500,
  aiCostCents: 10,
};

const mockEvent: TimelineEvent = {
  id: 1,
  date: "2008-06-30",
  title: "Test Event",
  description: "A test event",
  category: "legal",
  personIds: [1],
  documentIds: [1],
  significance: 5,
};

// -- Tests --

describe("GET /api/stats", () => {
  it("returns stats", async () => {
    const stats = { personCount: 100, documentCount: 200, pageCount: 5000, connectionCount: 50, eventCount: 300 };
    mockedStorage.getStats.mockResolvedValue(stats);

    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(stats);
  });

  it("returns 500 on error", async () => {
    mockedStorage.getStats.mockRejectedValue(new Error("DB error"));

    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch stats");
  });
});

describe("GET /api/persons", () => {
  it("returns all persons without pagination", async () => {
    mockedStorage.getPersons.mockResolvedValue([mockPerson]);

    const res = await request(app).get("/api/persons");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Test Person");
  });

  it("returns paginated persons when page param is provided", async () => {
    const paginated = { data: [mockPerson], total: 1, page: 1, totalPages: 1 };
    mockedStorage.getPersonsPaginated.mockResolvedValue(paginated);

    const res = await request(app).get("/api/persons?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(mockedStorage.getPersonsPaginated).toHaveBeenCalledWith(1, 10);
  });

  it("clamps limit to max 100", async () => {
    const paginated = { data: [], total: 0, page: 1, totalPages: 0 };
    mockedStorage.getPersonsPaginated.mockResolvedValue(paginated);

    await request(app).get("/api/persons?page=1&limit=500");
    expect(mockedStorage.getPersonsPaginated).toHaveBeenCalledWith(1, 100);
  });
});

describe("GET /api/persons/:id", () => {
  it("returns person with details", async () => {
    mockedStorage.getPersonWithDetails.mockResolvedValue(mockPerson);

    const res = await request(app).get("/api/persons/1");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Test Person");
  });

  it("returns 400 for invalid ID", async () => {
    const res = await request(app).get("/api/persons/abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid ID");
  });

  it("returns 404 when person not found", async () => {
    mockedStorage.getPersonWithDetails.mockResolvedValue(null);

    const res = await request(app).get("/api/persons/999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Person not found");
  });
});

describe("GET /api/documents", () => {
  it("returns paginated filtered documents", async () => {
    const filtered = { data: [mockDocument], total: 1, page: 1, totalPages: 1 };
    mockedStorage.getDocumentsFiltered.mockResolvedValue(filtered);

    const res = await request(app).get("/api/documents?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // Verify internal fields are omitted
    expect(res.body.data[0]).not.toHaveProperty("localPath");
    expect(res.body.data[0]).not.toHaveProperty("r2Key");
    expect(res.body.data[0]).not.toHaveProperty("fileHash");
  });

  it("passes filter params to storage", async () => {
    const filtered = { data: [], total: 0, page: 1, totalPages: 0 };
    mockedStorage.getDocumentsFiltered.mockResolvedValue(filtered);

    await request(app).get("/api/documents?page=1&limit=10&type=legal-filing&dataSet=set-a&mediaType=pdf");
    expect(mockedStorage.getDocumentsFiltered).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      search: undefined,
      type: "legal-filing",
      dataSet: "set-a",
      redacted: undefined,
      mediaType: "pdf",
    });
  });
});

describe("GET /api/documents/:id", () => {
  it("returns document without internal fields", async () => {
    mockedStorage.getDocumentWithDetails.mockResolvedValue(mockDocument);

    const res = await request(app).get("/api/documents/1");
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Test Document");
    expect(res.body).not.toHaveProperty("localPath");
    expect(res.body).not.toHaveProperty("r2Key");
    expect(res.body).not.toHaveProperty("fileHash");
  });

  it("returns 404 when document not found", async () => {
    mockedStorage.getDocumentWithDetails.mockResolvedValue(null);

    const res = await request(app).get("/api/documents/999");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/documents/filters", () => {
  it("returns available filters", async () => {
    const filters = { types: ["legal-filing"], dataSets: ["set-a"], mediaTypes: ["pdf"] };
    mockedStorage.getDocumentFilters.mockResolvedValue(filters);

    const res = await request(app).get("/api/documents/filters");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(filters);
  });
});

describe("GET /api/sidebar-counts", () => {
  it("returns sidebar counts", async () => {
    const counts = {
      documents: { total: 100, byType: { "legal-filing": 50 } },
      media: { images: 10, videos: 5 },
      persons: 200,
      events: 300,
      connections: 50,
    };
    mockedStorage.getSidebarCounts.mockResolvedValue(counts);

    const res = await request(app).get("/api/sidebar-counts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(counts);
  });
});

describe("GET /api/timeline", () => {
  it("returns timeline events", async () => {
    mockedStorage.getTimelineEvents.mockResolvedValue([mockEvent]);

    const res = await request(app).get("/api/timeline");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("GET /api/network", () => {
  it("returns network data", async () => {
    const networkData = { persons: [mockPerson], connections: [], timelineYearRange: [1990, 2020] as [number, number], personYears: {} };
    mockedStorage.getNetworkData.mockResolvedValue(networkData);

    const res = await request(app).get("/api/network");
    expect(res.status).toBe(200);
    expect(res.body.persons).toHaveLength(1);
  });
});

describe("GET /api/search", () => {
  it("returns search results for valid query", async () => {
    const results = { persons: [mockPerson], documents: [mockDocument], events: [mockEvent] };
    mockedStorage.search.mockResolvedValue(results);

    const res = await request(app).get("/api/search?q=test");
    expect(res.status).toBe(200);
    expect(res.body.persons).toHaveLength(1);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.events).toHaveLength(1);
  });

  it("returns empty results for short query (< 2 chars)", async () => {
    const res = await request(app).get("/api/search?q=a");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ persons: [], documents: [], events: [] });
    expect(mockedStorage.search).not.toHaveBeenCalled();
  });
});

describe("GET /api/search/pages", () => {
  it("returns paginated page search results", async () => {
    const results = { results: [], total: 0, page: 1, totalPages: 0 };
    mockedStorage.searchPages.mockResolvedValue(results);

    const res = await request(app).get("/api/search/pages?q=test&page=1&limit=20");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("returns empty for short query", async () => {
    const res = await request(app).get("/api/search/pages?q=x");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [], total: 0, page: 1, totalPages: 0 });
  });
});

describe("Bookmark routes", () => {
  it("GET /api/bookmarks returns bookmarks", async () => {
    const bookmarks: Bookmark[] = [{
      id: 1,
      userId: "anonymous",
      entityType: "person",
      entityId: 1,
      searchQuery: null,
      label: "Test",
      createdAt: new Date(),
    }];
    mockedStorage.getBookmarks.mockResolvedValue(bookmarks);

    const res = await request(app).get("/api/bookmarks?userId=anonymous");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("POST /api/bookmarks creates bookmark", async () => {
    const newBookmark: Bookmark = {
      id: 1,
      userId: "anonymous",
      entityType: "person",
      entityId: 1,
      searchQuery: null,
      label: "Test",
      createdAt: new Date(),
    };
    mockedStorage.createBookmark.mockResolvedValue(newBookmark);

    const res = await request(app)
      .post("/api/bookmarks")
      .send({ entityType: "person", entityId: 1, label: "Test" });
    expect(res.status).toBe(201);
  });

  it("POST /api/bookmarks rejects invalid entityType", async () => {
    const res = await request(app)
      .post("/api/bookmarks")
      .send({ entityType: "invalid", entityId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("entityType");
  });

  it("DELETE /api/bookmarks/:id deletes bookmark", async () => {
    mockedStorage.deleteBookmark.mockResolvedValue(true);

    const res = await request(app).delete("/api/bookmarks/1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /api/bookmarks/:id returns 404 when not found", async () => {
    mockedStorage.deleteBookmark.mockResolvedValue(false);

    const res = await request(app).delete("/api/bookmarks/999");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/pipeline/jobs", () => {
  it("returns pipeline jobs", async () => {
    mockedStorage.getPipelineJobs.mockResolvedValue([]);

    const res = await request(app).get("/api/pipeline/jobs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /api/pipeline/stats", () => {
  it("returns pipeline stats", async () => {
    const stats = { pending: 5, running: 1, completed: 100, failed: 2 };
    mockedStorage.getPipelineStats.mockResolvedValue(stats);

    const res = await request(app).get("/api/pipeline/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(stats);
  });
});

describe("GET /api/budget", () => {
  it("returns budget summary", async () => {
    const summary = { totalCostCents: 500, totalInputTokens: 100000, totalOutputTokens: 50000, byModel: { "deepseek-chat": 500 } };
    mockedStorage.getBudgetSummary.mockResolvedValue(summary);

    const res = await request(app).get("/api/budget");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(summary);
  });
});

describe("GET /api/ai-analyses", () => {
  it("returns analysis list", async () => {
    mockedStorage.getAIAnalysisList.mockResolvedValue([]);

    const res = await request(app).get("/api/ai-analyses");
    expect(res.status).toBe(200);
    expect(res.body.analyses).toEqual([]);
  });

  it("supports pagination", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      fileName: `file${i}.json`,
      dataSet: "set-a",
      documentType: "legal-filing",
      summary: "Test",
      personCount: 1,
      connectionCount: 0,
      eventCount: 0,
      locationCount: 0,
      keyFactCount: 0,
      tier: 1,
      costCents: 5,
      analyzedAt: "2024-01-01",
    }));
    mockedStorage.getAIAnalysisList.mockResolvedValue(items);

    const res = await request(app).get("/api/ai-analyses?page=1&limit=2");
    expect(res.status).toBe(200);
    expect(res.body.analyses).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.totalPages).toBe(3);
  });
});

describe("GET /api/ai-analyses/:fileName", () => {
  it("returns analysis for valid file", async () => {
    const analysis = { fileName: "test.json", summary: "Test analysis" };
    mockedStorage.getAIAnalysis.mockResolvedValue(analysis as any);

    const res = await request(app).get("/api/ai-analyses/test.json");
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("Test analysis");
  });

  it("rejects path traversal attempts", async () => {
    const res = await request(app).get("/api/ai-analyses/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid file name");
  });

  it("returns 404 when analysis not found", async () => {
    mockedStorage.getAIAnalysis.mockResolvedValue(null);

    const res = await request(app).get("/api/ai-analyses/missing.json");
    expect(res.status).toBe(404);
  });
});

describe("Export routes", () => {
  it("GET /api/export/persons returns JSON by default", async () => {
    mockedStorage.getPersons.mockResolvedValue([mockPerson]);

    const res = await request(app).get("/api/export/persons");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toBe("attachment; filename=persons.json");
  });

  it("GET /api/export/persons returns CSV when format=csv", async () => {
    mockedStorage.getPersons.mockResolvedValue([mockPerson]);

    const res = await request(app).get("/api/export/persons?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("id,name,role");
    expect(res.text).toContain("Test Person");
  });

  it("GET /api/export/documents returns data", async () => {
    mockedStorage.getDocuments.mockResolvedValue([mockDocument]);

    const res = await request(app).get("/api/export/documents");
    expect(res.status).toBe(200);
  });

  it("GET /api/export/search rejects short queries", async () => {
    const res = await request(app).get("/api/export/search?q=a");
    expect(res.status).toBe(400);
  });

  it("GET /api/export/search returns results for valid query", async () => {
    const results = { persons: [mockPerson], documents: [], events: [] };
    mockedStorage.search.mockResolvedValue(results);

    const res = await request(app).get("/api/export/search?q=test");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/documents/:id/adjacent", () => {
  it("returns adjacent document IDs", async () => {
    mockedStorage.getAdjacentDocumentIds.mockResolvedValue({ prev: null, next: 2 });

    const res = await request(app).get("/api/documents/1/adjacent");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prev: null, next: 2 });
  });

  it("returns 400 for invalid ID", async () => {
    const res = await request(app).get("/api/documents/abc/adjacent");
    expect(res.status).toBe(400);
  });
});
