import type { ChatCitation } from "@shared/schema";
import type { RetrievalResult } from "./retriever";
import { getClient, getModelConfig } from "./models";

const SYSTEM_PROMPT = `You are a research assistant specializing in the publicly released Epstein case files. Your role is to help users understand the documents, persons, connections, and events in the archive.

Rules:
1. Only answer based on the provided document context. Do not speculate or add information from outside the archive.
2. When referencing specific documents, cite them using [Doc #ID] format.
3. Clearly distinguish between allegations, established facts, and testimony. Use language like "according to testimony," "documents allege," or "records show."
4. Be respectful of all individuals mentioned. These are legal documents involving serious matters.
5. If the provided context does not contain enough information to answer a question, say so clearly rather than guessing.
6. Keep responses focused and factual. Avoid editorializing or drawing conclusions not supported by the documents.`;

const MAX_HISTORY_MESSAGES = 10;

function buildUserMessage(userMessage: string, context: RetrievalResult): string {
  if (!context.contextText) return userMessage;

  return `${userMessage}\n\n---\nRELEVANT DOCUMENTS AND DATA:\n${context.contextText}`;
}

export async function* streamChatResponse(
  userMessage: string,
  conversationHistory: { role: string; content: string }[],
  context: RetrievalResult,
  modelId?: string,
): AsyncGenerator<{ content?: string; done?: boolean; citations?: ChatCitation[] }> {
  const client = getClient(modelId);
  const config = getModelConfig(modelId);

  const recentHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);

  const messages: Parameters<typeof client.chat.completions.create>[0]["messages"] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...recentHistory.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    { role: "user", content: buildUserMessage(userMessage, context) },
  ];

  const stream = await client.chat.completions.create({
    model: config.model,
    messages,
    stream: true,
    max_tokens: 2048,
    temperature: 0.3,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield { content };
    }
  }

  yield { done: true, citations: context.citations };
}
