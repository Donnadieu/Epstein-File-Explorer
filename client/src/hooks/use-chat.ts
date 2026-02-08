import { useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import type { ChatCitation } from "@shared/schema";

interface UseChatReturn {
  sendMessage: (content: string, overrideConversationId?: number) => Promise<void>;
  isStreaming: boolean;
  streamedContent: string;
  streamedCitations: ChatCitation[];
  resetStream: () => void;
}

export function useChat(conversationId: number | null): UseChatReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");
  const [streamedCitations, setStreamedCitations] = useState<ChatCitation[]>([]);

  function resetStream(): void {
    setIsStreaming(false);
    setStreamedContent("");
    setStreamedCitations([]);
  }

  const sendMessage = useCallback(
    async (content: string, overrideConversationId?: number): Promise<void> => {
      const targetId = overrideConversationId ?? conversationId;
      if (!targetId || isStreaming) return;

      setIsStreaming(true);
      setStreamedContent("");
      setStreamedCitations([]);

      const response = await fetch(
        `/api/chat/conversations/${targetId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          credentials: "include",
        },
      );

      if (!response.ok) {
        const errorText = (await response.text()) || response.statusText;
        setIsStreaming(false);
        throw new Error(`${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setIsStreaming(false);
        throw new Error("No readable stream in response");
      }

      const decoder = new TextDecoder();
      let buffer = "";

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

            if (parsed.error) {
              setIsStreaming(false);
              throw new Error(parsed.error);
            }

            if (parsed.done) {
              if (parsed.citations) {
                setStreamedCitations(parsed.citations);
              }
              setIsStreaming(false);
              queryClient.invalidateQueries({
                queryKey: ["/api/chat/conversations"],
              });
              queryClient.invalidateQueries({
                queryKey: [`/api/chat/conversations/${targetId}`],
              });
              return;
            }

            if (parsed.content) {
              setStreamedContent((prev) => prev + parsed.content);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      setIsStreaming(false);
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations"],
      });
    },
    [conversationId, isStreaming],
  );

  return { sendMessage, isStreaming, streamedContent, streamedCitations, resetStream };
}
