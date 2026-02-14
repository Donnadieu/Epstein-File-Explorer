import type { Express, Request, Response } from "express";
import { db } from "../db";
import { conversations, messages, documents, pipelineJobs } from "@shared/schema";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { retrieveContext } from "./retriever";
import { streamChatResponse } from "./service";

async function queueUnanalyzedDocuments(documentIds: number[]): Promise<void> {
  if (documentIds.length === 0) return;

  // Find which of these documents haven't been analyzed yet
  const unanalyzed = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        inArray(documents.id, documentIds),
        eq(documents.aiAnalysisStatus, "pending"),
      ),
    );

  for (const doc of unanalyzed) {
    // Check if a job already exists for this document
    const [existing] = await db
      .select({ id: pipelineJobs.id })
      .from(pipelineJobs)
      .where(
        and(
          eq(pipelineJobs.documentId, doc.id),
          eq(pipelineJobs.jobType, "chat-triggered-analysis"),
          sql`${pipelineJobs.status} IN ('pending', 'running')`,
        ),
      )
      .limit(1);

    if (!existing) {
      await db.insert(pipelineJobs).values({
        documentId: doc.id,
        jobType: "chat-triggered-analysis",
        status: "pending",
        priority: 1,
      });
    }
  }
}

export function registerChatRoutes(app: Express): void {
  // List all conversations
  app.get("/api/chat/conversations", async (_req: Request, res: Response) => {
    try {
      const result = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
      res.json(result);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages
  app.get("/api/chat/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });

      const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
      res.json({ ...conversation, messages: msgs });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation
  app.post("/api/chat/conversations", async (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      const [conversation] = await db.insert(conversations).values({ title: title || "New Chat" }).returning();
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/chat/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      await db.delete(conversations).where(eq(conversations.id, id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Stateless chat — no DB persistence, history sent from client
  app.post("/api/chat/message", async (req: Request, res: Response) => {
    try {
      const { content, history = [] } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Message content is required" });
      }

      const context = await retrieveContext(content);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for await (const chunk of streamChatResponse(content, history, context)) {
        if (chunk.content) {
          res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
        }
        if (chunk.done) {
          res.write(`data: ${JSON.stringify({ done: true, citations: chunk.citations ?? [] })}\n\n`);
        }
      }

      res.end();

      queueUnanalyzedDocuments(context.retrievedDocumentIds).catch(() => {});
    } catch (error) {
      console.error("Error in chat message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "An error occurred while generating a response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process message" });
      }
    }
  });
}
