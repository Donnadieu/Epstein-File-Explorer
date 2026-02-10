import fs from "fs/promises";
import path from "path";
import {
  persons, documents, connections, personDocuments, timelineEvents,
  pipelineJobs, budgetTracking, bookmarks,
  type Person, type InsertPerson,
  type Document, type InsertDocument,
  type Connection, type InsertConnection,
  type PersonDocument, type InsertPersonDocument,
  type TimelineEvent, type InsertTimelineEvent,
  type PipelineJob, type BudgetTracking,
  type Bookmark, type InsertBookmark,
  type AIAnalysisListItem, type AIAnalysisAggregate, type AIAnalysisDocument,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, ilike, or, sql, desc, asc, inArray } from "drizzle-orm";

export interface IStorage {
  getPersons(): Promise<Person[]>;
  getPerson(id: number): Promise<Person | undefined>;
  getPersonWithDetails(id: number): Promise<any>;
  createPerson(person: InsertPerson): Promise<Person>;

  getDocuments(): Promise<Document[]>;
  getDocument(id: number): Promise<Document | undefined>;
  getDocumentWithDetails(id: number): Promise<any>;
  createDocument(document: InsertDocument): Promise<Document>;

  getConnections(): Promise<Connection[]>;
  createConnection(connection: InsertConnection): Promise<Connection>;

  createPersonDocument(pd: InsertPersonDocument): Promise<PersonDocument>;

  getTimelineEvents(): Promise<TimelineEvent[]>;
  createTimelineEvent(event: InsertTimelineEvent): Promise<TimelineEvent>;

  getStats(): Promise<{ personCount: number; documentCount: number; connectionCount: number; eventCount: number }>;
  getNetworkData(): Promise<{ persons: Person[]; connections: any[]; timelineYearRange: [number, number]; personYears: Record<number, [number, number]> }>;
  search(query: string): Promise<{ persons: Person[]; documents: Document[]; events: TimelineEvent[] }>;

  getPersonsPaginated(page: number, limit: number): Promise<{ data: Person[]; total: number; page: number; totalPages: number }>;
  getDocumentsPaginated(page: number, limit: number): Promise<{ data: Document[]; total: number; page: number; totalPages: number }>;
  getDocumentsFiltered(opts: { page: number; limit: number; search?: string; type?: string; dataSet?: string; redacted?: string; mediaType?: string }): Promise<{ data: Document[]; total: number; page: number; totalPages: number }>;
  getDocumentFilters(): Promise<{ types: string[]; dataSets: string[]; mediaTypes: string[] }>;
  getAdjacentDocumentIds(id: number): Promise<{ prev: number | null; next: number | null }>;
  getSidebarCounts(): Promise<{
    documents: { total: number; byType: Record<string, number> };
    media: { images: number; videos: number };
    persons: number;
    events: number;
    connections: number;
  }>;

  getBookmarks(): Promise<Bookmark[]>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(id: number): Promise<boolean>;

  getPipelineJobs(status?: string): Promise<PipelineJob[]>;
  getPipelineStats(): Promise<{ pending: number; running: number; completed: number; failed: number }>;
  getBudgetSummary(): Promise<{ totalCostCents: number; totalInputTokens: number; totalOutputTokens: number; byModel: Record<string, number> }>;

  getAIAnalysisList(): Promise<AIAnalysisListItem[]>;
  getAIAnalysis(fileName: string): Promise<AIAnalysisDocument | null>;
  getAIAnalysisAggregate(): Promise<AIAnalysisAggregate>;
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function createCache<T>(ttlMs: number) {
  let data: T | null = null;
  let cachedAt = 0;
  let inflight: Promise<T> | null = null;

  return {
    async get(fetcher: () => Promise<T>): Promise<T> {
      if (data !== null && Date.now() - cachedAt < ttlMs) return data;
      if (inflight) return inflight;
      inflight = fetcher().then(result => {
        data = result;
        cachedAt = Date.now();
        return result;
      }).finally(() => { inflight = null; });
      return inflight;
    },
    invalidate() { data = null; cachedAt = 0; },
  };
}

const AI_ANALYZED_DIR = path.resolve(process.cwd(), "data", "ai-analyzed");

const CACHE_TTL = 300_000; // 5 min
let filesCache: { data: AIAnalysisDocument[]; cachedAt: number } | null = null;
let inflight: Promise<AIAnalysisDocument[]> | null = null;

async function readAllAnalysisFiles(): Promise<AIAnalysisDocument[]> {
  if (filesCache && Date.now() - filesCache.cachedAt < CACHE_TTL) {
    return filesCache.data;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    let entries: string[];
    try {
      entries = await fs.readdir(AI_ANALYZED_DIR);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    const settled = await Promise.allSettled(
      jsonFiles.map(async (file) => {
        const raw = await fs.readFile(path.join(AI_ANALYZED_DIR, file), "utf-8");
        const data = JSON.parse(raw) as AIAnalysisDocument;
        data.fileName = file;
        return data;
      })
    );

    const results: AIAnalysisDocument[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

    filesCache = { data: results, cachedAt: Date.now() };
    return results;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * Normalize a person name for matching: lowercase, remove middle initials,
 * common prefixes/suffixes, and extra whitespace.
 */
export function normalizeName(name: string): string {
  let n = name.toLowerCase();

  // Handle "Last, First" format → "First Last"
  if (n.includes(",")) {
    const parts = n.split(",").map(s => s.trim());
    if (parts.length === 2 && parts[1].length > 0) {
      n = `${parts[1]} ${parts[0]}`;
    }
  }

  return n
    .replace(/\b(dr|mr|mrs|ms|miss|jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/\./g, "") // remove periods but keep the letters (J. → j)
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collapse OCR space insertions: merge single-char fragments into adjacent words.
 * "Jeff Pa liuca" → "Jeff Paliuca", "To nyricco" → "Tonyricco"
 */
function collapseOCRSpaces(name: string): string {
  const parts = name.split(" ");
  const merged: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length === 1 && i + 1 < parts.length) {
      // Single char followed by another part — merge them
      merged.push(parts[i] + parts[i + 1]);
      i++;
    } else if (parts[i].length <= 2 && i > 0 && merged.length > 0 && merged[merged.length - 1].length > 1) {
      // Short fragment after a word — append to previous
      merged[merged.length - 1] += parts[i];
    } else {
      merged.push(parts[i]);
    }
  }
  return merged.join(" ");
}

/** Common English nickname → canonical first name mappings */
const NICKNAMES: Record<string, string> = {
  bob: "robert", rob: "robert", bobby: "robert", robby: "robert",
  bill: "william", billy: "william", will: "william", willy: "william",
  jim: "james", jimmy: "james", jes: "james", jamie: "james",
  mike: "michael", mikey: "michael",
  dick: "richard", rick: "richard", rich: "richard", ricky: "richard",
  tom: "thomas", tommy: "thomas",
  joe: "joseph", joey: "joseph",
  jack: "john", johnny: "john", jon: "john",
  ted: "theodore", teddy: "theodore",
  ed: "edward", eddie: "edward", ted2: "edward",
  al: "albert", bert: "albert",
  alex: "alexander", sandy: "alexander",
  dan: "daniel", danny: "daniel",
  dave: "david", davy: "david",
  steve: "steven", stevie: "steven",
  chris: "christopher",
  nick: "nicholas", nicky: "nicholas",
  tony: "anthony",
  larry: "lawrence", laurence: "lawrence",
  charlie: "charles", chuck: "charles",
  harry: "henry", hank: "henry",
  greg: "gregory",
  matt: "matthew",
  pat: "patrick",
  pete: "peter",
  sam: "samuel",
  ben: "benjamin",
  ken: "kenneth", kenny: "kenneth",
  meg: "megan", meghan: "megan",
};

/** Resolve a first name to its canonical form using nickname map */
function canonicalFirstName(first: string): string {
  return NICKNAMES[first] || first;
}

/**
 * Remove all spaces from a name to create a spaceless key.
 * Catches "Tonyricco" vs "Tony Ricco", "GMJetter" vs "GM Jetter".
 */
function spacelessKey(name: string): string {
  return name.replace(/\s+/g, "");
}

function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Check if two persons likely refer to the same individual.
 * Compares normalized names, aliases, and checks for substring/prefix matches.
 */
export function isSamePerson(a: Person, b: Person): boolean {
  const normA = normalizeName(a.name);
  const normB = normalizeName(b.name);

  // Skip single-word names to avoid transitive chain merges
  const partsA = normA.split(" ").filter(Boolean);
  const partsB = normB.split(" ").filter(Boolean);
  if (partsA.length < 2 || partsB.length < 2) return false;

  // Exact match after normalization
  if (normA === normB) return true;

  // Spaceless match: "Tony Ricco" vs "Tonyricco" (after normalization)
  if (normA.length >= 6 && spacelessKey(normA) === spacelessKey(normB)) return true;

  // OCR space collapse match: "Jeff Pa liuca" → "Jeff Paliuca" vs "Jeff Pagliuca"
  const collapsedA = collapseOCRSpaces(normA);
  const collapsedB = collapseOCRSpaces(normB);
  if (collapsedA === collapsedB) return true;

  // Sorted parts match (handles reversed order: "maxwell ghislaine" vs "ghislaine maxwell")
  const sortedA = [...partsA].sort().join(" ");
  const sortedB = [...partsB].sort().join(" ");
  if (sortedA === sortedB) return true;

  // Extract first/last names, skipping leading single-char initials
  // "R. Alexander Acosta" → parts ["r", "alexander", "acosta"] → realFirst = "alexander"
  const lastA = partsA[partsA.length - 1];
  const lastB = partsB[partsB.length - 1];
  const firstA = partsA[0];
  const firstB = partsB[0];
  const realFirstA = partsA.find(p => p.length >= 2) ?? firstA;
  const realFirstB = partsB.find(p => p.length >= 2) ?? firstB;

  if (lastA === lastB && lastA.length >= 3) {
    // Prefix match (handles "J." vs "James", "Alex" vs "Alexander")
    if (firstA.startsWith(firstB) || firstB.startsWith(firstA)) return true;
    // Fuzzy match (handles typos like "ghisaine" vs "ghislaine")
    if (firstA.length >= 4 && firstB.length >= 4 && editDistance(firstA, firstB) <= 2) return true;
    // Nickname match (handles "Bob" vs "Robert", "Jes" vs "James")
    if (canonicalFirstName(firstA) === canonicalFirstName(firstB)) return true;
    // One canonical first resolves to a prefix of the other (handles "Alex"→"alexander" matching "Alexander")
    const cA = canonicalFirstName(firstA), cB = canonicalFirstName(firstB);
    if (cA.startsWith(cB) || cB.startsWith(cA)) return true;
  }

  // Same last name + first non-initial name matches (handles "R. Alexander Acosta" vs "Alex Acosta")
  if (lastA === lastB && lastA.length >= 3 && (realFirstA !== firstA || realFirstB !== firstB)) {
    const rfA = realFirstA, rfB = realFirstB;
    if (rfA.length >= 3 && rfB.length >= 3) {
      if (rfA === rfB) return true;
      if (rfA.startsWith(rfB) || rfB.startsWith(rfA)) return true;
      if (canonicalFirstName(rfA) === canonicalFirstName(rfB)) return true;
      const rcA = canonicalFirstName(rfA), rcB = canonicalFirstName(rfB);
      if (rcA.startsWith(rcB) || rcB.startsWith(rcA)) return true;
    }
  }

  // Fuzzy last name match (edit distance ≤ 1 for last names ≥ 5 chars)
  if (lastA.length >= 5 && lastB.length >= 5 && editDistance(lastA, lastB) <= 1) {
    if (firstA === firstB && firstA.length >= 3) return true;
    if (firstA.length >= 3 && firstB.length >= 3) {
      if (firstA.startsWith(firstB) || firstB.startsWith(firstA)) return true;
    }
    // Nickname-resolved first names match
    if (canonicalFirstName(firstA) === canonicalFirstName(firstB)) return true;
  }

  // Same canonical first name + fuzzy last name (edit distance ≤ 2)
  // Catches "Megan Markel" vs "Meghan Markle" (nickname match + transposition in last name)
  // Requires last names ≥ 6 chars to avoid "Moyer"/"Myers" and "Furth"/"Furst" false positives
  if (lastA.length >= 6 && lastB.length >= 6 && editDistance(lastA, lastB) <= 2) {
    const cA = canonicalFirstName(firstA), cB = canonicalFirstName(firstB);
    if (cA === cB && cA.length >= 3) return true;
  }

  // Last name prefix match: one last name starts with the other (handles "Mennin" vs "Menninger")
  // Requires same first name and the shorter last name to be ≥ 4 chars
  if (firstA === firstB && firstA.length >= 3) {
    const shortLast = lastA.length <= lastB.length ? lastA : lastB;
    const longLast = lastA.length <= lastB.length ? lastB : lastA;
    if (shortLast.length >= 4 && longLast.startsWith(shortLast)) return true;
  }

  // One name contains the other's full name (handles "David Perry QC" vs "David Perry")
  // Requires prefix containment OR matching first names — avoids "Jose Matthew Rogers" ≠ "Matthew Rogers"
  if (normA.length >= 8 && normB.length >= 8) {
    if (normA.length !== normB.length) {
      const shorter = normA.length < normB.length ? normA : normB;
      const longer = normA.length < normB.length ? normB : normA;
      const shorterParts = shorter.split(" ").filter(Boolean);
      const longerParts = longer.split(" ").filter(Boolean);
      if (shorterParts.length >= 2 && longer.includes(shorter)) {
        // The shorter name appears at the START of the longer (suffix added: "David Perry" → "David Perry QC")
        if (longer.startsWith(shorter)) return true;
        // Same first names (extra words added around the name)
        if (shorterParts[0] === longerParts[0]) return true;
      }
    }
  }

  // Full-name edit distance for longer names (catches "Bobbi Stemheim" vs "Bobbi Stemhenn")
  // Requires same first name OR same last name to avoid false positives like "Michael Miller"/"Michael Milken"
  if (normA.length >= 10 && normB.length >= 10 && editDistance(normA, normB) <= 2) {
    if (firstA === firstB && lastA.length >= 4 && lastB.length >= 4 && editDistance(lastA, lastB) <= 2) return true;
    if (lastA === lastB && firstA.length >= 3 && firstB.length >= 3 && editDistance(firstA, firstB) <= 2) return true;
  }

  // Check against aliases
  const aliasesA = (a.aliases ?? []).map(normalizeName);
  const aliasesB = (b.aliases ?? []).map(normalizeName);

  if (aliasesA.includes(normB) || aliasesB.includes(normA)) return true;

  return false;
}

/**
 * Deduplicate a list of persons, returning canonical records and an ID mapping.
 * For each group of duplicates, the one with the most connections is kept as canonical.
 */
function deduplicatePersons(allPersons: Person[]): { deduped: Person[]; idMap: Map<number, number> } {
  const groups: Person[][] = [];
  const assigned = new Set<number>();

  for (const person of allPersons) {
    if (assigned.has(person.id)) continue;

    const group = [person];
    assigned.add(person.id);

    for (const other of allPersons) {
      if (assigned.has(other.id)) continue;
      if (isSamePerson(person, other)) {
        group.push(other);
        assigned.add(other.id);
      }
    }

    groups.push(group);
  }

  const deduped: Person[] = [];
  const idMap = new Map<number, number>();

  for (const group of groups) {
    // Pick the person with the most connections as canonical
    group.sort((a, b) => (b.connectionCount + b.documentCount) - (a.connectionCount + a.documentCount));
    const canonical = group[0];

    // Merge connection and document counts from duplicates
    let totalConns = 0;
    let totalDocs = 0;
    for (const p of group) {
      totalConns += p.connectionCount;
      totalDocs += p.documentCount;
      if (p.id !== canonical.id) {
        idMap.set(p.id, canonical.id);
      }
    }

    deduped.push({
      ...canonical,
      connectionCount: totalConns,
      documentCount: totalDocs,
    });
  }

  return { deduped, idMap };
}

// Server-side caches for expensive aggregate queries
const sidebarCountsCache = createCache<{
  documents: { total: number; byType: Record<string, number> };
  media: { images: number; videos: number };
  persons: number;
  events: number;
  connections: number;
}>(5 * 60 * 1000);

const documentFiltersCache = createCache<{ types: string[]; dataSets: string[]; mediaTypes: string[] }>(10 * 60 * 1000);

const statsCache = createCache<{ personCount: number; documentCount: number; connectionCount: number; eventCount: number }>(5 * 60 * 1000);

const networkDataCache = createCache<{
  persons: Person[];
  connections: any[];
  timelineYearRange: [number, number];
  personYears: Record<number, [number, number]>;
}>(5 * 60 * 1000);

const personsCache = createCache<Person[]>(5 * 60 * 1000);
const timelineEventsCache = createCache<TimelineEvent[]>(5 * 60 * 1000);

const countCacheMap = new Map<string, { count: number; cachedAt: number }>();
const COUNT_TTL = 60_000;

// Cache for first-page unfiltered documents (dashboard + "All Documents" initial load)
const firstPageDocsCache = createCache<Document[]>(5 * 60 * 1000);

// Per-ID caches for detail pages
const DETAIL_CACHE_TTL = 5 * 60 * 1000;
const MAX_DETAIL_CACHE = 500;
const documentDetailCache = new Map<number, { data: any; cachedAt: number }>();
const personDetailCache = new Map<number, { data: any; cachedAt: number }>();

// Adjacent document IDs cache
const ADJACENT_CACHE_TTL = 10 * 60 * 1000;
const adjacentCache = new Map<number, { data: { prev: number | null; next: number | null }; cachedAt: number }>();

// Search results cache
const SEARCH_CACHE_TTL = 60_000;
const MAX_SEARCH_CACHE = 100;
const searchCache = new Map<string, { data: { persons: Person[]; documents: Document[]; events: TimelineEvent[] }; cachedAt: number }>();

function getFromMapCache<T>(cache: Map<number, { data: T; cachedAt: number }>, id: number, ttl: number): T | null {
  const entry = cache.get(id);
  if (entry && Date.now() - entry.cachedAt < ttl) return entry.data;
  return null;
}

function evictExpired<K, V extends { cachedAt: number }>(cache: Map<K, V>, ttl: number, maxSize: number): void {
  if (cache.size > maxSize) {
    const now = Date.now();
    cache.forEach((v, k) => { if (now - v.cachedAt > ttl) cache.delete(k); });
  }
}

export class DatabaseStorage implements IStorage {
  async getPersons(): Promise<Person[]> {
    return personsCache.get(() =>
      db.select().from(persons).orderBy(desc(persons.documentCount))
    );
  }

  async getPerson(id: number): Promise<Person | undefined> {
    const [person] = await db.select().from(persons).where(eq(persons.id, id));
    return person || undefined;
  }

  async getPersonWithDetails(id: number): Promise<any> {
    const cached = getFromMapCache(personDetailCache, id, DETAIL_CACHE_TTL);
    if (cached) return cached;

    const person = await this.getPerson(id);
    if (!person) return undefined;

    const pDocs = await db
      .select({
        id: documents.id,
        title: documents.title,
        description: documents.description,
        documentType: documents.documentType,
        dataSet: documents.dataSet,
        sourceUrl: documents.sourceUrl,
        datePublished: documents.datePublished,
        dateOriginal: documents.dateOriginal,
        pageCount: documents.pageCount,
        isRedacted: documents.isRedacted,
        keyExcerpt: documents.keyExcerpt,
        tags: documents.tags,
        context: personDocuments.context,
        mentionType: personDocuments.mentionType,
      })
      .from(personDocuments)
      .innerJoin(documents, eq(personDocuments.documentId, documents.id))
      .where(eq(personDocuments.personId, id));

    const connsFrom = await db
      .select()
      .from(connections)
      .where(eq(connections.personId1, id));

    const connsTo = await db
      .select()
      .from(connections)
      .where(eq(connections.personId2, id));

    const personIds = new Set<number>();
    for (const conn of connsFrom) personIds.add(conn.personId2);
    for (const conn of connsTo) personIds.add(conn.personId1);

    const connPersons = personIds.size > 0
      ? await db.select().from(persons).where(inArray(persons.id, Array.from(personIds)))
      : [];
    const personMap = new Map(connPersons.map(p => [p.id, p]));

    const allConns = [];
    for (const conn of connsFrom) {
      const otherPerson = personMap.get(conn.personId2);
      if (otherPerson) {
        allConns.push({ ...conn, person: otherPerson });
      }
    }
    for (const conn of connsTo) {
      const otherPerson = personMap.get(conn.personId1);
      if (otherPerson) {
        allConns.push({ ...conn, person: otherPerson });
      }
    }

    const result = {
      ...person,
      documents: pDocs,
      connections: allConns,
    };

    personDetailCache.set(id, { data: result, cachedAt: Date.now() });
    evictExpired(personDetailCache, DETAIL_CACHE_TTL, MAX_DETAIL_CACHE);
    return result;
  }

  async createPerson(person: InsertPerson): Promise<Person> {
    const [created] = await db.insert(persons).values(person).returning();
    return created;
  }

  async getDocuments(): Promise<Document[]> {
    return db.select().from(documents).orderBy(asc(documents.id));
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc || undefined;
  }

  async getDocumentWithDetails(id: number): Promise<any> {
    const cached = getFromMapCache(documentDetailCache, id, DETAIL_CACHE_TTL);
    if (cached) return cached;

    const doc = await this.getDocument(id);
    if (!doc) return undefined;

    const pDocs = await db
      .select({
        id: persons.id,
        name: persons.name,
        aliases: persons.aliases,
        role: persons.role,
        description: persons.description,
        status: persons.status,
        nationality: persons.nationality,
        occupation: persons.occupation,
        imageUrl: persons.imageUrl,
        documentCount: persons.documentCount,
        connectionCount: persons.connectionCount,
        category: persons.category,
        mentionType: personDocuments.mentionType,
        context: personDocuments.context,
      })
      .from(personDocuments)
      .innerJoin(persons, eq(personDocuments.personId, persons.id))
      .where(eq(personDocuments.documentId, id));

    const result = {
      ...doc,
      persons: pDocs,
    };

    documentDetailCache.set(id, { data: result, cachedAt: Date.now() });
    evictExpired(documentDetailCache, DETAIL_CACHE_TTL, MAX_DETAIL_CACHE);
    return result;
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [created] = await db.insert(documents).values(document).returning();
    return created;
  }

  async getConnections(): Promise<Connection[]> {
    return db.select().from(connections);
  }

  async createConnection(connection: InsertConnection): Promise<Connection> {
    const [created] = await db.insert(connections).values(connection).returning();
    return created;
  }

  async createPersonDocument(pd: InsertPersonDocument): Promise<PersonDocument> {
    const [created] = await db.insert(personDocuments).values(pd).returning();
    return created;
  }

  async getTimelineEvents(): Promise<TimelineEvent[]> {
    return timelineEventsCache.get(() =>
      db.select().from(timelineEvents)
        .where(sql`${timelineEvents.date} >= '1950' AND ${timelineEvents.significance} >= 3`)
        .orderBy(asc(timelineEvents.date))
    );
  }

  async createTimelineEvent(event: InsertTimelineEvent): Promise<TimelineEvent> {
    const [created] = await db.insert(timelineEvents).values(event).returning();
    return created;
  }

  async getStats() {
    return statsCache.get(async () => {
      const [personResult, documentResult, connectionResult, eventResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(persons),
        db.select({ count: sql<number>`count(*)::int` }).from(documents),
        db.select({ count: sql<number>`count(*)::int` }).from(connections),
        db.select({ count: sql<number>`count(*)::int` }).from(timelineEvents).where(sql`${timelineEvents.date} >= '1950' AND ${timelineEvents.significance} >= 3`),
      ]);
      return {
        personCount: personResult[0].count,
        documentCount: documentResult[0].count,
        connectionCount: connectionResult[0].count,
        eventCount: eventResult[0].count,
      };
    });
  }

  async getNetworkData() {
    return networkDataCache.get(async () => {
    const allPersons = await this.getPersons();
    const allConnections = await db.select().from(connections);

    const personMap = new Map(allPersons.map(p => [p.id, p]));

    const seenConnections = new Set<string>();
    const enrichedConnections: Array<typeof allConnections[number] & { person1Name: string; person2Name: string }> = [];

    for (const conn of allConnections) {
      const p1 = personMap.get(conn.personId1);
      const p2 = personMap.get(conn.personId2);
      if (!p1 || !p2) continue;
      if (conn.personId1 === conn.personId2) continue;

      const pairKey = conn.personId1 < conn.personId2
        ? `${conn.personId1}-${conn.personId2}-${conn.connectionType}`
        : `${conn.personId2}-${conn.personId1}-${conn.connectionType}`;
      if (seenConnections.has(pairKey)) continue;
      seenConnections.add(pairKey);

      enrichedConnections.push({
        ...conn,
        person1Name: p1.name,
        person2Name: p2.name,
      });
    }

    // Compute timeline year ranges for the time slider
    const [yearRangeRow] = await db.select({
      minDate: sql<string>`min(${timelineEvents.date})`,
      maxDate: sql<string>`max(${timelineEvents.date})`,
    }).from(timelineEvents);

    const minYear = yearRangeRow?.minDate ? parseInt(yearRangeRow.minDate.slice(0, 4)) || 1990 : 1990;
    const maxYear = yearRangeRow?.maxDate ? parseInt(yearRangeRow.maxDate.slice(0, 4)) || 2025 : 2025;

    // Per-person year ranges from timeline events
    const personYearRows = await db.select({
      pid: sql<number>`unnest(${timelineEvents.personIds})`,
      minDate: sql<string>`min(${timelineEvents.date})`,
      maxDate: sql<string>`max(${timelineEvents.date})`,
    }).from(timelineEvents)
      .groupBy(sql`unnest(${timelineEvents.personIds})`);

    const personYears: Record<number, [number, number]> = {};
    for (const row of personYearRows) {
      const earliest = parseInt(row.minDate.slice(0, 4)) || minYear;
      const latest = parseInt(row.maxDate.slice(0, 4)) || maxYear;
      personYears[row.pid] = [earliest, latest];
    }

    return {
      persons: allPersons,
      connections: enrichedConnections,
      timelineYearRange: [minYear, maxYear] as [number, number],
      personYears,
    };
    });
  }

  async search(query: string) {
    const normalizedQuery = query.toLowerCase().trim();
    const cachedResult = searchCache.get(normalizedQuery);
    if (cachedResult && Date.now() - cachedResult.cachedAt < SEARCH_CACHE_TTL) {
      return cachedResult.data;
    }

    const searchPattern = `%${escapeLikePattern(query)}%`;

    const [matchedPersons, matchedDocuments, matchedEvents] = await Promise.all([
      db.select().from(persons).where(
        or(
          ilike(persons.name, searchPattern),
          ilike(persons.occupation, searchPattern),
          ilike(persons.description, searchPattern),
          ilike(persons.role, searchPattern)
        )
      ).limit(20),

      db.select().from(documents).where(
        or(
          ilike(documents.title, searchPattern),
          ilike(documents.description, searchPattern),
          ilike(documents.keyExcerpt, searchPattern),
          ilike(documents.documentType, searchPattern)
        )
      ).limit(20),

      db.select().from(timelineEvents).where(
        or(
          ilike(timelineEvents.title, searchPattern),
          ilike(timelineEvents.description, searchPattern),
          ilike(timelineEvents.category, searchPattern)
        )
      ).limit(20),
    ]);

    const result = {
      persons: matchedPersons,
      documents: matchedDocuments,
      events: matchedEvents,
    };

    searchCache.set(normalizedQuery, { data: result, cachedAt: Date.now() });
    evictExpired(searchCache, SEARCH_CACHE_TTL, MAX_SEARCH_CACHE);
    return result;
  }

  async getPersonsPaginated(page: number, limit: number): Promise<{ data: Person[]; total: number; page: number; totalPages: number }> {
    // Derive from cached full persons list instead of hitting DB
    const allPersons = await this.getPersons();
    const total = allPersons.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const data = allPersons.slice(offset, offset + limit);
    return { data, total, page, totalPages };
  }

  async getDocumentsPaginated(page: number, limit: number): Promise<{ data: Document[]; total: number; page: number; totalPages: number }> {
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(documents);
    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const data = await db.select().from(documents).orderBy(asc(documents.id)).limit(limit).offset(offset);
    return { data, total, page, totalPages };
  }

  async getDocumentsFiltered(opts: {
    page: number;
    limit: number;
    search?: string;
    type?: string;
    dataSet?: string;
    redacted?: string;
    mediaType?: string;
  }): Promise<{ data: Document[]; total: number; page: number; totalPages: number }> {
    const conditions = [];

    if (opts.search) {
      const searchPattern = `%${escapeLikePattern(opts.search)}%`;
      conditions.push(
        or(
          ilike(documents.title, searchPattern),
          ilike(documents.description, searchPattern),
          ilike(documents.keyExcerpt, searchPattern),
        )
      );
    }

    if (opts.type) {
      conditions.push(eq(documents.documentType, opts.type));
    }

    if (opts.dataSet) {
      conditions.push(eq(documents.dataSet, opts.dataSet));
    }

    if (opts.redacted === "redacted") {
      conditions.push(eq(documents.isRedacted, true));
    } else if (opts.redacted === "unredacted") {
      conditions.push(eq(documents.isRedacted, false));
    }

    if (opts.mediaType) {
      conditions.push(eq(documents.mediaType, opts.mediaType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // For unfiltered queries, use the cached stats total to avoid COUNT(*) on 1.38M rows
    let total: number;
    if (conditions.length === 0) {
      const stats = await this.getStats();
      total = stats.documentCount;

      // For first page with no filters, serve from cache
      if (opts.page === 1) {
        const cachedFirstPage = await firstPageDocsCache.get(() =>
          db.select().from(documents).orderBy(asc(documents.id)).limit(50)
        );
        const data = cachedFirstPage.slice(0, opts.limit);
        const totalPages = Math.ceil(total / opts.limit);
        return { data, total, page: 1, totalPages };
      }
    } else {
      const cacheKey = JSON.stringify([opts.search, opts.type, opts.dataSet, opts.redacted, opts.mediaType]);
      const cached = countCacheMap.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < COUNT_TTL) {
        total = cached.count;
      } else {
        const [countResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(whereClause);
        total = countResult.count;
        countCacheMap.set(cacheKey, { count: total, cachedAt: Date.now() });
        if (countCacheMap.size > 200) {
          const now = Date.now();
          countCacheMap.forEach((v, k) => {
            if (now - v.cachedAt > COUNT_TTL) countCacheMap.delete(k);
          });
        }
      }
    }
    const totalPages = Math.ceil(total / opts.limit);
    const offset = (opts.page - 1) * opts.limit;
    const data = await db
      .select()
      .from(documents)
      .where(whereClause)
      .orderBy(asc(documents.id))
      .limit(opts.limit)
      .offset(offset);

    return { data, total, page: opts.page, totalPages };
  }

  async getDocumentFilters(): Promise<{ types: string[]; dataSets: string[]; mediaTypes: string[] }> {
    return documentFiltersCache.get(async () => {
    const [typeRows, dataSetRows, mediaTypeRows] = await Promise.all([
      db.selectDistinct({ documentType: documents.documentType })
        .from(documents)
        .orderBy(asc(documents.documentType)),
      db.selectDistinct({ dataSet: documents.dataSet })
        .from(documents)
        .where(sql`${documents.dataSet} IS NOT NULL`)
        .orderBy(asc(documents.dataSet)),
      db.selectDistinct({ mediaType: documents.mediaType })
        .from(documents)
        .where(sql`${documents.mediaType} IS NOT NULL`)
        .orderBy(asc(documents.mediaType)),
    ]);

    return {
      types: typeRows.map((r) => r.documentType),
      dataSets: dataSetRows.map((r) => r.dataSet!),
      mediaTypes: mediaTypeRows.map((r) => r.mediaType!),
    };
    });
  }

  async getAdjacentDocumentIds(id: number): Promise<{ prev: number | null; next: number | null }> {
    const cached = getFromMapCache(adjacentCache, id, ADJACENT_CACHE_TTL);
    if (cached) return cached;

    const [prevRow] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(sql`${documents.id} < ${id}`)
      .orderBy(desc(documents.id))
      .limit(1);

    const [nextRow] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(sql`${documents.id} > ${id}`)
      .orderBy(asc(documents.id))
      .limit(1);

    const result = {
      prev: prevRow?.id ?? null,
      next: nextRow?.id ?? null,
    };

    adjacentCache.set(id, { data: result, cachedAt: Date.now() });
    evictExpired(adjacentCache, ADJACENT_CACHE_TTL, MAX_DETAIL_CACHE);
    return result;
  }

  async getSidebarCounts(): Promise<{
    documents: { total: number; byType: Record<string, number> };
    media: { images: number; videos: number };
    persons: number;
    events: number;
    connections: number;
  }> {
    return sidebarCountsCache.get(async () => {
    const [docCounts, mediaCounts, entityCounts] = await Promise.all([
      // Document counts by type in a single query
      db.select({
        documentType: documents.documentType,
        count: sql<number>`count(*)::int`,
      }).from(documents).groupBy(documents.documentType),

      // Media counts
      db.select({
        images: sql<number>`count(*) filter (where ${documents.documentType} = 'photograph')::int`,
        videos: sql<number>`count(*) filter (where ${documents.documentType} = 'video')::int`,
      }).from(documents),

      // Entity counts
      Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(persons),
        db.select({ count: sql<number>`count(*)::int` }).from(timelineEvents).where(sql`${timelineEvents.date} >= '1950' AND ${timelineEvents.significance} >= 3`),
        db.select({ count: sql<number>`count(*)::int` }).from(connections),
      ]),
    ]);

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of docCounts) {
      byType[row.documentType] = row.count;
      total += row.count;
    }

    return {
      documents: { total, byType },
      media: { images: mediaCounts[0].images, videos: mediaCounts[0].videos },
      persons: entityCounts[0][0].count,
      events: entityCounts[1][0].count,
      connections: entityCounts[2][0].count,
    };
    });
  }

  async getBookmarks(): Promise<Bookmark[]> {
    return db.select().from(bookmarks).orderBy(desc(bookmarks.createdAt));
  }

  async createBookmark(bookmark: InsertBookmark): Promise<Bookmark> {
    // Cast needed: drizzle-zod's InsertBookmark resolves to {} due to .omit() type issue
    const bk = bookmark as { userId?: string; entityType: string; entityId?: number | null; searchQuery?: string | null; label?: string | null };
    const [created] = await db.insert(bookmarks).values(bookmark)
      .onConflictDoNothing()
      .returning();
    if (!created) {
      // Duplicate bookmark — return the existing one
      const existing = await db.select().from(bookmarks).where(
        bk.searchQuery
          ? and(
              eq(bookmarks.userId, bk.userId ?? "anonymous"),
              eq(bookmarks.entityType, bk.entityType),
              eq(bookmarks.searchQuery, bk.searchQuery),
            )
          : and(
              eq(bookmarks.userId, bk.userId ?? "anonymous"),
              eq(bookmarks.entityType, bk.entityType),
              eq(bookmarks.entityId, bk.entityId!),
            )
      );
      return existing[0];
    }
    return created;
  }

  async deleteBookmark(id: number): Promise<boolean> {
    const result = await db.delete(bookmarks).where(eq(bookmarks.id, id)).returning();
    return result.length > 0;
  }

  async getPipelineJobs(status?: string): Promise<PipelineJob[]> {
    if (status) {
      return db.select().from(pipelineJobs).where(eq(pipelineJobs.status, status)).orderBy(desc(pipelineJobs.createdAt));
    }
    return db.select().from(pipelineJobs).orderBy(desc(pipelineJobs.createdAt));
  }

  async getPipelineStats(): Promise<{ pending: number; running: number; completed: number; failed: number }> {
    const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(pipelineJobs).where(eq(pipelineJobs.status, "pending"));
    const [running] = await db.select({ count: sql<number>`count(*)::int` }).from(pipelineJobs).where(eq(pipelineJobs.status, "running"));
    const [completed] = await db.select({ count: sql<number>`count(*)::int` }).from(pipelineJobs).where(eq(pipelineJobs.status, "completed"));
    const [failed] = await db.select({ count: sql<number>`count(*)::int` }).from(pipelineJobs).where(eq(pipelineJobs.status, "failed"));
    return {
      pending: pending.count,
      running: running.count,
      completed: completed.count,
      failed: failed.count,
    };
  }

  async getBudgetSummary(): Promise<{ totalCostCents: number; totalInputTokens: number; totalOutputTokens: number; byModel: Record<string, number> }> {
    const [totals] = await db.select({
      totalCostCents: sql<number>`coalesce(sum(${budgetTracking.costCents}), 0)::int`,
      totalInputTokens: sql<number>`coalesce(sum(${budgetTracking.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum(${budgetTracking.outputTokens}), 0)::int`,
    }).from(budgetTracking);

    const modelRows = await db.select({
      model: budgetTracking.model,
      cost: sql<number>`coalesce(sum(${budgetTracking.costCents}), 0)::int`,
    }).from(budgetTracking).groupBy(budgetTracking.model);

    const byModel: Record<string, number> = {};
    for (const row of modelRows) {
      byModel[row.model] = row.cost;
    }

    return {
      totalCostCents: totals.totalCostCents,
      totalInputTokens: totals.totalInputTokens,
      totalOutputTokens: totals.totalOutputTokens,
      byModel,
    };
  }

  async getAIAnalysisList(): Promise<AIAnalysisListItem[]> {
    const allFiles = await readAllAnalysisFiles();

    const items: AIAnalysisListItem[] = allFiles.map((data) => ({
      fileName: data.fileName ?? "",
      dataSet: data.dataSet ?? "",
      documentType: data.documentType ?? "",
      summary: (data.summary ?? "").slice(0, 200),
      personCount: Array.isArray(data.persons) ? data.persons.length : 0,
      connectionCount: Array.isArray(data.connections) ? data.connections.length : 0,
      eventCount: Array.isArray(data.events) ? data.events.length : 0,
      locationCount: Array.isArray(data.locations) ? data.locations.length : 0,
      keyFactCount: Array.isArray(data.keyFacts) ? data.keyFacts.length : 0,
      tier: data.tier ?? 0,
      costCents: data.costCents ?? 0,
      analyzedAt: data.analyzedAt ?? "",
    }));

    items.sort((a, b) => (b.analyzedAt > a.analyzedAt ? 1 : b.analyzedAt < a.analyzedAt ? -1 : 0));
    return items;
  }

  async getAIAnalysis(fileName: string): Promise<AIAnalysisDocument | null> {
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return null;
    }

    const sanitizedName = fileName.endsWith(".json") ? fileName : fileName + ".json";
    const filePath = path.join(AI_ANALYZED_DIR, sanitizedName);

    if (!path.resolve(filePath).startsWith(AI_ANALYZED_DIR)) {
      return null;
    }

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as AIAnalysisDocument;
    } catch {
      return null;
    }
  }

  async getAIAnalysisAggregate(): Promise<AIAnalysisAggregate> {
    const allData = await readAllAnalysisFiles();

    if (allData.length === 0) {
      return {
        topPersons: [],
        topLocations: [],
        connectionTypes: [],
        documentTypes: [],
        totalDocuments: 0,
        totalPersons: 0,
        totalConnections: 0,
        totalEvents: 0,
      };
    }

    const personMap = new Map<string, { mentionCount: number; documentCount: number; category: string }>();
    const locationMap = new Map<string, number>();
    const connectionTypeMap = new Map<string, number>();
    const documentTypeMap = new Map<string, number>();
    let totalConnections = 0;
    let totalEvents = 0;

    for (const data of allData) {
      // Aggregate persons
      if (Array.isArray(data.persons)) {
        const seenInDoc = new Set<string>();
        for (const person of data.persons) {
          const name = person.name ?? "";
          if (!name) continue;
          const existing = personMap.get(name) ?? { mentionCount: 0, documentCount: 0, category: person.category ?? "" };
          existing.mentionCount += person.mentionCount ?? 1;
          if (!seenInDoc.has(name)) {
            existing.documentCount += 1;
            seenInDoc.add(name);
          }
          if (person.category) existing.category = person.category;
          personMap.set(name, existing);
        }
      }

      // Aggregate locations
      if (Array.isArray(data.locations)) {
        const seenInDoc = new Set<string>();
        for (const loc of data.locations) {
          const location = typeof loc === "string" ? loc : ((loc as any).location ?? (loc as any).name ?? "");
          if (!location || seenInDoc.has(location)) continue;
          seenInDoc.add(location);
          locationMap.set(location, (locationMap.get(location) ?? 0) + 1);
        }
      }

      // Aggregate connection types
      if (Array.isArray(data.connections)) {
        totalConnections += data.connections.length;
        for (const conn of data.connections) {
          const relType = conn.relationshipType ?? conn.type ?? "unknown";
          connectionTypeMap.set(relType, (connectionTypeMap.get(relType) ?? 0) + 1);
        }
      }

      // Aggregate document types
      const docType = data.documentType ?? "unknown";
      documentTypeMap.set(docType, (documentTypeMap.get(docType) ?? 0) + 1);

      // Aggregate events
      if (Array.isArray(data.events)) {
        totalEvents += data.events.length;
      }
    }

    const topPersons = Array.from(personMap.entries())
      .map(([name, v]) => ({ name, mentionCount: v.mentionCount, documentCount: v.documentCount, category: v.category }))
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 20);

    const topLocations = Array.from(locationMap.entries())
      .map(([location, documentCount]) => ({ location, documentCount }))
      .sort((a, b) => b.documentCount - a.documentCount)
      .slice(0, 20);

    const connectionTypes = Array.from(connectionTypeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const documentTypes = Array.from(documentTypeMap.entries())
      .map(([type, count]) => ({ type, count }));

    return {
      topPersons,
      topLocations,
      connectionTypes,
      documentTypes,
      totalDocuments: allData.length,
      totalPersons: personMap.size,
      totalConnections,
      totalEvents,
    };
  }
}

export const storage = new DatabaseStorage();
