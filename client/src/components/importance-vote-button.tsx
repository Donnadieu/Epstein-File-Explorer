import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImportanceVoteButtonProps {
  documentId: number;
  isVoted: boolean;
  count: number;
  onToggle: (documentId: number) => void;
  size?: "sm" | "default";
  className?: string;
}

export function ImportanceVoteButton({
  documentId,
  isVoted,
  count,
  onToggle,
  size = "sm",
  className,
}: ImportanceVoteButtonProps) {
  return (
    <Button
      variant="ghost"
      size={size === "sm" ? "sm" : "default"}
      className={cn(
        "gap-1 px-2",
        isVoted
          ? "text-amber-500 hover:text-amber-600"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(documentId);
      }}
      aria-label={isVoted ? "Remove importance vote" : "Mark as important"}
      data-testid={`vote-button-${documentId}`}
    >
      <Star className={cn("w-4 h-4", isVoted && "fill-current")} />
      {count > 0 && <span className="text-xs font-medium">{count}</span>}
    </Button>
  );
}
