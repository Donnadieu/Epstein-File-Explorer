import { ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={size === "sm" ? "sm" : "default"}
            className={cn(
              "gap-1 px-2",
              isVoted
                ? "text-primary hover:text-primary/80"
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
            <ThumbsUp className={cn("w-3.5 h-3.5", isVoted && "fill-current")} />
            {count > 0 && <span className="text-xs font-medium">{count}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{isVoted ? "Remove vote" : "Mark as important"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
