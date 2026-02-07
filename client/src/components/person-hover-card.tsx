import { Link } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { FileText, Network, Briefcase, ArrowRight } from "lucide-react";
import type { Person } from "@shared/schema";

const categoryColors: Record<string, string> = {
  "key figure": "bg-destructive/10 text-destructive",
  associate: "bg-primary/10 text-primary",
  victim: "bg-chart-4/10 text-chart-4",
  witness: "bg-chart-3/10 text-chart-3",
  legal: "bg-chart-2/10 text-chart-2",
  political: "bg-chart-5/10 text-chart-5",
};

interface PersonHoverCardProps {
  person: Pick<Person, "id" | "name" | "category" | "occupation" | "documentCount" | "connectionCount">;
  children: React.ReactNode;
}

export function PersonHoverCard({ person, children }: PersonHoverCardProps) {
  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-72" side="top" align="start">
        <div className="flex gap-3">
          <Avatar className="w-10 h-10 border border-border shrink-0">
            <AvatarFallback className="text-xs font-medium bg-muted">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate">{person.name}</span>
              <Badge
                variant="secondary"
                className={`text-[10px] shrink-0 ${categoryColors[person.category] || ""}`}
              >
                {person.category}
              </Badge>
            </div>
            {person.occupation && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Briefcase className="w-3 h-3 shrink-0" /> {person.occupation}
              </span>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" /> {person.documentCount} docs
              </span>
              <span className="flex items-center gap-1">
                <Network className="w-3 h-3" /> {person.connectionCount} connections
              </span>
            </div>
            <Link href={`/people/${person.id}`}>
              <span className="text-xs text-primary flex items-center gap-1 mt-0.5 hover:underline cursor-pointer">
                View Profile <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
