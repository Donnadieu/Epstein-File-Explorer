import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Person, Document, Connection, TimelineEvent } from "@shared/schema";

// Mock storage
vi.mock("../storage", () => ({
  storage: {
    getStats: vi.fn(),
    getPersons: vi.fn(),
    getPersonsPaginated: vi.fn(),
    getPersonWithDetails: vi.fn(),
    getDocuments: vi.fn(),
    getDocumentsPaginated: vi.fn(),
    getDocumentsCursor: vi.fn(),
    getDocumentsFiltered: vi.fn(),
    getDocumentFilters: vi.fn(),
    getDocumentWithDetails: vi.fn(),
    getConnections: vi.fn(),
    getConnectionsPaginated: vi.fn(),
    getConnectionById: vi.fn(),
    getConnectionTypes: vi.fn(),
    getTimelineFiltered: vi.fn(),
    getTimelineEvents: vi.fn(),
    getNetworkData: vi.fn(),
    search: vi.fn(),
    searchWithTypesense: vi.fn(),
    searchPages: vi.fn(),
    getAIAnalysisList: vi.fn(),
    getAIAnalysis: vi.fn(),
    getAIAnalysisAggregate: vi.fn(),
  },
}));

// Mock R2
vi.mock("../r2", () => ({
  isR2Configured: vi.fn(() => false),
  getPublicUrl: vi.fn((key: string) => key ? `https://r2.example.com/${key}` : null),
  getPresignedUrl: vi.fn(),
  getR2Stream: vi.fn(),
}));

// Mock Typesense
vi.mock("../typesense", () => ({
  isTypesenseConfigured: vi.fn(() => false),
  typesenseSearchPages: vi.fn(),
  typesenseSearchInstant: vi.fn(),
  typesenseDocumentSearch: vi.fn(),
  typesenseSearchPersons: vi.fn(),
  getTypesenseClient: vi.fn(() => null),
}));

import { createV1Router } from "../api/v1";
import { storage } from "../storage";

const mockedStorage = vi.mocked(storage);

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api/v1", createV1Router());
});

beforeEach(() => {
  vi.clearAllMocks();
});

// -- Fixtures --

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

const mockConnection = {
  id: 1,
  personId1: 1,
  personId2: 2,
  connectionType: "associate",
  description: "Known associates",
  strength: 5,
  documentIds: [1],
  person1Name: "Person A",
  person2Name: "Person B",
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

// -- Health & Stats --

describe("GET /api/v1/health", () => {
  it("returns health status in envelope", async () => {
    mockedStorage.getStats.mockResolvedValue({
      personCount: 100, documentCount: 200, pageCount: 5000, connectionCount: 50, eventCount: 300,
    });

    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.counts.persons).toBe(100);
    expect(res.body.meta.apiVersion).toBe("v1");
    expect(res.body.meta.timestamp).toBeDefined();
  });
});

describe("GET /api/v1/stats", () => {
  it("returns stats in envelope", async () => {
    mockedStorage.getStats.mockResolvedValue({
      personCount: 100, documentCount: 200, pageCount: 5000, connectionCount: 50, eventCount: 300,
    });

    const res = await request(app).get("/api/v1/stats");
    expect(res.status).toBe(200);
    expect(res.body.data.persons).toBe(100);
    expect(res.body.data.documents).toBe(200);
    expect(res.body.meta.apiVersion).toBe("v1");
  });
});

// -- Persons --

describe("GET /api/v1/persons", () => {
  it("returns paginated persons in envelope", async () => {
    mockedStorage.getPersonsPaginated.mockResolvedValue({
      data: [mockPerson], total: 1, page: 1, totalPages: 1,
    });

    const res = await request(app).get("/api/v1/persons?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Test Person");
    expect(res.body.meta.total).toBe(1);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.apiVersion).toBe("v1");
  });

  it("clamps limit to max 100", async () => {
    mockedStorage.getPersonsPaginated.mockResolvedValue({
      data: [], total: 0, page: 1, totalPages: 0,
    });

    await request(app).get("/api/v1/persons?page=1&limit=500");
    expect(mockedStorage.getPersonsPaginated).toHaveBeenCalledWith(1, 100);
  });
});

describe("GET /api/v1/persons/:id", () => {
  it("returns person detail in envelope", async () => {
    mockedStorage.getPersonWithDetails.mockResolvedValue({
      ...mockPerson,
      documents: [],
      connections: [],
      timelineEvents: [],
    });

    const res = await request(app).get("/api/v1/persons/1");
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Test Person");
    expect(res.body.meta.apiVersion).toBe("v1");
  });

  it("returns 400 for invalid ID", async () => {
    const res = await request(app).get("/api/v1/persons/abc");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 when not found", async () => {
    mockedStorage.getPersonWithDetails.mockResolvedValue(null);

    const res = await request(app).get("/api/v1/persons/999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.meta.apiVersion).toBe("v1");
  });
});

// -- Documents --

describe("GET /api/v1/documents", () => {
  it("returns paginated documents without internal fields", async () => {
    mockedStorage.getDocumentsFiltered.mockResolvedValue({
      data: [mockDocument], total: 1, page: 1, totalPages: 1,
    });

    const res = await request(app).get("/api/v1/documents?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).not.toHaveProperty("localPath");
    expect(res.body.data[0]).not.toHaveProperty("r2Key");
    expect(res.body.data[0]).not.toHaveProperty("fileHash");
    expect(res.body.data[0].publicUrl).toBeDefined();
    expect(res.body.meta.total).toBe(1);
  });

  it("passes filter params to storage", async () => {
    mockedStorage.getDocumentsFiltered.mockResolvedValue({
      data: [], total: 0, page: 1, totalPages: 0,
    });

    await request(app).get("/api/v1/documents?page=1&limit=10&type=legal-filing&dataSet=set-a");
    expect(mockedStorage.getDocumentsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ type: "legal-filing", dataSet: "set-a" }),
    );
  });
});

describe("GET /api/v1/documents/filters", () => {
  it("returns filters in envelope", async () => {
    const filters = { types: ["legal-filing"], dataSets: ["set-a"], mediaTypes: ["pdf"] };
    mockedStorage.getDocumentFilters.mockResolvedValue(filters);

    const res = await request(app).get("/api/v1/documents/filters");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(filters);
  });
});

describe("GET /api/v1/documents/:id", () => {
  it("strips internal fields", async () => {
    mockedStorage.getDocumentWithDetails.mockResolvedValue(mockDocument);

    const res = await request(app).get("/api/v1/documents/1");
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("localPath");
    expect(res.body.data).not.toHaveProperty("fileHash");
    expect(res.body.data.publicUrl).toBeDefined();
  });

  it("returns 404 when not found", async () => {
    mockedStorage.getDocumentWithDetails.mockResolvedValue(null);

    const res = await request(app).get("/api/v1/documents/999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

// -- Connections --

describe("GET /api/v1/connections", () => {
  it("returns paginated connections", async () => {
    mockedStorage.getConnectionsPaginated.mockResolvedValue({
      data: [mockConnection], total: 1, page: 1, totalPages: 1,
    });

    const res = await request(app).get("/api/v1/connections?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].person1Name).toBe("Person A");
    expect(res.body.meta.total).toBe(1);
  });

  it("passes filter params", async () => {
    mockedStorage.getConnectionsPaginated.mockResolvedValue({
      data: [], total: 0, page: 1, totalPages: 0,
    });

    await request(app).get("/api/v1/connections?type=associate&personId=1&minStrength=3");
    expect(mockedStorage.getConnectionsPaginated).toHaveBeenCalledWith({
      page: 1, limit: 50, type: "associate", personId: 1, minStrength: 3,
    });
  });
});

describe("GET /api/v1/connections/types", () => {
  it("returns connection types with counts", async () => {
    mockedStorage.getConnectionTypes.mockResolvedValue([
      { type: "associate", count: 50 },
      { type: "family", count: 10 },
    ]);

    const res = await request(app).get("/api/v1/connections/types");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].type).toBe("associate");
  });
});

describe("GET /api/v1/connections/:id", () => {
  it("returns single connection", async () => {
    mockedStorage.getConnectionById.mockResolvedValue(mockConnection as any);

    const res = await request(app).get("/api/v1/connections/1");
    expect(res.status).toBe(200);
    expect(res.body.data.person1Name).toBe("Person A");
  });

  it("returns 404 when not found", async () => {
    mockedStorage.getConnectionById.mockResolvedValue(null);

    const res = await request(app).get("/api/v1/connections/999");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

// -- Timeline --

describe("GET /api/v1/timeline", () => {
  it("returns paginated timeline events", async () => {
    mockedStorage.getTimelineFiltered.mockResolvedValue({
      data: [mockEvent], total: 1, page: 1, totalPages: 1,
    });

    const res = await request(app).get("/api/v1/timeline?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it("passes filter params", async () => {
    mockedStorage.getTimelineFiltered.mockResolvedValue({
      data: [], total: 0, page: 1, totalPages: 0,
    });

    await request(app).get("/api/v1/timeline?category=legal&yearFrom=2000&yearTo=2020&significance=5");
    expect(mockedStorage.getTimelineFiltered).toHaveBeenCalledWith({
      page: 1, limit: 50, category: "legal", yearFrom: "2000", yearTo: "2020", significance: 5,
    });
  });
});

// -- Search --

describe("GET /api/v1/search", () => {
  it("returns search results in envelope", async () => {
    const results = { persons: [mockPerson], documents: [mockDocument], events: [mockEvent] };
    mockedStorage.search.mockResolvedValue(results);

    const res = await request(app).get("/api/v1/search?q=test");
    expect(res.status).toBe(200);
    expect(res.body.data.persons).toHaveLength(1);
    // Documents should have internal fields stripped
    expect(res.body.data.documents[0]).not.toHaveProperty("localPath");
  });

  it("returns 400 for short query", async () => {
    const res = await request(app).get("/api/v1/search?q=a");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

// -- Network --

describe("GET /api/v1/network", () => {
  it("returns network data in envelope", async () => {
    const networkData = {
      persons: [mockPerson],
      connections: [mockConnection],
      timelineYearRange: [1990, 2020] as [number, number],
      personYears: {},
    };
    mockedStorage.getNetworkData.mockResolvedValue(networkData);

    const res = await request(app).get("/api/v1/network");
    expect(res.status).toBe(200);
    expect(res.body.data.persons).toHaveLength(1);
    expect(res.body.data.connections).toHaveLength(1);
  });
});

// -- Exports --

describe("Export routes", () => {
  it("GET /api/v1/export/persons returns JSON", async () => {
    mockedStorage.getPersons.mockResolvedValue([mockPerson]);

    const res = await request(app).get("/api/v1/export/persons");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("persons.json");
  });

  it("GET /api/v1/export/persons returns CSV", async () => {
    mockedStorage.getPersons.mockResolvedValue([mockPerson]);

    const res = await request(app).get("/api/v1/export/persons?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("id,name,role");
  });

  it("GET /api/v1/export/documents returns data", async () => {
    mockedStorage.getDocuments.mockResolvedValue([mockDocument]);

    const res = await request(app).get("/api/v1/export/documents");
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/export/connections returns enriched connections", async () => {
    mockedStorage.getNetworkData.mockResolvedValue({
      persons: [mockPerson],
      connections: [mockConnection],
      timelineYearRange: [1990, 2020],
      personYears: {},
    });

    const res = await request(app).get("/api/v1/export/connections");
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/export/timeline returns events", async () => {
    mockedStorage.getTimelineEvents.mockResolvedValue([mockEvent]);

    const res = await request(app).get("/api/v1/export/timeline");
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/export/graph returns JSON by default", async () => {
    mockedStorage.getNetworkData.mockResolvedValue({
      persons: [mockPerson],
      connections: [mockConnection],
      timelineYearRange: [1990, 2020],
      personYears: {},
    });

    const res = await request(app).get("/api/v1/export/graph");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("epstein-network.json");
  });

  it("GET /api/v1/export/graph?format=graphml returns GraphML XML", async () => {
    mockedStorage.getNetworkData.mockResolvedValue({
      persons: [mockPerson],
      connections: [mockConnection],
      timelineYearRange: [1990, 2020],
      personYears: {},
    });

    const res = await request(app).get("/api/v1/export/graph?format=graphml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.text).toContain("<graphml");
    expect(res.text).toContain("Test Person");
  });

  it("GET /api/v1/export/search rejects short query", async () => {
    const res = await request(app).get("/api/v1/export/search?q=a");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

// -- AI Analyses --

describe("GET /api/v1/ai-analyses", () => {
  it("returns paginated list", async () => {
    const items = Array.from({ length: 2 }, (_, i) => ({
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
    mockedStorage.getAIAnalysisList.mockResolvedValue({ data: items, total: 5 });

    const res = await request(app).get("/api/v1/ai-analyses?page=1&limit=2");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(5);
    expect(res.body.meta.totalPages).toBe(3);
  });
});

describe("GET /api/v1/ai-analyses/:fileName", () => {
  it("returns analysis in envelope", async () => {
    mockedStorage.getAIAnalysis.mockResolvedValue({ fileName: "test.json", summary: "Test" } as any);

    const res = await request(app).get("/api/v1/ai-analyses/test.json");
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBe("Test");
  });

  it("rejects path traversal", async () => {
    const res = await request(app).get("/api/v1/ai-analyses/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 when not found", async () => {
    mockedStorage.getAIAnalysis.mockResolvedValue(null);

    const res = await request(app).get("/api/v1/ai-analyses/missing.json");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

// -- Error format --

describe("Error response format", () => {
  it("has standard error envelope shape", async () => {
    mockedStorage.getPersonWithDetails.mockResolvedValue(null);

    const res = await request(app).get("/api/v1/persons/999");
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("code");
    expect(res.body.error).toHaveProperty("message");
    expect(res.body).toHaveProperty("meta");
    expect(res.body.meta.apiVersion).toBe("v1");
  });
});

// -- Obsidian export --

describe("GET /api/v1/export/obsidian", () => {
  it("returns a tar.gz file with correct headers", async () => {
    mockedStorage.getPersons.mockResolvedValue([mockPerson]);
    mockedStorage.getDocumentsCursor.mockResolvedValueOnce([mockDocument]);
    mockedStorage.getDocumentsCursor.mockResolvedValueOnce([]);
    mockedStorage.getTimelineEvents.mockResolvedValue([{
      ...mockEvent,
      persons: [{ id: 1, name: "Test Person" }],
      documents: [{ id: 1, title: "Test Document" }],
    }]);
    mockedStorage.getNetworkData.mockResolvedValue({
      persons: [mockPerson],
      connections: [mockConnection],
      timelineYearRange: [1990, 2020],
      personYears: {},
    });

    const res = await request(app)
      .get("/api/v1/export/obsidian")
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/gzip");
    expect(res.headers["content-disposition"]).toContain("epstein-vault.tar.gz");
    // Response body should be non-empty binary data
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.byteLength).toBeGreaterThan(0);
  });
});

// -- OpenAPI spec --

describe("GET /api/v1/openapi.json", () => {
  it("returns OpenAPI spec in envelope", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.data.openapi).toBe("3.1.0");
    expect(res.body.data.info.title).toContain("Epstein");
    expect(res.body.data.paths).toBeDefined();
  });
});
