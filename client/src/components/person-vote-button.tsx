import { ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PersonVoteButtonProps {
  personId: number;
  isVoted: boolean;
  count: number;
  onToggle: (personId: number) => void;
  size?: "sm" | "default";
  className?: string;
}

export function PersonVoteButton({
  personId,
  isVoted,
  count,
  onToggle,
  size = "sm",
  className,
}: PersonVoteButtonProps) {
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
              onToggle(personId);
            }}
            aria-label={isVoted ? "Remove vote" : "Mark as important"}
            data-testid={`person-vote-button-${personId}`}
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
