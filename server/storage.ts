import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
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
  getNetworkData(): Promise<{ persons: Person[]; connections: any[] }>;
  search(query: string): Promise<{ persons: Person[]; documents: Document[]; events: TimelineEvent[] }>;

  getPersonsPaginated(page: number, limit: number): Promise<{ data: Person[]; total: number; page: number; totalPages: number }>;
  getDocumentsPaginated(page: number, limit: number): Promise<{ data: Document[]; total: number; page: number; totalPages: number }>;

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AI_ANALYZED_DIR = path.resolve(__dirname, "..", "data", "ai-analyzed");

const CACHE_TTL = 60_000;
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
function normalizeName(name: string): string {
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

  // Sorted parts match (handles reversed order: "maxwell ghislaine" vs "ghislaine maxwell")
  const sortedA = [...partsA].sort().join(" ");
  const sortedB = [...partsB].sort().join(" ");
  if (sortedA === sortedB) return true;

  // Same last name + first name is a prefix or within edit distance 2
  const lastA = partsA[partsA.length - 1];
  const lastB = partsB[partsB.length - 1];
  if (lastA === lastB) {
    const firstA = partsA[0];
    const firstB = partsB[0];
    // Prefix match
    if (firstA.startsWith(firstB) || firstB.startsWith(firstA)) return true;
    // Fuzzy match (handles typos like "ghisaine" vs "ghislaine")
    if (firstA.length >= 4 && firstB.length >= 4 && editDistance(firstA, firstB) <= 2) return true;
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

export class DatabaseStorage implements IStorage {
  async getPersons(): Promise<Person[]> {
    return db.select().from(persons).orderBy(desc(persons.documentCount));
  }

  async getPerson(id: number): Promise<Person | undefined> {
    const [person] = await db.select().from(persons).where(eq(persons.id, id));
    return person || undefined;
  }

  async getPersonWithDetails(id: number): Promise<any> {
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

    return {
      ...person,
      documents: pDocs,
      connections: allConns,
    };
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

    return {
      ...doc,
      persons: pDocs,
    };
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
    return db.select().from(timelineEvents)
      .where(sql`${timelineEvents.date} >= '1950' AND ${timelineEvents.significance} >= 3`)
      .orderBy(asc(timelineEvents.date));
  }

  async createTimelineEvent(event: InsertTimelineEvent): Promise<TimelineEvent> {
    const [created] = await db.insert(timelineEvents).values(event).returning();
    return created;
  }

  async getStats() {
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
  }

  async getNetworkData() {
    const allPersons = await this.getPersons();
    const allConnections = await db.select().from(connections);

    // Deduplicate persons with similar names (e.g., "Jeffrey Epstein", "Jeffrey E. Epstein", "Jeff Epstein")
    const { deduped, idMap } = deduplicatePersons(allPersons);

    const dedupedMap = new Map(deduped.map(p => [p.id, p]));

    // Remap connections to canonical person IDs and remove self-loops / duplicates
    const seenConnections = new Set<string>();
    const enrichedConnections: Array<typeof allConnections[number] & { person1Name: string; person2Name: string }> = [];

    for (const conn of allConnections) {
      const pid1 = idMap.get(conn.personId1) ?? conn.personId1;
      const pid2 = idMap.get(conn.personId2) ?? conn.personId2;
      if (pid1 === pid2) continue; // skip self-loops from merged entities
      const p1 = dedupedMap.get(pid1);
      const p2 = dedupedMap.get(pid2);
      if (!p1 || !p2) continue;

      // Deduplicate connections between the same pair
      const pairKey = pid1 < pid2 ? `${pid1}-${pid2}-${conn.connectionType}` : `${pid2}-${pid1}-${conn.connectionType}`;
      if (seenConnections.has(pairKey)) continue;
      seenConnections.add(pairKey);

      enrichedConnections.push({
        ...conn,
        personId1: pid1,
        personId2: pid2,
        person1Name: p1.name,
        person2Name: p2.name,
      });
    }

    return { persons: deduped, connections: enrichedConnections };
  }

  async search(query: string) {
    const searchPattern = `%${escapeLikePattern(query)}%`;

    const matchedPersons = await db
      .select()
      .from(persons)
      .where(
        or(
          ilike(persons.name, searchPattern),
          ilike(persons.occupation, searchPattern),
          ilike(persons.description, searchPattern),
          ilike(persons.role, searchPattern)
        )
      )
      .limit(20);

    const matchedDocuments = await db
      .select()
      .from(documents)
      .where(
        or(
          ilike(documents.title, searchPattern),
          ilike(documents.description, searchPattern),
          ilike(documents.keyExcerpt, searchPattern),
          ilike(documents.documentType, searchPattern)
        )
      )
      .limit(20);

    const matchedEvents = await db
      .select()
      .from(timelineEvents)
      .where(
        or(
          ilike(timelineEvents.title, searchPattern),
          ilike(timelineEvents.description, searchPattern),
          ilike(timelineEvents.category, searchPattern)
        )
      )
      .limit(20);

    return {
      persons: matchedPersons,
      documents: matchedDocuments,
      events: matchedEvents,
    };
  }

  async getPersonsPaginated(page: number, limit: number): Promise<{ data: Person[]; total: number; page: number; totalPages: number }> {
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(persons);
    const total = countResult.count;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const data = await db.select().from(persons).orderBy(desc(persons.documentCount)).limit(limit).offset(offset);
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
