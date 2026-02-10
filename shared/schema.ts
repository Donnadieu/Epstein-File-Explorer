import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, integer, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const persons = pgTable("persons", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  aliases: text("aliases").array(),
  role: text("role").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("named"),
  nationality: text("nationality"),
  occupation: text("occupation"),
  imageUrl: text("image_url"),
  documentCount: integer("document_count").notNull().default(0),
  connectionCount: integer("connection_count").notNull().default(0),
  category: text("category").notNull().default("associate"),
}, (table) => [
  index("idx_persons_document_count").on(table.documentCount),
]);

export const documents = pgTable("documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  description: text("description"),
  documentType: text("document_type").notNull(),
  dataSet: text("data_set"),
  sourceUrl: text("source_url"),
  datePublished: text("date_published"),
  dateOriginal: text("date_original"),
  pageCount: integer("page_count"),
  isRedacted: boolean("is_redacted").default(false),
  keyExcerpt: text("key_excerpt"),
  tags: text("tags").array(),
  mediaType: text("media_type"),
  processingStatus: text("processing_status").default("pending"),
  aiAnalysisStatus: text("ai_analysis_status").default("pending"),
  fileSizeBytes: integer("file_size_bytes"),
  fileHash: text("file_hash"),
  localPath: text("local_path"),
  r2Key: text("r2_key"),
  eftaNumber: text("efta_number"),
  mimeType: text("mime_type"),
  extractedTextLength: integer("extracted_text_length"),
  aiCostCents: integer("ai_cost_cents").default(0),
}, (table) => [
  index("idx_documents_processing_status").on(table.processingStatus),
  index("idx_documents_media_type").on(table.mediaType),
  index("idx_documents_data_set").on(table.dataSet),
  index("idx_documents_efta_number").on(table.eftaNumber),
  index("idx_documents_source_url").on(table.sourceUrl),
  index("idx_documents_ai_analysis_status").on(table.aiAnalysisStatus),
  index("idx_documents_r2_key").on(table.r2Key),
  index("idx_documents_document_type").on(table.documentType),
  index("idx_documents_is_redacted").on(table.isRedacted),
]);

export const connections = pgTable("connections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  personId1: integer("person_id_1").notNull().references(() => persons.id),
  personId2: integer("person_id_2").notNull().references(() => persons.id),
  connectionType: text("connection_type").notNull(),
  description: text("description"),
  strength: integer("strength").notNull().default(1),
  documentIds: integer("document_ids").array(),
}, (table) => [
  index("idx_connections_person_id1").on(table.personId1),
  index("idx_connections_person_id2").on(table.personId2),
]);

export const personDocuments = pgTable("person_documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  personId: integer("person_id").notNull().references(() => persons.id),
  documentId: integer("document_id").notNull().references(() => documents.id),
  context: text("context"),
  mentionType: text("mention_type").notNull().default("mentioned"),
}, (table) => [
  index("idx_person_documents_person_id").on(table.personId),
  index("idx_person_documents_document_id").on(table.documentId),
]);

export const timelineEvents = pgTable("timeline_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  date: text("date").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  personIds: integer("person_ids").array(),
  documentIds: integer("document_ids").array(),
  significance: integer("significance").notNull().default(1),
}, (table) => [
  index("idx_timeline_events_date_sig").on(table.date, table.significance),
]);

export const personsRelations = relations(persons, ({ many }) => ({
  personDocuments: many(personDocuments),
  connectionsFrom: many(connections, { relationName: "connectionsFrom" }),
  connectionsTo: many(connections, { relationName: "connectionsTo" }),
}));

export const documentsRelations = relations(documents, ({ many }) => ({
  personDocuments: many(personDocuments),
}));

export const connectionsRelations = relations(connections, ({ one }) => ({
  person1: one(persons, { fields: [connections.personId1], references: [persons.id], relationName: "connectionsFrom" }),
  person2: one(persons, { fields: [connections.personId2], references: [persons.id], relationName: "connectionsTo" }),
}));

export const personDocumentsRelations = relations(personDocuments, ({ one }) => ({
  person: one(persons, { fields: [personDocuments.personId], references: [persons.id] }),
  document: one(documents, { fields: [personDocuments.documentId], references: [documents.id] }),
}));

export const insertPersonSchema = createInsertSchema(persons);
export const insertDocumentSchema = createInsertSchema(documents);
export const insertConnectionSchema = createInsertSchema(connections);
export const insertPersonDocumentSchema = createInsertSchema(personDocuments);
export const insertTimelineEventSchema = createInsertSchema(timelineEvents);

export type Person = typeof persons.$inferSelect;
export type InsertPerson = typeof persons.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;
export type Connection = typeof connections.$inferSelect;
export type InsertConnection = typeof connections.$inferInsert;
export type PersonDocument = typeof personDocuments.$inferSelect;
export type InsertPersonDocument = typeof personDocuments.$inferInsert;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type InsertTimelineEvent = typeof timelineEvents.$inferInsert;

export const pipelineJobs = pgTable("pipeline_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  documentId: integer("document_id").references(() => documents.id),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const budgetTracking = pgTable("budget_tracking", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  date: text("date").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  documentId: integer("document_id").references(() => documents.id),
  jobType: text("job_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPipelineJobSchema = createInsertSchema(pipelineJobs).omit({ createdAt: true });
export const insertBudgetTrackingSchema = createInsertSchema(budgetTracking).omit({ createdAt: true });

export type PipelineJob = typeof pipelineJobs.$inferSelect;
export type InsertPipelineJob = typeof pipelineJobs.$inferInsert;
export type BudgetTracking = typeof budgetTracking.$inferSelect;
export type InsertBudgetTracking = typeof budgetTracking.$inferInsert;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const bookmarks = pgTable("bookmarks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: text("user_id").notNull().default("anonymous"),
  entityType: text("entity_type").notNull(), // 'person' | 'document' | 'search'
  entityId: integer("entity_id"),
  searchQuery: text("search_query"),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_bookmarks_user_entity").on(table.userId, table.entityType),
  // Two partial unique indexes: one for entity bookmarks (person/document),
  // one for search bookmarks. A single index on (userId, entityType, entityId)
  // doesn't work because PostgreSQL treats NULLs as distinct.
  uniqueIndex("idx_bookmarks_entity_unique")
    .on(table.userId, table.entityType, table.entityId)
    .where(sql`entity_id IS NOT NULL`),
  uniqueIndex("idx_bookmarks_search_unique")
    .on(table.userId, table.entityType, table.searchQuery)
    .where(sql`search_query IS NOT NULL`),
]);

export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ createdAt: true });
export type Bookmark = typeof bookmarks.$inferSelect;
export type InsertBookmark = typeof bookmarks.$inferInsert;

// Chat tables
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export interface ChatCitation {
  documentId: number;
  documentTitle: string;
  relevance: string;
}

// AI Analysis types (shared between server + client)

export interface AIAnalysisListItem {
  fileName: string;
  dataSet: string;
  documentType: string;
  summary: string;
  personCount: number;
  connectionCount: number;
  eventCount: number;
  locationCount: number;
  keyFactCount: number;
  tier: number;
  costCents: number;
  analyzedAt: string;
}

export interface AIAnalysisAggregate {
  topPersons: { name: string; mentionCount: number; documentCount: number; category: string }[];
  topLocations: { location: string; documentCount: number }[];
  connectionTypes: { type: string; count: number }[];
  documentTypes: { type: string; count: number }[];
  totalDocuments: number;
  totalPersons: number;
  totalConnections: number;
  totalEvents: number;
}

export interface AIAnalysisListResponse {
  analyses: AIAnalysisListItem[];
  total: number;
}

export interface AIAnalysisPerson {
  name: string;
  role?: string;
  category?: string;
  mentionCount?: number;
}

export interface AIAnalysisConnection {
  person1: string;
  person2: string;
  relationshipType?: string;
  type?: string;
  strength?: number;
}

export interface AIAnalysisEvent {
  date?: string;
  title: string;
  description?: string;
  significance?: number;
}

export interface AIAnalysisDocument {
  fileName?: string;
  dataSet?: string;
  documentType?: string;
  summary?: string;
  persons?: AIAnalysisPerson[];
  connections?: AIAnalysisConnection[];
  events?: AIAnalysisEvent[];
  locations?: string[];
  keyFacts?: string[];
  tier?: number;
  costCents?: number;
  analyzedAt?: string;
}
