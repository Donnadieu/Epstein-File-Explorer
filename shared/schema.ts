import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
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
});

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
]);

export const connections = pgTable("connections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  personId1: integer("person_id_1").notNull().references(() => persons.id),
  personId2: integer("person_id_2").notNull().references(() => persons.id),
  connectionType: text("connection_type").notNull(),
  description: text("description"),
  strength: integer("strength").notNull().default(1),
  documentIds: integer("document_ids").array(),
});

export const personDocuments = pgTable("person_documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  personId: integer("person_id").notNull().references(() => persons.id),
  documentId: integer("document_id").notNull().references(() => documents.id),
  context: text("context"),
  mentionType: text("mention_type").notNull().default("mentioned"),
});

export const timelineEvents = pgTable("timeline_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  date: text("date").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  personIds: integer("person_ids").array(),
  documentIds: integer("document_ids").array(),
  significance: integer("significance").notNull().default(1),
});

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

export const insertPersonSchema = createInsertSchema(persons).omit({ id: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true });
export const insertConnectionSchema = createInsertSchema(connections).omit({ id: true });
export const insertPersonDocumentSchema = createInsertSchema(personDocuments).omit({ id: true });
export const insertTimelineEventSchema = createInsertSchema(timelineEvents).omit({ id: true });

export type Person = typeof persons.$inferSelect;
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Connection = typeof connections.$inferSelect;
export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type PersonDocument = typeof personDocuments.$inferSelect;
export type InsertPersonDocument = z.infer<typeof insertPersonDocumentSchema>;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type InsertTimelineEvent = z.infer<typeof insertTimelineEventSchema>;

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

export const insertPipelineJobSchema = createInsertSchema(pipelineJobs).omit({ id: true });
export const insertBudgetTrackingSchema = createInsertSchema(budgetTracking).omit({ id: true });

export type PipelineJob = typeof pipelineJobs.$inferSelect;
export type InsertPipelineJob = z.infer<typeof insertPipelineJobSchema>;
export type BudgetTracking = typeof budgetTracking.$inferSelect;
export type InsertBudgetTracking = z.infer<typeof insertBudgetTrackingSchema>;

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
