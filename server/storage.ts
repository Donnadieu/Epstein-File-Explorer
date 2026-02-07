import {
  persons, documents, connections, personDocuments, timelineEvents,
  pipelineJobs, budgetTracking,
  type Person, type InsertPerson,
  type Document, type InsertDocument,
  type Connection, type InsertConnection,
  type PersonDocument, type InsertPersonDocument,
  type TimelineEvent, type InsertTimelineEvent,
  type PipelineJob, type BudgetTracking,
} from "@shared/schema";
import { db } from "./db";
import { eq, ilike, or, sql, desc, asc } from "drizzle-orm";

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

  getPipelineJobs(status?: string): Promise<PipelineJob[]>;
  getPipelineStats(): Promise<{ pending: number; running: number; completed: number; failed: number }>;
  getBudgetSummary(): Promise<{ totalCostCents: number; totalInputTokens: number; totalOutputTokens: number; byModel: Record<string, number> }>;
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

    const allConns = [];
    for (const conn of connsFrom) {
      const otherPerson = await this.getPerson(conn.personId2);
      if (otherPerson) {
        allConns.push({ ...conn, person: otherPerson });
      }
    }
    for (const conn of connsTo) {
      const otherPerson = await this.getPerson(conn.personId1);
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
    return db.select().from(timelineEvents).orderBy(asc(timelineEvents.date));
  }

  async createTimelineEvent(event: InsertTimelineEvent): Promise<TimelineEvent> {
    const [created] = await db.insert(timelineEvents).values(event).returning();
    return created;
  }

  async getStats() {
    const [personResult] = await db.select({ count: sql<number>`count(*)::int` }).from(persons);
    const [documentResult] = await db.select({ count: sql<number>`count(*)::int` }).from(documents);
    const [connectionResult] = await db.select({ count: sql<number>`count(*)::int` }).from(connections);
    const [eventResult] = await db.select({ count: sql<number>`count(*)::int` }).from(timelineEvents);

    return {
      personCount: personResult.count,
      documentCount: documentResult.count,
      connectionCount: connectionResult.count,
      eventCount: eventResult.count,
    };
  }

  async getNetworkData() {
    const allPersons = await this.getPersons();
    const allConnections = await db.select().from(connections);

    const enrichedConnections = allConnections.map((conn) => {
      const p1 = allPersons.find((p) => p.id === conn.personId1);
      const p2 = allPersons.find((p) => p.id === conn.personId2);
      return {
        ...conn,
        person1Name: p1?.name || "Unknown",
        person2Name: p2?.name || "Unknown",
      };
    });

    return { persons: allPersons, connections: enrichedConnections };
  }

  async search(query: string) {
    const searchPattern = `%${query}%`;

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
}

export const storage = new DatabaseStorage();
