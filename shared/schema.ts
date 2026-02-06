import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
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
});

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
