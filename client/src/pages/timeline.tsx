import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Clock,
  Scale,
  AlertTriangle,
  FileText,
  Users,
  Plane,
  Gavel,
  Building2,
  Filter,
} from "lucide-react";
import type { TimelineEvent } from "@shared/schema";

const categoryIcons: Record<string, any> = {
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

const significanceDots: Record<number, string> = {
  1: "w-2 h-2",
  2: "w-2.5 h-2.5",
  3: "w-3 h-3",
};

export default function TimelinePage() {
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: events, isLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["/api/timeline"],
  });

  const categories = ["all", ...new Set(events?.map((e) => e.category) || [])];

  const filtered = events?.filter(
    (e) => categoryFilter === "all" || e.category === categoryFilter
  );

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-timeline-title">
          <Clock className="w-6 h-6 text-primary" />
          Case Timeline
        </h1>
        <p className="text-sm text-muted-foreground">
          Chronological overview of key events related to the Epstein case, from early investigations through document releases.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3 h-3 text-muted-foreground" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44" data-testid="select-timeline-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat === "all" ? "All Categories" : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categoryFilter !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setCategoryFilter("all")} data-testid="button-clear-timeline-filter">
            Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="w-24 h-6" />
              <Skeleton className="h-20 flex-1" />
            </div>
          ))}
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
          <div className="flex flex-col gap-1">
            {filtered?.map((event, index) => {
              const Icon = categoryIcons[event.category] || Clock;
              const dotSize = significanceDots[event.significance] || significanceDots[1];
              const isHighSignificance = event.significance >= 3;

              return (
                <div key={event.id} className="relative flex items-start gap-4 py-3 group">
                  <div className="relative z-10 flex items-center justify-center shrink-0">
                    <div
                      className={`${dotSize} rounded-full ${
                        isHighSignificance ? "bg-primary" : "bg-muted-foreground/40"
                      } ring-2 ring-background`}
                    />
                  </div>

                  <Card className={`flex-1 ${isHighSignificance ? "border-primary/20" : ""}`} data-testid={`card-event-${event.id}`}>
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground">{event.date}</span>
                            <Badge
                              variant="secondary"
                              className={`text-[10px] ${categoryBadgeColors[event.category] || ""}`}
                            >
                              <Icon className="w-2.5 h-2.5 mr-0.5" />
                              {event.category}
                            </Badge>
                          </div>
                        </div>
                        <h3 className={`text-sm font-semibold ${isHighSignificance ? "text-foreground" : ""}`}>
                          {event.title}
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">{event.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
          {filtered?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 relative z-10">
              <Clock className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No events match this filter.</p>
              <Button variant="outline" size="sm" onClick={() => setCategoryFilter("all")}>
                Show all events
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
