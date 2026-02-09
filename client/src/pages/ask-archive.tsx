import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useChat } from "@/hooks/use-chat";
import { ChatMessage } from "@/components/chat-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Send,
  Trash2,
  MessageCircle,
  Shield,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import type { Conversation, Message, ChatCitation } from "@shared/schema";

const EXAMPLE_QUESTIONS = [
  "Who flew to Little St. James?",
  "What do the flight logs reveal?",
  "Who is Virginia Giuffre?",
  "What connections exist between Epstein and Prince Andrew?",
];

interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export default function AskArchivePage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch conversation list
  const { data: conversations = [], isLoading: loadingConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/chat/conversations"],
  });

  // Fetch selected conversation with messages
  const { data: activeConversation, isLoading: loadingMessages } = useQuery<ConversationWithMessages>({
    queryKey: [`/api/chat/conversations/${selectedId}`],
    enabled: selectedId !== null,
  });

  const { sendMessage, isStreaming, streamedContent, streamedCitations, resetStream } = useChat(selectedId);

  // Auto-scroll to bottom when new messages arrive or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages, streamedContent]);

  // Focus input when conversation changes
  useEffect(() => {
    if (selectedId) {
      inputRef.current?.focus();
    }
  }, [selectedId]);

  async function createConversation(initialMessage?: string) {
    const title = initialMessage
      ? initialMessage.slice(0, 50) + (initialMessage.length > 50 ? "..." : "")
      : "New Chat";

    const res = await apiRequest("POST", "/api/chat/conversations", { title });
    const conversation: Conversation = await res.json();

    queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    setSelectedId(conversation.id);
    resetStream();

    if (initialMessage) {
      sendMessage(initialMessage, conversation.id);
    }
  }

  async function deleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await apiRequest("DELETE", `/api/chat/conversations/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    if (selectedId === id) {
      setSelectedId(null);
      resetStream();
    }
  }

  async function handleSend() {
    const content = inputValue.trim();
    if (!content) return;

    setInputValue("");

    if (!selectedId) {
      await createConversation(content);
    } else {
      await sendMessage(content);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const messages = activeConversation?.messages ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)]" data-testid="page-ask-archive">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-64 border-r flex flex-col bg-background">
          <div className="p-3 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 mr-2"
              onClick={() => createConversation()}
              data-testid="button-new-chat"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Chat
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          </div>
          <Separator />
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {loadingConversations && (
                <>
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </>
              )}
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`grid grid-cols-[1fr_28px] items-center px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
                    selectedId === conv.id
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => {
                    setSelectedId(conv.id);
                    resetStream();
                  }}
                  data-testid={`conversation-${conv.id}`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <MessageCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{conv.title}</span>
                  </div>
                  <button
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    onClick={(e) => deleteConversation(conv.id, e)}
                    aria-label="Delete conversation"
                    data-testid={`delete-conversation-${conv.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {!loadingConversations && conversations.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                  No conversations yet
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toggle sidebar button when hidden */}
        {!sidebarOpen && (
          <div className="p-2 border-b">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Messages or welcome screen */}
        <ScrollArea className="flex-1">
          {!selectedId ? (
            <WelcomeScreen onQuestionClick={(q) => createConversation(q)} />
          ) : loadingMessages ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="h-24 w-4/5 ml-auto" />
              <Skeleton className="h-16 w-3/4" />
            </div>
          ) : (
            <div className="p-6 max-w-3xl mx-auto w-full">
              {messages.length === 0 && !isStreaming && (
                <div className="text-center text-muted-foreground py-12">
                  <p className="text-sm">Ask a question to get started</p>
                </div>
              )}
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role as "user" | "assistant"}
                  content={msg.content}
                  citations={msg.citations as ChatCitation[] | null}
                />
              ))}
              {isStreaming && streamedContent && (
                <ChatMessage
                  role="assistant"
                  content={streamedContent}
                  citations={streamedCitations.length > 0 ? streamedCitations : null}
                  isStreaming
                />
              )}
              {isStreaming && !streamedContent && (
                <div className="flex justify-start mb-4">
                  <div className="bg-muted rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input area */}
        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the Epstein files..."
              disabled={isStreaming}
              rows={1}
              className="flex-1 resize-none rounded-xl border bg-background px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSend}
              disabled={isStreaming || !inputValue.trim()}
              size="icon"
              className="h-11 w-11 rounded-xl shrink-0"
              data-testid="button-send-message"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen({ onQuestionClick }: { onQuestionClick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8" data-testid="welcome-screen">
      <div className="flex flex-col items-center gap-4 max-w-lg text-center">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
          <Shield className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask the Archive</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Ask questions about the publicly released Epstein case files. Get answers
          with citations to specific documents.
        </p>
        <Separator className="my-2" />
        <p className="text-xs text-muted-foreground">Try asking:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
          {EXAMPLE_QUESTIONS.map((question) => (
            <button
              key={question}
              onClick={() => onQuestionClick(question)}
              className="text-left text-sm px-4 py-3 rounded-xl border bg-muted/50 hover:bg-muted transition-colors text-foreground"
              data-testid={`example-question`}
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
