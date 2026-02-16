import { describe, it, expect, vi } from "vitest";

// Mock db and r2 modules before importing storage (they throw without env vars)
vi.mock("../db", () => ({
  db: {},
  pool: {},
}));

vi.mock("../r2", () => ({
  isR2Configured: vi.fn(() => false),
  getPresignedUrl: vi.fn(),
  getR2Stream: vi.fn(),
}));

import { normalizeName, isSamePerson } from "../storage";
import type { Person } from "@shared/schema";

// Helper to create a minimal Person object for testing
function makePerson(name: string, overrides: Partial<Person> = {}): Person {
  return {
    id: Math.floor(Math.random() * 10000),
    name,
    aliases: null,
    role: "associate",
    description: "",
    status: "named",
    nationality: null,
    occupation: null,
    imageUrl: null,
    documentCount: 0,
    connectionCount: 0,
    category: "associate",
    profileSections: null,
    wikipediaUrl: null,
    emailCount: 0,
    topContacts: null,
    ...overrides,
  };
}

describe("normalizeName", () => {
  it("lowercases names", () => {
    expect(normalizeName("John Doe")).toBe("john doe");
  });

  it("converts 'Last, First' to 'First Last'", () => {
    expect(normalizeName("Maxwell, Ghislaine")).toBe("ghislaine maxwell");
  });

  it("strips common prefixes (Dr, Mr, Mrs, Ms)", () => {
    expect(normalizeName("Dr. Robert Smith")).toBe("robert smith");
    expect(normalizeName("Mr. James Brown")).toBe("james brown");
    expect(normalizeName("Mrs. Jane Doe")).toBe("jane doe");
  });

  it("strips suffixes (Jr, Sr, II, III, IV)", () => {
    expect(normalizeName("John Smith Jr.")).toBe("john smith");
    expect(normalizeName("William Gates III")).toBe("william gates");
  });

  it("removes periods and non-alpha chars", () => {
    expect(normalizeName("J. Edgar Hoover")).toBe("j edgar hoover");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeName("John   Doe")).toBe("john doe");
  });

  it("handles empty string", () => {
    expect(normalizeName("")).toBe("");
  });

  it("handles single name", () => {
    expect(normalizeName("Madonna")).toBe("madonna");
  });
});

describe("isSamePerson", () => {
  it("matches exact names after normalization", () => {
    const a = makePerson("Jeffrey Epstein");
    const b = makePerson("jeffrey epstein");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches reversed names (First Last vs Last First)", () => {
    const a = makePerson("Ghislaine Maxwell");
    const b = makePerson("Maxwell Ghislaine");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches nickname variants", () => {
    const a = makePerson("Bob Smith");
    const b = makePerson("Robert Smith");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches Bill/William", () => {
    const a = makePerson("Bill Clinton");
    const b = makePerson("William Clinton");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches Jim/James", () => {
    const a = makePerson("Jim Fisher");
    const b = makePerson("James Fisher");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches with titles stripped", () => {
    const a = makePerson("Dr. Robert Smith");
    const b = makePerson("Robert Smith");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches with suffix stripped", () => {
    const a = makePerson("John Smith Jr.");
    const b = makePerson("John Smith");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches prefix first names (J. vs James)", () => {
    const a = makePerson("J. Epstein");
    const b = makePerson("Jeffrey Epstein");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches with Last, First format", () => {
    const a = makePerson("Epstein, Jeffrey");
    const b = makePerson("Jeffrey Epstein");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("rejects single-word names to avoid false matches", () => {
    const a = makePerson("Jeffrey");
    const b = makePerson("Jeffrey");
    expect(isSamePerson(a, b)).toBe(false);
  });

  it("rejects clearly different people", () => {
    const a = makePerson("John Smith");
    const b = makePerson("Jane Doe");
    expect(isSamePerson(a, b)).toBe(false);
  });

  it("rejects different first names with same last name", () => {
    const a = makePerson("John Smith");
    const b = makePerson("Jane Smith");
    expect(isSamePerson(a, b)).toBe(false);
  });

  it("matches name with extra qualifiers (David Perry QC vs David Perry)", () => {
    const a = makePerson("David Perry QC");
    const b = makePerson("David Perry");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches via aliases", () => {
    const a = makePerson("Jeffrey Epstein", { aliases: ["Jeff Epstein"] });
    const b = makePerson("Jeff Epstein");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches OCR space-insertion variants via spaceless key", () => {
    // "To nyRicco" after normalization → "to nyricco", spaceless → "tonyricco"
    // "Tony Ricco" after normalization → "tony ricco", spaceless → "tonyricco"
    const a = makePerson("To nyRicco");
    const b = makePerson("Tony Ricco");
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches fuzzy last names with typos", () => {
    const a = makePerson("Ghislaine Maxwell");
    const b = makePerson("Ghisaine Maxwell"); // missing 'l' in first name
    expect(isSamePerson(a, b)).toBe(true);
  });

  it("matches R. Alexander Acosta vs Alex Acosta", () => {
    const a = makePerson("R. Alexander Acosta");
    const b = makePerson("Alex Acosta");
    expect(isSamePerson(a, b)).toBe(true);
  });
});
