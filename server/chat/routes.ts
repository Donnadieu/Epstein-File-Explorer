import type { Express, Request, Response } from "express";
import { db } from "../db";
import { conversations, messages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { retrieveContext } from "./retriever";
import { streamChatResponse } from "./service";

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

  // Send message and stream AI response
  app.post("/api/chat/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id as string);
      if (isNaN(conversationId)) return res.status(400).json({ error: "Invalid ID" });

      const { content } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Message content is required" });
      }

      // Verify conversation exists
      const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });

      // Save user message
      await db.insert(messages).values({ conversationId, role: "user", content });

      // Get conversation history
      const history = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
      const chatHistory = history.map((m) => ({ role: m.role, content: m.content }));

      // Retrieve relevant context via RAG
      const context = await retrieveContext(content);

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullResponse = "";

      // Stream response
      for await (const chunk of streamChatResponse(content, chatHistory, context)) {
        if (chunk.content) {
          fullResponse += chunk.content;
          res.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
        }

        if (chunk.done) {
          // Save assistant message with citations
          await db.insert(messages).values({
            conversationId,
            role: "assistant",
            content: fullResponse,
            citations: chunk.citations ?? null,
          });

          res.write(`data: ${JSON.stringify({ done: true, citations: chunk.citations ?? [] })}\n\n`);
        }
      }

      res.end();
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
