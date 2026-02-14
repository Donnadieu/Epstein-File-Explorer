import { useState, useCallback, useRef } from "react";
import type { ChatCitation } from "@shared/schema";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
}

interface UseChatReturn {
  messages: ChatMessage[];
  sendMessage: (content: string) => Promise<void>;
  isStreaming: boolean;
  streamedContent: string;
  streamedCitations: ChatCitation[];
  error: string | null;
  clearChat: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");
  const [streamedCitations, setStreamedCitations] = useState<ChatCitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const streamingRef = useRef(false);

  function clearChat() {
    setMessages([]);
    setStreamedContent("");
    setStreamedCitations([]);
    setError(null);
  }

  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      if (streamingRef.current) return;
      streamingRef.current = true;

      const userMsg: ChatMessage = { role: "user", content };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamedContent("");
      setStreamedCitations([]);
      setError(null);

      // Send previous messages as history (exclude current — the server appends it with RAG context)
      const history = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const response = await fetch("/api/chat/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, history }),
        });

        if (!response.ok) {
          const errorText = (await response.text()) || response.statusText;
          throw new Error(`${response.status}: ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No readable stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const jsonStr = trimmed.slice(6);
            if (!jsonStr) continue;

            try {
              const parsed = JSON.parse(jsonStr);

              if (parsed.error) throw new Error(parsed.error);

              if (parsed.done) {
                const citations = parsed.citations ?? [];
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: fullContent, citations },
                ]);
                setStreamedContent("");
                setStreamedCitations([]);
                setIsStreaming(false);
                streamingRef.current = false;
                return;
              }

              if (parsed.content) {
                fullContent += parsed.content;
                setStreamedContent((prev) => prev + parsed.content);
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }

        // Stream ended without explicit done event
        if (fullContent) {
          setMessages((prev) => [...prev, { role: "assistant", content: fullContent }]);
          setStreamedContent("");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsStreaming(false);
        streamingRef.current = false;
      }
    },
    [],
  );

  return { messages, sendMessage, isStreaming, streamedContent, streamedCitations, error, clearChat };
}
