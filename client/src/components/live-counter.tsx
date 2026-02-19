import { useActiveUsers } from "@/hooks/use-active-users";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function LiveCounter() {
  const { count, isConnected } = useActiveUsers();

  if (!isConnected) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 mr-1",
            "bg-muted/60 text-sm select-none cursor-default"
          )}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="font-semibold tabular-nums">{count}</span>
          <span className="hidden sm:inline text-muted-foreground">
            active users
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{count} {count === 1 ? "person" : "people"} exploring the archive right now</p>
      </TooltipContent>
    </Tooltip>
  );
}
