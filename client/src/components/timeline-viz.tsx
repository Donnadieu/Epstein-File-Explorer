import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Clock,
  Scale,
  AlertTriangle,
  FileText,
  Users,
  Plane,
  Gavel,
  Building2,
  ChevronRight,
} from "lucide-react";
import type { TimelineEvent } from "@shared/schema";

const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  legal: Scale,
  arrest: AlertTriangle,
  investigation: FileText,
  travel: Plane,
  court: Gavel,
  political: Building2,
  death: AlertTriangle,
  disclosure: FileText,
  relationship: Users,
};

const categoryBadgeColors: Record<string, string> = {
  legal: "bg-chart-2/10 text-chart-2",
  arrest: "bg-destructive/10 text-destructive",
  investigation: "bg-primary/10 text-primary",
  travel: "bg-chart-3/10 text-chart-3",
  court: "bg-chart-4/10 text-chart-4",
  political: "bg-chart-5/10 text-chart-5",
  death: "bg-destructive/10 text-destructive",
  disclosure: "bg-primary/10 text-primary",
  relationship: "bg-chart-2/10 text-chart-2",
};

const categoryNodeColors: Record<string, string> = {
  legal: "bg-chart-2",
  arrest: "bg-destructive",
  investigation: "bg-primary",
  travel: "bg-chart-3",
  court: "bg-chart-4",
  political: "bg-chart-5",
  death: "bg-destructive",
  disclosure: "bg-primary",
  relationship: "bg-chart-2",
};

const significanceSize: Record<number, { dot: string; ring: string }> = {
  1: { dot: "w-3 h-3", ring: "w-5 h-5" },
  2: { dot: "w-4 h-4", ring: "w-6 h-6" },
  3: { dot: "w-5 h-5", ring: "w-7 h-7" },
};

interface YearGroup {
  year: number;
  events: TimelineEvent[];
}

function groupByYear(events: TimelineEvent[]): YearGroup[] {
  const map = new Map<number, TimelineEvent[]>();
  for (const event of events) {
    const year = parseInt(event.date.slice(0, 4), 10);
    if (!map.has(year)) map.set(year, []);
    map.get(year)!.push(event);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, events]) => ({ year, events }));
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

interface TimelineVizProps {
  events: TimelineEvent[];
}

export default function TimelineViz({ events }: TimelineVizProps) {
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());

  const yearGroups = useMemo(() => groupByYear(events), [events]);

  const toggleYear = (year: number) => {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Clock className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No events match your filters.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical timeline spine */}
      <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-px bg-border md:-translate-x-px" />

      {yearGroups.map((group) => {
        const isOpen = !collapsedYears.has(group.year);
        const keyCount = group.events.filter((e) => e.significance >= 2).length;

        return (
          <Collapsible
            key={group.year}
            open={isOpen}
            onOpenChange={() => toggleYear(group.year)}
          >
            {/* Year header */}
            <CollapsibleTrigger asChild>
              <button
                className="relative z-10 flex items-center gap-2 mb-2 mt-6 first:mt-0 group cursor-pointer w-full md:justify-center"
                style={{ paddingLeft: "0" }}
              >
                <div className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-full border border-border shadow-sm">
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                  <span className="text-lg font-bold tracking-tight">{group.year}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {group.events.length}
                  </Badge>
                  {keyCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary">
                      {keyCount} key
                    </Badge>
                  )}
                </div>
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="flex flex-col gap-1">
                {group.events.map((event, idx) => {
                  const Icon = categoryIcons[event.category] || Clock;
                  const nodeColor = categoryNodeColors[event.category] || "bg-muted-foreground";
                  const size = significanceSize[event.significance] || significanceSize[1];
                  const isHigh = event.significance >= 3;
                  const isLeft = idx % 2 === 0;

                  return (
                    <div
                      key={event.id}
                      className="relative py-2"
                      data-testid={`card-event-${event.id}`}
                    >
                      {/* Mobile: single column with left spine */}
                      <div className="md:hidden flex items-start gap-3 pl-0">
                        {/* Node on the spine */}
                        <div className="relative z-10 flex items-center justify-center shrink-0 w-8">
                          <div className={`${size.ring} rounded-full flex items-center justify-center ${isHigh ? "bg-primary/15" : ""}`}>
                            <div className={`${size.dot} rounded-full ${nodeColor} ring-2 ring-background`} />
                          </div>
                        </div>
                        <EventCard event={event} Icon={Icon} nodeColor={nodeColor} isHigh={isHigh} />
                      </div>

                      {/* Desktop: alternating left/right */}
                      <div className="hidden md:grid md:grid-cols-[1fr_auto_1fr] md:gap-4 items-start">
                        {/* Left column */}
                        <div className={`flex ${isLeft ? "justify-end" : ""}`}>
                          {isLeft && <EventCard event={event} Icon={Icon} nodeColor={nodeColor} isHigh={isHigh} align="right" />}
                        </div>

                        {/* Center node */}
                        <div className="relative z-10 flex items-center justify-center w-8">
                          <div className={`${size.ring} rounded-full flex items-center justify-center ${isHigh ? "bg-primary/15" : ""}`}>
                            <div className={`${size.dot} rounded-full ${nodeColor} ring-2 ring-background`} />
                          </div>
                        </div>

                        {/* Right column */}
                        <div className={`flex ${!isLeft ? "justify-start" : ""}`}>
                          {!isLeft && <EventCard event={event} Icon={Icon} nodeColor={nodeColor} isHigh={isHigh} align="left" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

function EventCard({
  event,
  Icon,
  nodeColor,
  isHigh,
  align = "left",
}: {
  event: TimelineEvent;
  Icon: React.ComponentType<{ className?: string }>;
  nodeColor: string;
  isHigh: boolean;
  align?: "left" | "right";
}) {
  return (
    <Card className={`flex-1 max-w-md ${isHigh ? "border-primary/30" : ""} ${align === "right" ? "text-right" : ""}`}>
      <CardContent className="p-3">
        <div className={`flex flex-col gap-1.5 ${align === "right" ? "items-end" : "items-start"}`}>
          <div className={`flex items-center gap-1.5 flex-wrap ${align === "right" ? "flex-row-reverse" : ""}`}>
            <span className="text-[11px] font-mono text-muted-foreground">{formatDate(event.date)}</span>
            <Badge
              variant="secondary"
              className={`text-[10px] px-1 py-0 ${categoryBadgeColors[event.category] || ""}`}
            >
              <Icon className="w-2.5 h-2.5 mr-0.5" />
              {event.category}
            </Badge>
          </div>
          <h3 className={`text-sm font-semibold leading-tight ${isHigh ? "text-foreground" : "text-foreground/80"}`}>
            {event.title}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{event.description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
