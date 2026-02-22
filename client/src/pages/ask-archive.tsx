import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChat } from "@/hooks/use-chat";
import { ChatMessage } from "@/components/chat-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, RotateCcw, Shield } from "lucide-react";

const EXAMPLE_QUESTIONS = [
  "Who flew to Little St. James?",
  "What do the flight logs reveal?",
  "Who is Virginia Giuffre?",
  "What connections exist between Epstein and Prince Andrew?",
];

interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

export default function AskArchivePage() {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { messages, sendMessage, isStreaming, streamedContent, streamedCitations, error, clearChat, model, setModel } = useChat();

  const { data: modelsData } = useQuery<{ models: ModelInfo[]; default: string }>({
    queryKey: ["/api/chat/models"],
    queryFn: async () => {
      const res = await fetch("/api/chat/models");
      if (!res.ok) throw new Error("Failed to fetch models");
      return res.json();
    },
  });

  const availableModels = modelsData?.models?.filter((m) => m.available) ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamedContent]);

  async function handleSend(content?: string) {
    const text = (content || inputValue).trim();
    if (!text || isStreaming) return;
    setInputValue("");
    await sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasMessages = messages.length > 0 || isStreaming;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]" data-testid="page-ask-archive">
      {hasMessages && (
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <h2 className="text-sm font-medium">Ask the Archive</h2>
          <div className="flex items-center gap-2">
            <ModelSelector
              models={availableModels}
              value={model}
              onChange={setModel}
              disabled={isStreaming}
            />
            <Button variant="ghost" size="sm" onClick={clearChat} disabled={isStreaming}>
              <RotateCcw className="w-4 h-4 mr-1" />
              New Chat
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        {!hasMessages ? (
          <WelcomeScreen
            onQuestionClick={(q) => handleSend(q)}
            models={availableModels}
            selectedModel={model}
            onModelChange={setModel}
          />
        ) : (
          <div className="p-6 max-w-3xl mx-auto w-full">
            {messages.map((msg, i) => (
              <ChatMessage
                key={i}
                role={msg.role}
                content={msg.content}
                citations={msg.citations}
              />
            ))}
            {isStreaming && streamedContent && (
              <ChatMessage
                role="assistant"
                content={streamedContent}
                citations={streamedCitations.length > 0 ? streamedCitations : undefined}
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
            {error && (
              <div className="flex justify-start mb-4">
                <div className="bg-destructive/10 text-destructive rounded-2xl px-4 py-3 text-sm">
                  Failed to get response. Please try again.
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

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
            onClick={() => handleSend()}
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
  );
}

function ModelSelector({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (models.length <= 1) return null;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-model">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WelcomeScreen({
  onQuestionClick,
  models,
  selectedModel,
  onModelChange,
}: {
  onQuestionClick: (q: string) => void;
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (value: string) => void;
}) {
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
        {models.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Model:</span>
            <Select value={selectedModel} onValueChange={onModelChange}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Separator className="my-2" />
        <p className="text-xs text-muted-foreground">Try asking:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
          {EXAMPLE_QUESTIONS.map((question) => (
            <button
              key={question}
              onClick={() => onQuestionClick(question)}
              className="text-left text-sm px-4 py-3 rounded-xl border bg-muted/50 hover:bg-muted transition-colors text-foreground"
              data-testid="example-question"
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
