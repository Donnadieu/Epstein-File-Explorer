import { describe, it, expect } from "vitest";
import {
  insertPersonSchema,
  insertDocumentSchema,
  insertConnectionSchema,
  insertTimelineEventSchema,
  insertBookmarkSchema,
} from "../schema";

describe("insertPersonSchema", () => {
  it("accepts valid person data", () => {
    const result = insertPersonSchema.safeParse({
      name: "Test Person",
      role: "associate",
      description: "A test person",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = insertPersonSchema.safeParse({
      role: "associate",
      description: "A test person",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing role", () => {
    const result = insertPersonSchema.safeParse({
      name: "Test",
      description: "A test person",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = insertPersonSchema.safeParse({
      name: "Test Person",
      role: "associate",
      description: "A test person",
      nationality: "US",
      occupation: "Lawyer",
      aliases: ["Test Alias"],
    });
    expect(result.success).toBe(true);
  });
});

describe("insertDocumentSchema", () => {
  it("accepts valid document data", () => {
    const result = insertDocumentSchema.safeParse({
      title: "Test Document",
      documentType: "legal-filing",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing title", () => {
    const result = insertDocumentSchema.safeParse({
      documentType: "legal-filing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing documentType", () => {
    const result = insertDocumentSchema.safeParse({
      title: "Test Document",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional metadata fields", () => {
    const result = insertDocumentSchema.safeParse({
      title: "Test Document",
      documentType: "legal-filing",
      description: "Desc",
      dataSet: "set-a",
      sourceUrl: "https://example.com/doc.pdf",
      pageCount: 10,
      isRedacted: false,
      tags: ["test", "legal"],
      mediaType: "pdf",
    });
    expect(result.success).toBe(true);
  });
});

describe("insertConnectionSchema", () => {
  it("accepts valid connection data", () => {
    const result = insertConnectionSchema.safeParse({
      personId1: 1,
      personId2: 2,
      connectionType: "associate",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing personId1", () => {
    const result = insertConnectionSchema.safeParse({
      personId2: 2,
      connectionType: "associate",
    });
    expect(result.success).toBe(false);
  });
});

describe("insertTimelineEventSchema", () => {
  it("accepts valid event data", () => {
    const result = insertTimelineEventSchema.safeParse({
      date: "2008-06-30",
      title: "Test Event",
      description: "A test event",
      category: "legal",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = insertTimelineEventSchema.safeParse({
      date: "2008-06-30",
    });
    expect(result.success).toBe(false);
  });
});

describe("insertBookmarkSchema", () => {
  it("accepts valid bookmark data", () => {
    const result = insertBookmarkSchema.safeParse({
      entityType: "person",
      entityId: 1,
      userId: "anonymous",
    });
    expect(result.success).toBe(true);
  });

  it("accepts search bookmark", () => {
    const result = insertBookmarkSchema.safeParse({
      entityType: "search",
      searchQuery: "test query",
      userId: "anonymous",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing entityType", () => {
    const result = insertBookmarkSchema.safeParse({
      entityId: 1,
      userId: "anonymous",
    });
    expect(result.success).toBe(false);
  });
});
