import {
  persons, documents, documentPages, connections, personDocuments, timelineEvents,
  pipelineJobs, budgetTracking, bookmarks, pageViews, documentVotes, personVotes, searchQueries,
  aiAnalyses, aiAnalysisPersons,
  type Person, type InsertPerson,
  type Document, type InsertDocument,
  type Connection, type InsertConnection,
  type PersonDocument, type InsertPersonDocument,
  type TimelineEvent, type InsertTimelineEvent,
  type PipelineJob, type BudgetTracking,
  type Bookmark, type InsertBookmark,
  type DocumentVote, type InsertDocumentVote,
  type PersonVote, type InsertPersonVote,
  type AIAnalysisListItem, type AIAnalysisAggregate, type AIAnalysisDocument,
  type AIAnalysisPerson, type AIAnalysisConnection, type AIAnalysisEvent,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gt, ilike, or, sql, desc, asc, inArray, isNotNull, ne, type SQL } from "drizzle-orm";
import { isR2Configured } from "./r2";
import { isTypesenseConfigured, typesenseDocumentSearch, typesenseSearchPages, typesenseSearchPersons } from "./typesense";

/** Map raw SQL row (snake_case) to Document (camelCase) */
function mapRowToDocument(row: any): Document {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    documentType: row.document_type,
    dataSet: row.data_set,
    sourceUrl: row.source_url,
    datePublished: row.date_published,
    dateOriginal: row.date_original,
    pageCount: row.page_count,
    isRedacted: row.is_redacted,
    keyExcerpt: row.key_excerpt,
    tags: row.tags,
    mediaType: row.media_type,
    processingStatus: row.processing_status,
    aiAnalysisStatus: row.ai_analysis_status,
    fileSizeBytes: row.file_size_bytes,
    fileHash: row.file_hash,
    localPath: row.local_path,
    r2Key: row.r2_key,
    eftaNumber: row.efta_number,
    mimeType: row.mime_type,
    extractedTextLength: row.extracted_text_length,
    aiCostCents: row.ai_cost_cents,
  };
}

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
  getConnectionsPaginated(opts: {
    page: number; limit: number; type?: string; personId?: number; minStrength?: number;
  }): Promise<{ data: (Connection & { person1Name: string; person2Name: string })[]; total: number; page: number; totalPages: number }>;
  getConnectionById(id: number): Promise<(Connection & { person1Name: string; person2Name: string }) | null>;
  getConnectionTypes(): Promise<{ type: string; count: number }[]>;
  createConnection(connection: InsertConnection): Promise<Connection>;

  createPersonDocument(pd: InsertPersonDocument): Promise<PersonDocument>;

  getTimelineEvents(): Promise<TimelineEvent[]>;
  getTimelineFiltered(opts: {
    page: number;
    limit: number;
    category?: string;
    yearFrom?: string;
    yearTo?: string;
    significance?: number;
  }): Promise<{ data: any[]; total: number; page: number; totalPages: number }>;
  createTimelineEvent(event: InsertTimelineEvent): Promise<TimelineEvent>;

  getStats(): Promise<{ personCount: number; documentCount: number; pageCount: number; connectionCount: number; eventCount: number }>;
  getNetworkData(): Promise<{ persons: Person[]; connections: any[]; timelineYearRange: [number, number]; personYears: Record<number, [number, number]> }>;
  search(query: string): Promise<{ persons: Person[]; documents: Document[]; events: TimelineEvent[] }>;
  searchPages(query: string, page: number, limit: number, useOrMode?: boolean, skipCount?: boolean): Promise<{
    results: { documentId: number; title: string; documentType: string; dataSet: string | null; pageNumber: number; headline: string; pageType: string | null }[];
    total: number; page: number; totalPages: number;
  }>;

  getPersonsPaginated(page: number, limit: number): Promise<{ data: Person[]; total: number; page: number; totalPages: number }>;
  getDocumentsPaginated(page: number, limit: number): Promise<{ data: Document[]; total: number; page: number; totalPages: number }>;
  getDocumentsCursor(afterId: number, limit: number): Promise<Document[]>;
  getDocumentsFiltered(opts: { page: number; limit: number; search?: string; type?: string; dataSet?: string; redacted?: string; mediaType?: string; sort?: string; tag?: string }): Promise<{ data: Document[]; total: number; page: number; totalPages: number }>;
  getDocumentFilters(): Promise<{ types: string[]; dataSets: string[]; mediaTypes: string[] }>;
  getAdjacentDocumentIds(id: number): Promise<{ prev: number | null; next: number | null }>;
  getSidebarCounts(): Promise<{
    documents: { total: number; byType: Record<string, number> };
    media: { images: number; videos: number; hiddenVideos: number };
    persons: number;
    events: number;
    connections: number;
  }>;

  getBookmarks(userId?: string): Promise<Bookmark[]>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(id: number): Promise<boolean>;

  getVotes(userId: string): Promise<DocumentVote[]>;
  createVote(vote: InsertDocumentVote): Promise<DocumentVote>;
  deleteVote(id: number): Promise<boolean>;
  getVoteCounts(documentIds: number[]): Promise<Record<number, number>>;
  getMostVotedDocuments(limit: number): Promise<(Document & { voteCount: number })[]>;

  getPersonVotes(userId: string): Promise<PersonVote[]>;
  createPersonVote(vote: InsertPersonVote): Promise<PersonVote>;
  deletePersonVote(id: number): Promise<boolean>;
  getPersonVoteCounts(personIds: number[]): Promise<Record<number, number>>;
  getMostVotedPersons(limit: number): Promise<(Person & { voteCount: number })[]>;

  getPipelineJobs(status?: string): Promise<PipelineJob[]>;
  getPipelineStats(): Promise<{ pending: number; running: number; completed: number; failed: number }>;
  getBudgetSummary(): Promise<{ totalCostCents: number; totalInputTokens: number; totalOutputTokens: number; byModel: Record<string, number> }>;

  getAIAnalysisList(opts: { page: number; limit: number; search?: string; documentType?: string; dataSet?: string }): Promise<{ data: AIAnalysisListItem[]; total: number }>;
  getAIAnalysis(fileName: string): Promise<AIAnalysisDocument | null>;
  getAIAnalysisAggregate(): Promise<AIAnalysisAggregate>;

  recordPageView(entityType: string, entityId: number, sessionId: string): Promise<void>;
  getViewCounts(entityType: string, ids: number[]): Promise<Record<number, number>>;
  getTrendingPersons(limit: number): Promise<(Person & { viewCount: number })[]>;
  getTrendingDocuments(limit: number): Promise<(Document & { viewCount: number })[]>;

  recordSearchQuery(query: string, sessionId: string, resultCount: number): Promise<void>;
  getTrendingSearches(limit: number): Promise<{ query: string; searchCount: number }[]>;
  getZeroResultSearches(limit: number, days?: number): Promise<{ query: string; searchCount: number; lastSearched: string }[]>;
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** On production (R2 configured), only return documents that have been uploaded to R2. Excludes empty files everywhere. */
function r2Filter() {
  const noEmpty = or(sql`${documents.fileSizeBytes} IS NULL`, ne(documents.fileSizeBytes, 0));
  if (isR2Configured()) return and(isNotNull(documents.r2Key), noEmpty);
  return noEmpty;
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
    .replace(/\b(dr|mr|mrs|ms|miss|ii|iii|iv)\b\.?/g, "")
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

  // OCR collapse produces single token → fuzzy match against other name's parts
  // Catches "E stein" (→ "estein") matching "epstein" in "Jeffrey Epstein"
  // Guard: skip when collapsed name came from initial+lastname (e.g. "G. Maxwell" → "gmaxwell")
  // because editDistance("gmaxwell", "maxwell") = 1, which would chain-merge ALL Maxwells
  const collapsedPartsA = collapsedA.split(" ").filter(Boolean);
  const collapsedPartsB = collapsedB.split(" ").filter(Boolean);
  const isInitialA = partsA.length === 2 && partsA[0].length === 1 && partsA[1].length >= 4;
  const isInitialB = partsB.length === 2 && partsB[0].length === 1 && partsB[1].length >= 4;
  if (collapsedPartsA.length === 1 && collapsedPartsA[0].length >= 5 && !isInitialA) {
    for (const part of partsB) {
      if (part.length >= 5 && editDistance(collapsedPartsA[0], part) <= 1) return true;
    }
  }
  if (collapsedPartsB.length === 1 && collapsedPartsB[0].length >= 5 && !isInitialB) {
    for (const part of partsA) {
      if (part.length >= 5 && editDistance(collapsedPartsB[0], part) <= 1) return true;
    }
  }

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
  media: { images: number; videos: number; hiddenVideos: number };
  persons: number;
  events: number;
  connections: number;
}>(5 * 60 * 1000);

const documentFiltersCache = createCache<{ types: string[]; dataSets: string[]; mediaTypes: string[] }>(10 * 60 * 1000);

const statsCache = createCache<{ personCount: number; documentCount: number; pageCount: number; connectionCount: number; eventCount: number }>(5 * 60 * 1000);

const networkDataCache = createCache<{
  persons: Person[];
  connections: any[];
  timelineYearRange: [number, number];
  personYears: Record<number, [number, number]>;
}>(5 * 60 * 1000);

const personsCache = createCache<Person[]>(5 * 60 * 1000);
const timelineEventsCache = createCache<TimelineEvent[]>(5 * 60 * 1000);
const trendingPersonsCache = createCache<(Person & { viewCount: number })[]>(2 * 60 * 1000);
const trendingDocumentsCache = createCache<(Document & { viewCount: number })[]>(2 * 60 * 1000);
const trendingSearchesCache = createCache<{ query: string; searchCount: number }[]>(2 * 60 * 1000);

const countCacheMap = new Map<string, { count: number; cachedAt: number }>();
const COUNT_TTL = 60_000;

// Cache for first-page unfiltered documents (dashboard + "All Documents" initial load)
const firstPageDocsCache = createCache<Document[]>(5 * 60 * 1000);
const aiAggregateCache = createCache<AIAnalysisAggregate>(5 * 60 * 1000);

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

export interface PersonAIMentions {
  keyFacts: string[];
  locations: string[];
  mentionCount: number;
  documentMentions: { fileName: string; context: string; role: string }[];
}

async function getPersonAIMentions(personName: string, aliases: string[]): Promise<PersonAIMentions> {
  const normalizedTarget = normalizeName(personName);
  const normalizedAliases = (aliases ?? []).map(normalizeName);
  const allNormalized = [normalizedTarget, ...normalizedAliases].filter(Boolean);

  if (allNormalized.length === 0) {
    return { keyFacts: [], locations: [], mentionCount: 0, documentMentions: [] };
  }

  const rows = await db.select({
    role: aiAnalysisPersons.role,
    context: aiAnalysisPersons.context,
    personMentionCount: aiAnalysisPersons.mentionCount,
    fileName: aiAnalyses.fileName,
    keyFacts: aiAnalyses.keyFacts,
    locations: aiAnalyses.locations,
  })
    .from(aiAnalysisPersons)
    .innerJoin(aiAnalyses, eq(aiAnalysisPersons.aiAnalysisId, aiAnalyses.id))
    .where(inArray(aiAnalysisPersons.normalizedName, allNormalized));

  const keyFacts: string[] = [];
  const locationsSet = new Set<string>();
  const documentMentions: { fileName: string; context: string; role: string }[] = [];
  let mentionCount = 0;

  for (const row of rows) {
    mentionCount += row.personMentionCount;
    documentMentions.push({
      fileName: row.fileName,
      context: row.context ?? "",
      role: row.role ?? "",
    });

    if (Array.isArray(row.keyFacts)) {
      for (const fact of row.keyFacts as string[]) {
        if (typeof fact === "string" && fact.toLowerCase().includes(personName.toLowerCase())) {
          keyFacts.push(fact);
        }
      }
    }

    if (Array.isArray(row.locations)) {
      for (const loc of row.locations as string[]) {
        if (typeof loc === "string" && loc) locationsSet.add(loc);
      }
    }
  }

  return {
    keyFacts: Array.from(new Set(keyFacts)),
    locations: Array.from(locationsSet),
    mentionCount,
    documentMentions,
  };
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

    // Batch 1: four independent queries in parallel
    const [pDocs, connsFrom, connsTo, personEvents] = await Promise.all([
      db
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
        .where(
          (() => {
            const r2Cond = r2Filter();
            return r2Cond
              ? and(eq(personDocuments.personId, id), r2Cond)
              : eq(personDocuments.personId, id);
          })()
        ),
      db.select().from(connections).where(eq(connections.personId1, id)),
      db.select().from(connections).where(eq(connections.personId2, id)),
      db.select().from(timelineEvents)
        .where(sql`${id} = ANY(${timelineEvents.personIds})`)
        .orderBy(asc(timelineEvents.date)),
    ]);

    const personIds = new Set<number>();
    for (const conn of connsFrom) personIds.add(conn.personId2);
    for (const conn of connsTo) personIds.add(conn.personId1);

    const eventDocIds = new Set<number>();
    const eventPersonIds = new Set<number>();
    for (const e of personEvents) {
      for (const did of e.documentIds ?? []) eventDocIds.add(did);
      for (const pid of e.personIds ?? []) if (pid !== id) eventPersonIds.add(pid);
    }

    // Batch 2: dependent lookups in parallel
    const [connPersons, eventDocRows, eventPersonRows, aiMentions] = await Promise.all([
      personIds.size > 0
        ? db.select().from(persons).where(inArray(persons.id, Array.from(personIds)))
        : Promise.resolve([]),
      eventDocIds.size > 0
        ? db.select({ id: documents.id, title: documents.title })
            .from(documents).where(inArray(documents.id, Array.from(eventDocIds)))
        : Promise.resolve([]),
      eventPersonIds.size > 0
        ? db.select({ id: persons.id, name: persons.name })
            .from(persons).where(inArray(persons.id, Array.from(eventPersonIds)))
        : Promise.resolve([]),
      getPersonAIMentions(person.name, person.aliases ?? []),
    ]);

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

    const eventDocMap = new Map<number, { id: number; title: string }>();
    for (const d of eventDocRows) eventDocMap.set(d.id, d);
    const eventPersonMap = new Map<number, { id: number; name: string }>();
    eventPersonMap.set(id, { id, name: person.name });
    for (const p of eventPersonRows) eventPersonMap.set(p.id, p);

    const enrichedEvents = personEvents.map(e => ({
      ...e,
      persons: (e.personIds ?? []).map(pid => eventPersonMap.get(pid)).filter(Boolean),
      documents: (e.documentIds ?? []).map(did => eventDocMap.get(did)).filter(Boolean),
    }));

    const emailDocCount = pDocs.filter(d => d.documentType === 'email').length;

    const result = {
      ...person,
      documents: pDocs,
      connections: allConns,
      timelineEvents: enrichedEvents,
      aiMentions,
      emailDocCount,
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
    if (!doc) return undefined;
    if (isR2Configured() && !doc.r2Key) return undefined;
    if (doc.fileSizeBytes === 0) return undefined;
    return doc;
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

    // Fetch timeline events that reference this document
    const docEvents = await db.select()
      .from(timelineEvents)
      .where(sql`${id} = ANY(${timelineEvents.documentIds})`)
      .orderBy(asc(timelineEvents.date));

    // Enrich events with person names
    const evtPersonIds = new Set<number>();
    for (const e of docEvents) {
      for (const pid of e.personIds ?? []) evtPersonIds.add(pid);
    }
    const evtPersonMap = new Map<number, { id: number; name: string }>();
    if (evtPersonIds.size > 0) {
      const pRows = await db.select({ id: persons.id, name: persons.name })
        .from(persons).where(inArray(persons.id, Array.from(evtPersonIds)));
      for (const p of pRows) evtPersonMap.set(p.id, p);
    }
    const enrichedDocEvents = docEvents.map(e => ({
      ...e,
      persons: (e.personIds ?? []).map(pid => evtPersonMap.get(pid)).filter(Boolean),
    }));

    // Fetch page-level classifications
    const pageTypes = await db
      .select({
        pageNumber: documentPages.pageNumber,
        pageType: documentPages.pageType,
      })
      .from(documentPages)
      .where(eq(documentPages.documentId, id))
      .orderBy(asc(documentPages.pageNumber));

    const result = {
      ...doc,
      persons: pDocs,
      timelineEvents: enrichedDocEvents,
      pageTypes: pageTypes.filter(p => p.pageType != null),
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

  async getConnectionsPaginated(opts: {
    page: number; limit: number; type?: string; personId?: number; minStrength?: number;
  }): Promise<{ data: (Connection & { person1Name: string; person2Name: string })[]; total: number; page: number; totalPages: number }> {
    const p1 = db.select({ id: persons.id, name: persons.name }).from(persons).as("p1");
    const p2 = db.select({ id: persons.id, name: persons.name }).from(persons).as("p2");

    const conditions: SQL[] = [];
    if (opts.type) conditions.push(eq(connections.connectionType, opts.type));
    if (opts.personId) conditions.push(or(eq(connections.personId1, opts.personId), eq(connections.personId2, opts.personId))!);
    if (opts.minStrength) conditions.push(sql`${connections.strength} >= ${opts.minStrength}`);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(connections).where(whereClause);
    const total = countResult.count;
    const totalPages = Math.ceil(total / opts.limit);
    const offset = (opts.page - 1) * opts.limit;

    const rows = await db
      .select({
        id: connections.id,
        personId1: connections.personId1,
        personId2: connections.personId2,
        connectionType: connections.connectionType,
        description: connections.description,
        strength: connections.strength,
        documentIds: connections.documentIds,
        person1Name: sql<string>`p1.name`,
        person2Name: sql<string>`p2.name`,
      })
      .from(connections)
      .innerJoin(sql`${persons} as p1`, sql`p1.id = ${connections.personId1}`)
      .innerJoin(sql`${persons} as p2`, sql`p2.id = ${connections.personId2}`)
      .where(whereClause)
      .orderBy(desc(connections.strength), asc(connections.id))
      .limit(opts.limit)
      .offset(offset);

    return { data: rows as any, total, page: opts.page, totalPages };
  }

  async getConnectionById(id: number): Promise<(Connection & { person1Name: string; person2Name: string }) | null> {
    const rows = await db
      .select({
        id: connections.id,
        personId1: connections.personId1,
        personId2: connections.personId2,
        connectionType: connections.connectionType,
        description: connections.description,
        strength: connections.strength,
        documentIds: connections.documentIds,
        person1Name: sql<string>`p1.name`,
        person2Name: sql<string>`p2.name`,
      })
      .from(connections)
      .innerJoin(sql`${persons} as p1`, sql`p1.id = ${connections.personId1}`)
      .innerJoin(sql`${persons} as p2`, sql`p2.id = ${connections.personId2}`)
      .where(eq(connections.id, id))
      .limit(1);

    return rows.length > 0 ? rows[0] as any : null;
  }

  async getConnectionTypes(): Promise<{ type: string; count: number }[]> {
    const rows = await db
      .select({
        type: connections.connectionType,
        count: sql<number>`count(*)::int`,
      })
      .from(connections)
      .groupBy(connections.connectionType)
      .orderBy(sql`count(*) desc`);

    return rows;
  }

  async createConnection(connection: InsertConnection): Promise<Connection> {
    const [created] = await db.insert(connections).values(connection).returning();
    return created;
  }

  async createPersonDocument(pd: InsertPersonDocument): Promise<PersonDocument> {
    const [created] = await db.insert(personDocuments).values(pd).returning();
    return created;
  }

  async getTimelineEvents(): Promise<any[]> {
    return timelineEventsCache.get(async () => {
      const events = await db.select().from(timelineEvents)
        .where(sql`${timelineEvents.date} >= '1950' AND ${timelineEvents.significance} >= 3`)
        .orderBy(asc(timelineEvents.date));

      // Collect all unique person IDs and document IDs across events
      const allPersonIds = new Set<number>();
      const allDocumentIds = new Set<number>();
      for (const e of events) {
        for (const pid of e.personIds ?? []) allPersonIds.add(pid);
        for (const did of e.documentIds ?? []) allDocumentIds.add(did);
      }

      // Batch-fetch person names
      const personMap = new Map<number, { id: number; name: string }>();
      if (allPersonIds.size > 0) {
        const personRows = await db.select({ id: persons.id, name: persons.name })
          .from(persons)
          .where(inArray(persons.id, Array.from(allPersonIds)));
        for (const p of personRows) personMap.set(p.id, p);
      }

      // Batch-fetch document titles
      const documentMap = new Map<number, { id: number; title: string }>();
      if (allDocumentIds.size > 0) {
        const docRows = await db.select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(inArray(documents.id, Array.from(allDocumentIds)));
        for (const d of docRows) documentMap.set(d.id, d);
      }

      // Enrich events with resolved person/document info
      return events.map(e => ({
        ...e,
        persons: (e.personIds ?? [])
          .map(pid => personMap.get(pid))
          .filter(Boolean),
        documents: (e.documentIds ?? [])
          .map(did => documentMap.get(did))
          .filter(Boolean),
      }));
    });
  }

  async getTimelineFiltered(opts: {
    page: number;
    limit: number;
    category?: string;
    yearFrom?: string;
    yearTo?: string;
    significance?: number;
  }): Promise<{ data: any[]; total: number; page: number; totalPages: number }> {
    const conditions = [];
    const minSig = opts.significance ?? 3;
    conditions.push(sql`${timelineEvents.significance} >= ${minSig}`);

    if (opts.category) {
      conditions.push(eq(timelineEvents.category, opts.category));
    }
    if (opts.yearFrom) {
      conditions.push(sql`${timelineEvents.date} >= ${opts.yearFrom}`);
    }
    if (opts.yearTo) {
      // Include the full year by comparing against year+1
      const endYear = parseInt(opts.yearTo, 10);
      if (!isNaN(endYear)) {
        conditions.push(sql`${timelineEvents.date} < ${String(endYear + 1)}`);
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timelineEvents)
      .where(whereClause);
    const total = countResult.count;
    const totalPages = Math.ceil(total / opts.limit);
    const offset = (opts.page - 1) * opts.limit;

    const events = await db.select().from(timelineEvents)
      .where(whereClause)
      .orderBy(asc(timelineEvents.date))
      .limit(opts.limit)
      .offset(offset);

    // Enrich only the paginated slice with person/document info
    const allPersonIds = new Set<number>();
    const allDocumentIds = new Set<number>();
    for (const e of events) {
      for (const pid of e.personIds ?? []) allPersonIds.add(pid);
      for (const did of e.documentIds ?? []) allDocumentIds.add(did);
    }

    const personMap = new Map<number, { id: number; name: string }>();
    if (allPersonIds.size > 0) {
      const personRows = await db.select({ id: persons.id, name: persons.name })
        .from(persons)
        .where(inArray(persons.id, Array.from(allPersonIds)));
      for (const p of personRows) personMap.set(p.id, p);
    }

    const documentMap = new Map<number, { id: number; title: string }>();
    if (allDocumentIds.size > 0) {
      const docRows = await db.select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(inArray(documents.id, Array.from(allDocumentIds)));
      for (const d of docRows) documentMap.set(d.id, d);
    }

    const data = events.map(e => ({
      ...e,
      persons: (e.personIds ?? []).map(pid => personMap.get(pid)).filter(Boolean),
      documents: (e.documentIds ?? []).map(did => documentMap.get(did)).filter(Boolean),
    }));

    return { data, total, page: opts.page, totalPages };
  }

  async createTimelineEvent(event: InsertTimelineEvent): Promise<TimelineEvent> {
    const [created] = await db.insert(timelineEvents).values(event).returning();
    return created;
  }

  async getStats() {
    return statsCache.get(async () => {
      const r2Cond = r2Filter();
      const [personResult, documentResult, pageResult, connectionResult, eventResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(persons),
        db.select({ count: sql<number>`count(*)::int` }).from(documents).where(r2Cond),
        db.select({ count: sql<number>`count(*)::int` }).from(documentPages),
        db.select({ count: sql<number>`count(*)::int` }).from(connections),
        db.select({ count: sql<number>`count(*)::int` }).from(timelineEvents).where(sql`${timelineEvents.date} >= '1950' AND ${timelineEvents.significance} >= 3`),
      ]);
      return {
        personCount: personResult[0].count,
        documentCount: documentResult[0].count,
        pageCount: pageResult[0].count,
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

    const personSearch = isTypesenseConfigured()
      ? typesenseSearchPersons(query, 20).then(async (tsPersons) => {
          const ids = tsPersons.map(p => p.pgId);
          if (ids.length === 0) return [];
          const rows = await db.select().from(persons).where(inArray(persons.id, ids));
          const byId = new Map(rows.map(r => [r.id, r]));
          return ids.map(id => byId.get(id)).filter(Boolean) as typeof rows;
        }).catch(() =>
          db.select().from(persons).where(
            or(ilike(persons.name, searchPattern), ilike(persons.occupation, searchPattern))
          ).limit(20)
        )
      : db.select().from(persons).where(
          or(ilike(persons.name, searchPattern), ilike(persons.occupation, searchPattern))
        ).limit(20);

    const [matchedPersons, pageResults, matchedEvents] = await Promise.all([
      personSearch,

      this.searchPages(query, 1, 20, false, true),

      db.select().from(timelineEvents).where(
        or(
          ilike(timelineEvents.title, searchPattern),
          ilike(timelineEvents.description, searchPattern),
          ilike(timelineEvents.category, searchPattern)
        )
      ).limit(20),
    ]);

    // Deduplicate documents from page results and fetch full document records
    const docIds = Array.from(new Set(pageResults.results.map(r => r.documentId))).slice(0, 20);
    const matchedDocuments = docIds.length > 0
      ? await db.select().from(documents).where(inArray(documents.id, docIds))
      : [];

    const result = {
      persons: matchedPersons,
      documents: matchedDocuments,
      events: matchedEvents,
    };

    searchCache.set(normalizedQuery, { data: result, cachedAt: Date.now() });
    evictExpired(searchCache, SEARCH_CACHE_TTL, MAX_SEARCH_CACHE);
    return result;
  }

  /**
   * Search using Typesense for documents, PostgreSQL for persons/events.
   * Falls through to caller if Typesense fails (caller should catch and use search()).
   */
  async searchWithTypesense(query: string) {
    const normalizedQuery = query.toLowerCase().trim();
    const cachedResult = searchCache.get(normalizedQuery);
    if (cachedResult && Date.now() - cachedResult.cachedAt < SEARCH_CACHE_TTL) {
      return cachedResult.data;
    }

    const searchPattern = `%${escapeLikePattern(query)}%`;

    const personSearch = isTypesenseConfigured()
      ? typesenseSearchPersons(query, 20).then(async (tsPersons) => {
          const ids = tsPersons.map(p => p.pgId);
          if (ids.length === 0) return [];
          const rows = await db.select().from(persons).where(inArray(persons.id, ids));
          const byId = new Map(rows.map(r => [r.id, r]));
          return ids.map(id => byId.get(id)).filter(Boolean) as typeof rows;
        }).catch(() =>
          db.select().from(persons).where(
            or(ilike(persons.name, searchPattern), ilike(persons.occupation, searchPattern))
          ).limit(20)
        )
      : db.select().from(persons).where(
          or(ilike(persons.name, searchPattern), ilike(persons.occupation, searchPattern))
        ).limit(20);

    const [matchedPersons, tsPageResults, matchedEvents] = await Promise.all([
      personSearch,

      typesenseDocumentSearch(query, 20),

      db.select().from(timelineEvents).where(
        or(
          ilike(timelineEvents.title, searchPattern),
          ilike(timelineEvents.description, searchPattern),
          ilike(timelineEvents.category, searchPattern)
        )
      ).limit(20),
    ]);

    const docIds = Array.from(new Set(tsPageResults.map(r => r.documentId))).slice(0, 20);
    const matchedDocuments = docIds.length > 0
      ? await db.select().from(documents).where(inArray(documents.id, docIds))
      : [];

    const result = {
      persons: matchedPersons,
      documents: matchedDocuments,
      events: matchedEvents,
    };

    searchCache.set(normalizedQuery, { data: result, cachedAt: Date.now() });
    evictExpired(searchCache, SEARCH_CACHE_TTL, MAX_SEARCH_CACHE);
    return result;
  }

  /**
   * Search for document IDs using Typesense-first, PostgreSQL fallback.
   * Used by getDocumentsFiltered() when opts.search is set.
   */
  private async searchDocumentIds(
    query: string,
    limit: number,
    opts?: { documentType?: string; dataSet?: string },
  ): Promise<number[]> {
    if (isTypesenseConfigured()) {
      try {
        const result = await typesenseSearchPages(query, 1, limit, {
          filterR2: isR2Configured(),
          documentType: opts?.documentType,
          dataSet: opts?.dataSet,
        });
        return [...new Set(result.results.map(r => r.documentId))];
      } catch {
        // fall through to PostgreSQL
      }
    }
    const result = await this.searchPages(query, 1, limit, false, true);
    return [...new Set(result.results.map(r => r.documentId))];
  }

  async searchPages(query: string, page: number, limit: number, useOrMode = false, skipCount = false) {
    const offset = (page - 1) * limit;

    // Mirror r2Filter() logic as raw SQL for the JOIN
    const r2Raw = isR2Configured()
      ? `d.r2_key IS NOT NULL AND (d.file_size_bytes IS NULL OR d.file_size_bytes != 0)`
      : `(d.file_size_bytes IS NULL OR d.file_size_bytes != 0)`;

    // useOrMode: use to_tsquery with pre-formatted query (supports OR); default: websearch_to_tsquery
    const tsquery = useOrMode
      ? sql`to_tsquery('english', ${query})`
      : sql`websearch_to_tsquery('english', ${query})`;

    // Ranking window: GIN index searches ALL pages, but we only rank
    // the top N candidates. Over-fetch 3x to absorb R2 filtering losses.
    const rankingWindow = 50000;
    const overFetch = Math.max(limit * 3, 60);

    let total = -1;
    if (!skipCount) {
      // Pure GIN scan — no JOIN, no R2 filter. Fast index-only count.
      const countResult: any = await db.execute(sql`
        SELECT count(*)::int AS total FROM (
          SELECT 1 FROM document_pages
          WHERE search_vector @@ ${tsquery}
          LIMIT ${rankingWindow}
        ) sub
      `);
      total = (countResult.rows ?? countResult)[0]?.total ?? 0;
    }

    // 3-stage query:
    // 1. candidates CTE: pure GIN scan on document_pages only (no JOIN).
    //    This is an index-only operation — no cross-table lookups.
    // 2. ranked subquery: ts_rank on candidates, sort, over-fetch 3x limit.
    // 3. outer query: JOIN documents (R2 filter + metadata), JOIN document_pages
    //    (content for ts_headline), apply final LIMIT/OFFSET.
    const rawResult: any = await db.execute(sql`
      WITH candidates AS (
        SELECT id, document_id, page_number, page_type, search_vector
        FROM document_pages
        WHERE search_vector @@ ${tsquery}
        LIMIT ${rankingWindow}
      ),
      ranked AS (
        SELECT c.id, c.document_id, c.page_number, c.page_type,
               ts_rank(c.search_vector, ${tsquery}) AS rank
        FROM candidates c
        ORDER BY rank DESC, c.document_id, c.page_number
        LIMIT ${overFetch} OFFSET ${offset}
      )
      SELECT ranked.document_id, d.title, d.document_type, d.data_set,
             ranked.page_number, ranked.page_type,
             ts_headline('english', dp.content, ${tsquery},
               'MaxWords=35, MinWords=15, StartSel=<mark>, StopSel=</mark>, MaxFragments=2'
             ) AS headline,
             ranked.rank
      FROM ranked
      JOIN documents d ON d.id = ranked.document_id
      JOIN document_pages dp ON dp.id = ranked.id
      WHERE ${sql.raw(r2Raw)}
      ORDER BY ranked.rank DESC, ranked.document_id, ranked.page_number
      LIMIT ${limit}
    `);
    const rows: any[] = rawResult.rows ?? rawResult;

    return {
      results: rows.map((r: any) => ({
        documentId: Number(r.document_id),
        title: r.title,
        documentType: r.document_type,
        dataSet: r.data_set,
        pageNumber: Number(r.page_number),
        headline: r.headline,
        pageType: r.page_type ?? null,
      })),
      total,
      page,
      totalPages: total >= 0 ? Math.ceil(total / limit) : -1,
    };
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
    const r2Cond = r2Filter();
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(documents).where(r2Cond);
    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const data = await db.select().from(documents).where(r2Cond).orderBy(asc(documents.id)).limit(limit).offset(offset);
    return { data, total, page, totalPages };
  }

  async getDocumentsCursor(afterId: number, limit: number): Promise<Document[]> {
    const conditions = [];
    const r2Cond = r2Filter();
    if (r2Cond) conditions.push(r2Cond);
    conditions.push(gt(documents.id, afterId));
    return db.select().from(documents).where(and(...conditions)).orderBy(asc(documents.id)).limit(limit);
  }

  async getDocumentsFiltered(opts: {
    page: number;
    limit: number;
    search?: string;
    type?: string;
    dataSet?: string;
    redacted?: string;
    mediaType?: string;
    sort?: string;
    tag?: string;
  }): Promise<{ data: Document[]; total: number; page: number; totalPages: number }> {
    const conditions = [];
    const r2Cond = r2Filter();
    if (r2Cond) conditions.push(r2Cond);

    // Resolve search doc IDs once — reused by both the Drizzle WHERE and the popular-sort raw SQL
    let searchDocIds: number[] | undefined;
    if (opts.search) {
      searchDocIds = await this.searchDocumentIds(opts.search, 100, {
        documentType: opts.type,
        dataSet: opts.dataSet,
      });
      if (searchDocIds.length === 0) {
        return { data: [], total: 0, page: opts.page, totalPages: 0 };
      }
      conditions.push(inArray(documents.id, searchDocIds));
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

    if (opts.tag) {
      conditions.push(sql`${documents.tags} @> ARRAY[${opts.tag}]`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Check if user applied any filters beyond the automatic r2 filter
    // sort only changes ordering, not the result set count, so exclude it
    const hasUserFilters = !!(opts.search || opts.type || opts.dataSet || opts.redacted || opts.mediaType || opts.tag);

    // For unfiltered queries, use the cached stats total to avoid COUNT(*) on 1.38M rows
    let total: number;
    if (!hasUserFilters) {
      const stats = await this.getStats();
      total = stats.documentCount;

      // For first page with no filters and default sort, serve from cache
      if (opts.page === 1 && !opts.sort) {
        const cachedFirstPage = await firstPageDocsCache.get(() =>
          db.select().from(documents).where(r2Cond).orderBy(asc(documents.id)).limit(50)
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

    if (opts.sort === "popular") {
      // Build parameterized WHERE conditions
      const conditions: SQL[] = [];
      if (isR2Configured()) conditions.push(sql`d.r2_key IS NOT NULL`);
      conditions.push(sql`(d.file_size_bytes IS NULL OR d.file_size_bytes != 0)`);
      if (opts.type) conditions.push(sql`d.document_type = ${opts.type}`);
      if (opts.dataSet) conditions.push(sql`d.data_set = ${opts.dataSet}`);
      if (opts.redacted === "redacted") conditions.push(sql`d.is_redacted = true`);
      else if (opts.redacted === "unredacted") conditions.push(sql`d.is_redacted = false`);
      if (opts.mediaType) conditions.push(sql`d.media_type = ${opts.mediaType}`);
      if (opts.tag) conditions.push(sql`d.tags @> ARRAY[${opts.tag}]`);
      if (searchDocIds) {
        const idParams = searchDocIds.map(id => sql`${id}`);
        conditions.push(sql`d.id IN (${sql.join(idParams, sql`, `)})`);
      }
      const whereSQL = sql.join(conditions, sql` AND `);

      // Step 1: Count how many popular docs pass filters (small aggregation)
      const countResult: any = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM (
          SELECT DISTINCT pv.entity_id
          FROM page_views pv
          JOIN documents d ON d.id = pv.entity_id
          WHERE pv.entity_type = 'document'
            AND pv.created_at > NOW() - INTERVAL '30 days'
            AND ${whereSQL}
        ) sub
      `);
      const popularCount = (countResult.rows ?? countResult)[0]?.cnt ?? 0;

      const viewedSubquery = sql`SELECT DISTINCT entity_id FROM page_views WHERE entity_type = 'document' AND created_at > NOW() - INTERVAL '30 days'`;

      if (offset < popularCount) {
        // Step 2a: Page falls within the popular segment
        const pageResult: any = await db.execute(sql`
          WITH popular AS (
            SELECT entity_id, COUNT(*) AS view_count
            FROM page_views
            WHERE entity_type = 'document'
              AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY entity_id
            ORDER BY view_count DESC
          )
          SELECT d.*
          FROM popular p
          JOIN documents d ON d.id = p.entity_id
          WHERE ${whereSQL}
          ORDER BY p.view_count DESC
          LIMIT ${opts.limit} OFFSET ${offset}
        `);
        const data: Document[] = ((pageResult.rows ?? pageResult) as any[]).map(mapRowToDocument);

        // Pad from non-viewed docs if page straddles the boundary
        if (data.length < opts.limit) {
          const padResult: any = await db.execute(sql`
            SELECT d.* FROM documents d
            WHERE ${whereSQL}
              AND d.id NOT IN (${viewedSubquery})
            ORDER BY d.id ASC
            LIMIT ${opts.limit - data.length}
          `);
          data.push(...((padResult.rows ?? padResult) as any[]).map(mapRowToDocument));
        }

        return { data, total, page: opts.page, totalPages };
      } else {
        // Step 2b: Page is entirely in the non-viewed segment
        const nonViewedOffset = offset - popularCount;
        const result: any = await db.execute(sql`
          SELECT d.* FROM documents d
          WHERE ${whereSQL}
            AND d.id NOT IN (${viewedSubquery})
          ORDER BY d.id ASC
          LIMIT ${opts.limit} OFFSET ${nonViewedOffset}
        `);
        const data: Document[] = ((result.rows ?? result) as any[]).map(mapRowToDocument);

        return { data, total, page: opts.page, totalPages };
      }
    }

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
    // Skip R2 filter — distinct types/dataSets/mediaTypes are the same
    // regardless of R2 status, and dropping it enables index-only scans.
    const [typeRows, dataSetRows, mediaTypeRows] = await Promise.all([
      db.selectDistinct({ documentType: documents.documentType })
        .from(documents)
        .orderBy(asc(documents.documentType)),
      db.selectDistinct({ dataSet: documents.dataSet })
        .from(documents)
        .where(isNotNull(documents.dataSet))
        .orderBy(asc(documents.dataSet)),
      db.selectDistinct({ mediaType: documents.mediaType })
        .from(documents)
        .where(isNotNull(documents.mediaType))
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

    // Mirror r2Filter() logic as raw SQL for single-query optimization
    const r2Cond = isR2Configured()
      ? sql`r2_key IS NOT NULL AND (file_size_bytes IS NULL OR file_size_bytes != 0)`
      : sql`(file_size_bytes IS NULL OR file_size_bytes != 0)`;

    const result_ = await db.execute(sql`
      SELECT
        (SELECT id FROM documents WHERE id < ${id} AND ${r2Cond} ORDER BY id DESC LIMIT 1) AS prev,
        (SELECT id FROM documents WHERE id > ${id} AND ${r2Cond} ORDER BY id ASC  LIMIT 1) AS next
    `);
    const row = result_.rows[0];

    const result = {
      prev: row?.prev != null ? Number(row.prev) : null,
      next: row?.next != null ? Number(row.next) : null,
    };

    adjacentCache.set(id, { data: result, cachedAt: Date.now() });
    evictExpired(adjacentCache, ADJACENT_CACHE_TTL, MAX_DETAIL_CACHE);
    return result;
  }

  async getSidebarCounts(): Promise<{
    documents: { total: number; byType: Record<string, number> };
    media: { images: number; videos: number; hiddenVideos: number };
    persons: number;
    events: number;
    connections: number;
  }> {
    return sidebarCountsCache.get(async () => {
    const r2Cond = r2Filter();
    const [docCounts, mediaCounts, entityCounts] = await Promise.all([
      // Document counts by type in a single query
      db.select({
        documentType: documents.documentType,
        count: sql<number>`count(*)::int`,
      }).from(documents).where(r2Cond).groupBy(documents.documentType),

      // Media counts
      db.select({
        images: sql<number>`count(*) filter (where ${documents.documentType} = 'photograph')::int`,
        videos: sql<number>`count(*) filter (where ${documents.documentType} = 'video')::int`,
        hiddenVideos: sql<number>`count(*) filter (where ${documents.tags} @> ARRAY['extension-resolved'] AND ${documents.documentType} = 'video')::int`,
      }).from(documents).where(r2Cond),

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
      media: { images: mediaCounts[0].images, videos: mediaCounts[0].videos, hiddenVideos: mediaCounts[0].hiddenVideos },
      persons: entityCounts[0][0].count,
      events: entityCounts[1][0].count,
      connections: entityCounts[2][0].count,
    };
    });
  }

  async getBookmarks(userId?: string): Promise<Bookmark[]> {
    if (userId) {
      return db.select().from(bookmarks).where(eq(bookmarks.userId, userId)).orderBy(desc(bookmarks.createdAt));
    }
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

  async getVotes(userId: string): Promise<DocumentVote[]> {
    return db.select().from(documentVotes)
      .where(eq(documentVotes.userId, userId))
      .orderBy(desc(documentVotes.createdAt));
  }

  async createVote(vote: InsertDocumentVote): Promise<DocumentVote> {
    const v = vote as { userId: string; documentId: number };
    const [created] = await db.insert(documentVotes).values(vote)
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const existing = await db.select().from(documentVotes).where(
        and(
          eq(documentVotes.userId, v.userId),
          eq(documentVotes.documentId, v.documentId),
        )
      );
      return existing[0];
    }
    return created;
  }

  async deleteVote(id: number): Promise<boolean> {
    const result = await db.delete(documentVotes).where(eq(documentVotes.id, id)).returning();
    return result.length > 0;
  }

  async getVoteCounts(documentIds: number[]): Promise<Record<number, number>> {
    if (documentIds.length === 0) return {};
    const rows = await db.select({
      documentId: documentVotes.documentId,
      count: sql<number>`count(*)::int`,
    }).from(documentVotes)
      .where(inArray(documentVotes.documentId, documentIds))
      .groupBy(documentVotes.documentId);

    const counts: Record<number, number> = {};
    for (const row of rows) {
      counts[row.documentId] = row.count;
    }
    return counts;
  }

  async getMostVotedDocuments(limit: number): Promise<(Document & { voteCount: number })[]> {
    const r2Cond = isR2Configured()
      ? sql`d.r2_key IS NOT NULL AND (d.file_size_bytes IS NULL OR d.file_size_bytes != 0)`
      : sql`(d.file_size_bytes IS NULL OR d.file_size_bytes != 0)`;

    const result: any = await db.execute(sql`
      SELECT d.id, dv.vote_count
      FROM documents d
      INNER JOIN (
        SELECT document_id, COUNT(*) AS vote_count
        FROM document_votes
        GROUP BY document_id
        HAVING COUNT(*) >= 1
      ) dv ON d.id = dv.document_id
      WHERE ${r2Cond}
      ORDER BY dv.vote_count DESC, d.id DESC
      LIMIT ${limit}
    `);
    const idRows: any[] = result.rows ?? result;
    if (idRows.length === 0) return [];
    const ids = idRows.map((r: any) => r.id as number);
    const countMap = new Map(idRows.map((r: any) => [r.id as number, Number(r.vote_count)]));
    const docs = await db.select().from(documents).where(inArray(documents.id, ids));
    return ids
      .map((id) => {
        const doc = docs.find((d) => d.id === id);
        return doc ? { ...doc, voteCount: countMap.get(id) ?? 0 } : null;
      })
      .filter((d): d is Document & { voteCount: number } => d !== null);
  }

  async getPersonVotes(userId: string): Promise<PersonVote[]> {
    return db.select().from(personVotes)
      .where(eq(personVotes.userId, userId))
      .orderBy(desc(personVotes.createdAt));
  }

  async createPersonVote(vote: InsertPersonVote): Promise<PersonVote> {
    const v = vote as { userId: string; personId: number };
    const [created] = await db.insert(personVotes).values(vote)
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const existing = await db.select().from(personVotes).where(
        and(
          eq(personVotes.userId, v.userId),
          eq(personVotes.personId, v.personId),
        )
      );
      return existing[0];
    }
    return created;
  }

  async deletePersonVote(id: number): Promise<boolean> {
    const result = await db.delete(personVotes).where(eq(personVotes.id, id)).returning();
    return result.length > 0;
  }

  async getPersonVoteCounts(personIds: number[]): Promise<Record<number, number>> {
    if (personIds.length === 0) return {};
    const rows = await db.select({
      personId: personVotes.personId,
      count: sql<number>`count(*)::int`,
    }).from(personVotes)
      .where(inArray(personVotes.personId, personIds))
      .groupBy(personVotes.personId);

    const counts: Record<number, number> = {};
    for (const row of rows) {
      counts[row.personId] = row.count;
    }
    return counts;
  }

  async getMostVotedPersons(limit: number): Promise<(Person & { voteCount: number })[]> {
    const result: any = await db.execute(sql`
      SELECT p.id, pv.vote_count
      FROM persons p
      INNER JOIN (
        SELECT person_id, COUNT(*) AS vote_count
        FROM person_votes
        GROUP BY person_id
        HAVING COUNT(*) >= 1
      ) pv ON p.id = pv.person_id
      ORDER BY pv.vote_count DESC, p.id DESC
      LIMIT ${limit}
    `);
    const idRows: any[] = result.rows ?? result;
    if (idRows.length === 0) return [];
    const ids = idRows.map((r: any) => r.id as number);
    const countMap = new Map(idRows.map((r: any) => [r.id as number, Number(r.vote_count)]));
    const people = await db.select().from(persons).where(inArray(persons.id, ids));
    return ids
      .map((id) => {
        const person = people.find((p) => p.id === id);
        return person ? { ...person, voteCount: countMap.get(id) ?? 0 } : null;
      })
      .filter((p): p is Person & { voteCount: number } => p !== null);
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

  async getAIAnalysisList(opts: { page: number; limit: number; search?: string; documentType?: string; dataSet?: string }): Promise<{ data: AIAnalysisListItem[]; total: number }> {
    const { page, limit, search, documentType, dataSet } = opts;
    const conditions: SQL[] = [];

    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      conditions.push(or(
        ilike(aiAnalyses.fileName, pattern),
        ilike(aiAnalyses.summary, pattern),
      )!);
    }
    if (documentType) conditions.push(eq(aiAnalyses.documentType, documentType));
    if (dataSet) conditions.push(eq(aiAnalyses.dataSet, dataSet));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [[countResult], rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(aiAnalyses).where(where),
      db.select({
        fileName: aiAnalyses.fileName,
        dataSet: aiAnalyses.dataSet,
        documentType: aiAnalyses.documentType,
        summary: aiAnalyses.summary,
        personCount: aiAnalyses.personCount,
        connectionCount: aiAnalyses.connectionCount,
        eventCount: aiAnalyses.eventCount,
        locationCount: aiAnalyses.locationCount,
        keyFactCount: aiAnalyses.keyFactCount,
        tier: aiAnalyses.tier,
        costCents: aiAnalyses.costCents,
        analyzedAt: aiAnalyses.analyzedAt,
      }).from(aiAnalyses)
        .where(where)
        .orderBy(desc(aiAnalyses.analyzedAt))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    return {
      data: rows.map(r => ({
        fileName: r.fileName,
        dataSet: r.dataSet ?? "",
        documentType: r.documentType ?? "",
        summary: (r.summary ?? "").slice(0, 200),
        personCount: r.personCount,
        connectionCount: r.connectionCount,
        eventCount: r.eventCount,
        locationCount: r.locationCount,
        keyFactCount: r.keyFactCount,
        tier: r.tier,
        costCents: r.costCents,
        analyzedAt: r.analyzedAt?.toISOString() ?? "",
      })),
      total: countResult.count,
    };
  }

  async getAIAnalysis(fileName: string): Promise<AIAnalysisDocument | null> {
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return null;
    }

    // Strip .json suffix if present (DB stores "EFTA00000019.pdf" not "EFTA00000019.pdf.json")
    const cleanName = fileName.replace(/\.json$/, "");

    const [row] = await db.select().from(aiAnalyses)
      .where(eq(aiAnalyses.fileName, cleanName))
      .limit(1);

    if (!row) return null;

    return {
      fileName: row.fileName,
      dataSet: row.dataSet ?? undefined,
      documentType: row.documentType ?? undefined,
      summary: row.summary ?? undefined,
      persons: (row.persons as AIAnalysisPerson[]) ?? [],
      connections: (row.connectionsData as AIAnalysisConnection[]) ?? [],
      events: (row.events as AIAnalysisEvent[]) ?? [],
      locations: (row.locations as string[]) ?? [],
      keyFacts: (row.keyFacts as string[]) ?? [],
      tier: row.tier,
      costCents: row.costCents,
      analyzedAt: row.analyzedAt?.toISOString(),
    };
  }

  async getAIAnalysisAggregate(): Promise<AIAnalysisAggregate> {
    return aiAggregateCache.get(async () => {
      const [personCount, connectionCount, eventCount, totalDocs] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(persons),
        db.select({ count: sql<number>`count(*)::int` }).from(connections),
        db.select({ count: sql<number>`count(*)::int` }).from(timelineEvents).where(sql`${timelineEvents.date} >= '1950' AND ${timelineEvents.significance} >= 3`),
        db.select({ count: sql<number>`count(*)::int` }).from(aiAnalyses),
      ]);

      const dbTopPersons = await db.select({
        name: persons.name,
        category: persons.category,
        documentCount: persons.documentCount,
        connectionCount: persons.connectionCount,
      }).from(persons)
        .orderBy(desc(persons.documentCount))
        .limit(20);

      const dbConnectionTypes = await db.select({
        type: connections.connectionType,
        count: sql<number>`count(*)::int`,
      }).from(connections)
        .groupBy(connections.connectionType)
        .orderBy(sql`count(*) DESC`);

      const docTypes = await db.select({
        type: sql<string>`coalesce(${aiAnalyses.documentType}, 'unknown')`,
        count: sql<number>`count(*)::int`,
      }).from(aiAnalyses)
        .groupBy(aiAnalyses.documentType)
        .orderBy(sql`count(*) DESC`);

      const topLocRows = await db.execute<{ location: string; documentCount: number }>(sql`
        SELECT loc AS location, count(DISTINCT id)::int AS "documentCount"
        FROM ai_analyses, jsonb_array_elements_text(locations) AS loc
        GROUP BY loc
        ORDER BY count(DISTINCT id) DESC
        LIMIT 20
      `);
      const topLocations = Array.isArray(topLocRows) ? topLocRows : ((topLocRows as any).rows ?? []);

      return {
        topPersons: dbTopPersons.map((p) => ({
          name: p.name,
          category: p.category,
          mentionCount: p.documentCount ?? 0,
          documentCount: p.documentCount ?? 0,
        })),
        topLocations,
        connectionTypes: dbConnectionTypes.map((c) => ({ type: c.type, count: c.count })),
        documentTypes: docTypes.map((d) => ({ type: d.type, count: d.count })),
        totalDocuments: totalDocs[0].count,
        totalPersons: personCount[0].count,
        totalConnections: connectionCount[0].count,
        totalEvents: eventCount[0].count,
      };
    });
  }

  async recordPageView(entityType: string, entityId: number, sessionId: string): Promise<void> {
    // Dedup: skip if same session viewed same entity in last 30 minutes
    const [existing] = await db.select({ id: pageViews.id })
      .from(pageViews)
      .where(and(
        eq(pageViews.sessionId, sessionId),
        eq(pageViews.entityType, entityType),
        eq(pageViews.entityId, entityId),
        sql`${pageViews.createdAt} > NOW() - INTERVAL '30 minutes'`
      ))
      .limit(1);

    if (existing) return;

    await db.insert(pageViews).values({ entityType, entityId, sessionId });
  }

  async getViewCounts(entityType: string, ids: number[]): Promise<Record<number, number>> {
    if (ids.length === 0) return {};
    const rows = await db.select({
      entityId: pageViews.entityId,
      count: sql<number>`count(*)::int`,
    }).from(pageViews)
      .where(and(
        eq(pageViews.entityType, entityType),
        inArray(pageViews.entityId, ids),
        sql`${pageViews.createdAt} > NOW() - INTERVAL '30 days'`
      ))
      .groupBy(pageViews.entityId);
    const result: Record<number, number> = {};
    for (const row of rows) {
      result[row.entityId] = row.count;
    }
    return result;
  }

  async getTrendingPersons(limit: number): Promise<(Person & { viewCount: number })[]> {
    return trendingPersonsCache.get(async () => {
      // Step 1: Get top trending person IDs from page_views (small result set, uses index)
      const trendingResult: any = await db.execute(sql`
        SELECT entity_id,
               SUM(EXP(-EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0)) AS score,
               COUNT(*)::int AS view_count
        FROM page_views
        WHERE entity_type = 'person'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY entity_id
        HAVING COUNT(*) >= 2
        ORDER BY score DESC
        LIMIT ${limit}
      `);
      const trendingRows: any[] = trendingResult.rows ?? trendingResult;
      const trendingIds = trendingRows.map((r: any) => Number(r.entity_id));
      const viewCountMap = new Map(trendingRows.map((r: any) => [Number(r.entity_id), Number(r.view_count)]));

      // Step 2: Fetch those specific persons by ID (index scan)
      let trendingPersons: (Person & { viewCount: number })[] = [];
      if (trendingIds.length > 0) {
        const rows = await db.select().from(persons).where(inArray(persons.id, trendingIds));
        const byId = new Map(rows.map(r => [r.id, r]));
        trendingPersons = trendingIds
          .map(id => {
            const person = byId.get(id);
            return person ? { ...person, viewCount: viewCountMap.get(id) ?? 0 } : null;
          })
          .filter((p): p is Person & { viewCount: number } => p !== null);
      }

      // Step 3: Pad with high document_count persons if fewer than limit
      if (trendingPersons.length < limit) {
        const excludeIds = trendingPersons.map(p => p.id);
        const padCond = excludeIds.length > 0
          ? sql`id NOT IN (${sql.join(excludeIds.map(id => sql`${id}`), sql`, `)})`
          : undefined;
        const padPersons = await db.select().from(persons)
          .where(padCond)
          .orderBy(desc(persons.documentCount))
          .limit(limit - trendingPersons.length);
        trendingPersons.push(...padPersons.map(p => ({ ...p, viewCount: 0 })));
      }

      return trendingPersons;
    });
  }

  async getTrendingDocuments(limit: number): Promise<(Document & { viewCount: number })[]> {
    return trendingDocumentsCache.get(async () => {
      const r2Cond = r2Filter();

      // Step 1: Get top trending entity_ids from page_views (small result set, uses index)
      const trendingResult: any = await db.execute(sql`
        SELECT entity_id,
               SUM(EXP(-EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0)) AS score,
               COUNT(*)::int AS view_count
        FROM page_views
        WHERE entity_type = 'document'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY entity_id
        HAVING COUNT(*) >= 2
        ORDER BY score DESC
        LIMIT ${limit}
      `);
      const trendingRows: any[] = trendingResult.rows ?? trendingResult;
      const trendingIds = trendingRows.map((r: any) => Number(r.entity_id));
      const viewCountMap = new Map(trendingRows.map((r: any) => [Number(r.entity_id), Number(r.view_count)]));

      // Step 2: Fetch those specific documents by ID (index scan)
      let trendingDocs: (Document & { viewCount: number })[] = [];
      if (trendingIds.length > 0) {
        const conds = r2Cond
          ? and(inArray(documents.id, trendingIds), r2Cond)
          : inArray(documents.id, trendingIds);
        const rows = await db.select().from(documents).where(conds);
        const byId = new Map(rows.map(r => [r.id, r]));
        trendingDocs = trendingIds
          .map(id => {
            const doc = byId.get(id);
            return doc ? { ...doc, viewCount: viewCountMap.get(id) ?? 0 } : null;
          })
          .filter((d): d is Document & { viewCount: number } => d !== null);
      }

      // Step 3: Pad with popular docs (by page_count) if fewer than limit
      if (trendingDocs.length < limit) {
        const excludeIds = trendingDocs.map(d => d.id);
        const padConds = excludeIds.length > 0
          ? (r2Cond ? and(sql`id NOT IN (${sql.join(excludeIds.map(id => sql`${id}`), sql`, `)})`, r2Cond) : sql`id NOT IN (${sql.join(excludeIds.map(id => sql`${id}`), sql`, `)})`)
          : r2Cond;
        const padDocs = await db.select().from(documents)
          .where(padConds || undefined)
          .orderBy(sql`page_count DESC NULLS LAST, id DESC`)
          .limit(limit - trendingDocs.length);
        trendingDocs.push(...padDocs.map(d => ({ ...d, viewCount: 0 })));
      }

      return trendingDocs;
    });
  }

  async recordSearchQuery(query: string, sessionId: string, resultCount: number): Promise<void> {
    const normalized = query.toLowerCase().trim();
    if (normalized.length < 2) return;

    // Dedup: skip if same session searched same query in last 5 minutes
    const [existing] = await db.select({ id: searchQueries.id })
      .from(searchQueries)
      .where(and(
        eq(searchQueries.sessionId, sessionId),
        eq(searchQueries.query, normalized),
        sql`${searchQueries.createdAt} > NOW() - INTERVAL '5 minutes'`
      ))
      .limit(1);

    if (existing) return;

    await db.insert(searchQueries).values({ query: normalized, sessionId, resultCount });
  }

  async getTrendingSearches(limit: number): Promise<{ query: string; searchCount: number }[]> {
    return trendingSearchesCache.get(async () => {
      const result: any = await db.execute(sql`
        SELECT query,
               COUNT(*)::int AS search_count,
               SUM(EXP(-EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0)) AS score
        FROM search_queries
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY query
        HAVING COUNT(*) >= 2
        ORDER BY score DESC
        LIMIT ${limit}
      `);
      const rows: any[] = result.rows ?? result;
      return rows.map((r: any) => ({
        query: r.query as string,
        searchCount: Number(r.search_count),
      }));
    });
  }

  async getZeroResultSearches(
    limit: number,
    days: number = 7,
  ): Promise<{ query: string; searchCount: number; lastSearched: string }[]> {
    const result: any = await db.execute(sql`
      SELECT query,
             COUNT(*)::int AS search_count,
             MAX(created_at) AS last_searched
      FROM search_queries
      WHERE result_count = 0
        AND created_at > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY query
      ORDER BY search_count DESC, last_searched DESC
      LIMIT ${limit}
    `);
    const rows: any[] = result.rows ?? result;
    return rows.map((r: any) => ({
      query: r.query as string,
      searchCount: Number(r.search_count),
      lastSearched: new Date(r.last_searched).toISOString(),
    }));
  }
}

export const storage = new DatabaseStorage();
