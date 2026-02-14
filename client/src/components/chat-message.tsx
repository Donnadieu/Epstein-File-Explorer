import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { FileText, Copy, Check } from "lucide-react";
import type { ChatCitation } from "@shared/schema";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[] | null;
  isStreaming?: boolean;
}

function renderContent(text: string) {
  const paragraphs = text.split(/\n\n+/);

  return paragraphs.map((paragraph, i) => {
    const lines = paragraph.split("\n");
    const isList = lines.every((l) => l.trimStart().startsWith("- ") || l.trim() === "");

    if (isList) {
      const items = lines.filter((l) => l.trimStart().startsWith("- "));
      return (
        <ul key={i} className="list-disc list-inside space-y-1 my-2">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item.replace(/^\s*-\s*/, ""))}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={i} className="my-1.5">
        {renderInline(paragraph)}
      </p>
    );
  });
}

function renderInline(text: string) {
  const parts: (string | JSX.Element)[] = [];
  const regex = /(\*\*(.+?)\*\*|\[Doc #(\d+)\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3]) {
      const docId = match[3];
      parts.push(
        <Link
          key={match.index}
          href={`/documents/${docId}`}
          className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium"
        >
          <FileText className="w-3 h-3" />
          Doc #{docId}
        </Link>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function ChatMessage({ role, content, citations, isStreaming }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className={`group flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
      data-testid={`chat-message-${role}`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <div className="text-sm leading-relaxed">
          {renderContent(content)}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-current animate-pulse rounded-sm ml-0.5" />
          )}
        </div>

        {!isUser && citations && citations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-2">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {citations.map((citation, i) => (
                <Link key={i} href={`/documents/${citation.documentId}`}>
                  <Badge
                    variant="outline"
                    className="text-[10px] cursor-pointer hover:bg-primary/10"
                  >
                    <FileText className="w-3 h-3 mr-1" />
                    {citation.documentTitle.length > 40
                      ? citation.documentTitle.slice(0, 40) + "..."
                      : citation.documentTitle}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        )}

        {!isUser && !isStreaming && (
          <div className="flex justify-end mt-1">
            <button
              onClick={handleCopy}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 rounded opacity-0 group-hover:opacity-100"
              aria-label="Copy message"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
