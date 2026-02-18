import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the typesense npm module
const mockSearch = vi.fn();
const mockHealth = { retrieve: vi.fn() };

class MockClient {
  collections: any;
  health: any;
  constructor(_opts: any) {
    this.collections = vi.fn().mockReturnValue({
      documents: vi.fn().mockReturnValue({ search: mockSearch }),
    });
    this.health = mockHealth;
  }
}

vi.mock("typesense", () => {
  return {
    default: { Client: MockClient },
    Client: MockClient,
  };
});

vi.mock("typesense/lib/Typesense/Client", () => {
  return { default: MockClient };
});

// Mock R2 module
vi.mock("../r2", () => ({
  isR2Configured: vi.fn(() => false),
}));

describe("typesense module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isTypesenseConfigured", () => {
    it("returns false when TYPESENSE_HOST is not set", async () => {
      delete process.env.TYPESENSE_HOST;
      delete process.env.TYPESENSE_API_KEY;
      const { isTypesenseConfigured } = await import("../typesense");
      expect(isTypesenseConfigured()).toBe(false);
    });

    it("returns false when only host is set without API key", async () => {
      process.env.TYPESENSE_HOST = "localhost";
      delete process.env.TYPESENSE_API_KEY;
      delete process.env.TYPESENSE_SEARCH_API_KEY;
      const { isTypesenseConfigured } = await import("../typesense");
      expect(isTypesenseConfigured()).toBe(false);
    });

    it("returns true when host and API key are set", async () => {
      process.env.TYPESENSE_HOST = "localhost";
      process.env.TYPESENSE_API_KEY = "test-key";
      const { isTypesenseConfigured } = await import("../typesense");
      expect(isTypesenseConfigured()).toBe(true);
    });

    it("returns true when host and search API key are set", async () => {
      process.env.TYPESENSE_HOST = "localhost";
      process.env.TYPESENSE_SEARCH_API_KEY = "search-key";
      const { isTypesenseConfigured } = await import("../typesense");
      expect(isTypesenseConfigured()).toBe(true);
    });
  });

  describe("getTypesenseClient", () => {
    it("returns null when not configured", async () => {
      delete process.env.TYPESENSE_HOST;
      delete process.env.TYPESENSE_API_KEY;
      const { getTypesenseClient } = await import("../typesense");
      expect(getTypesenseClient()).toBeNull();
    });

    it("returns a client when configured", async () => {
      process.env.TYPESENSE_HOST = "localhost";
      process.env.TYPESENSE_API_KEY = "test-key";
      const { getTypesenseClient } = await import("../typesense");
      const client = getTypesenseClient();
      expect(client).not.toBeNull();
    });
  });

  describe("COLLECTION_SCHEMA", () => {
    it("has the expected collection name", async () => {
      const { COLLECTION_NAME } = await import("../typesense");
      expect(COLLECTION_NAME).toBe("document_pages");
    });

    it("has required fields", async () => {
      const { COLLECTION_SCHEMA } = await import("../typesense");
      const fieldNames = COLLECTION_SCHEMA.fields!.map((f: any) => f.name);
      expect(fieldNames).toContain("content");
      expect(fieldNames).toContain("title");
      expect(fieldNames).toContain("document_id");
      expect(fieldNames).toContain("page_number");
      expect(fieldNames).toContain("is_viewable");
      expect(fieldNames).toContain("document_type");
      expect(fieldNames).toContain("data_set");
    });

    it("has faceted fields for document_type and data_set", async () => {
      const { COLLECTION_SCHEMA } = await import("../typesense");
      const docType = COLLECTION_SCHEMA.fields!.find((f: any) => f.name === "document_type");
      const dataSet = COLLECTION_SCHEMA.fields!.find((f: any) => f.name === "data_set");
      expect((docType as any).facet).toBe(true);
      expect((dataSet as any).facet).toBe(true);
    });
  });
});
