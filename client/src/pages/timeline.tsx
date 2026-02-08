import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Clock,
  Filter,
  Eye,
  Star,
  X,
} from "lucide-react";
import type { TimelineEvent } from "@shared/schema";
import TimelineViz from "@/components/timeline-viz";

const DECADES = [
  { label: "All Time", start: 0, end: 2099 },
  { label: "1950s", start: 1950, end: 1959 },
  { label: "1980s", start: 1980, end: 1989 },
  { label: "1990s", start: 1990, end: 1999 },
  { label: "2000s", start: 2000, end: 2009 },
  { label: "2010s", start: 2010, end: 2019 },
  { label: "2020s", start: 2020, end: 2029 },
];

export default function TimelinePage() {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [zoomLevel, setZoomLevel] = useState<"all" | "key">("all");
  const [yearFrom, setYearFrom] = useState("1980");
  const [yearTo, setYearTo] = useState("");

  const { data: events, isLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["/api/timeline"],
  });

  const categories = useMemo(
    () => ["all", ...new Set(events?.map((e) => e.category) || [])],
    [events]
  );

  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter((e) => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (zoomLevel === "key" && e.significance < 2) return false;
      const year = parseInt(e.date.slice(0, 4), 10);
      if (yearFrom && year < parseInt(yearFrom, 10)) return false;
      if (yearTo && year > parseInt(yearTo, 10)) return false;
      return true;
    });
  }, [events, categoryFilter, zoomLevel, yearFrom, yearTo]);

  const hasActiveFilters = categoryFilter !== "all" || zoomLevel !== "all" || yearFrom !== "1980" || yearTo;

  const clearFilters = () => {
    setCategoryFilter("all");
    setZoomLevel("all");
    setYearFrom("1980");
    setYearTo("");
  };

  const jumpToDecade = (start: number, end: number) => {
    setYearFrom(String(start));
    setYearTo(String(end));
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-timeline-title">
          <Clock className="w-6 h-6 text-primary" />
          Case Timeline
        </h1>
        <p className="text-sm text-muted-foreground">
          Chronological overview of key events related to the Epstein case, from early investigations through document releases.
        </p>
      </div>

      {/* Decade quick-jump */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Jump to:</span>
        {DECADES.map((d) => (
          <Button
            key={d.label}
            variant={yearFrom === String(d.start) && yearTo === String(d.end) ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => {
              if (d.start === 0) {
                setYearFrom("");
                setYearTo("");
              } else if (yearFrom === String(d.start) && yearTo === String(d.end)) {
                setYearFrom("1980");
                setYearTo("");
              } else {
                jumpToDecade(d.start, d.end);
              }
            }}
          >
            {d.label}
          </Button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3 h-3 text-muted-foreground" />

        {/* Category filter */}
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-timeline-category">
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

        {/* Zoom level toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <Button
            variant={zoomLevel === "all" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs rounded-none px-2.5"
            onClick={() => setZoomLevel("all")}
          >
            <Eye className="w-3 h-3 mr-1" />
            All
          </Button>
          <Button
            variant={zoomLevel === "key" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs rounded-none px-2.5"
            onClick={() => setZoomLevel("key")}
          >
            <Star className="w-3 h-3 mr-1" />
            Key Only
          </Button>
        </div>

        {/* Year range */}
        <div className="flex items-center gap-1">
          <Input
            type="number"
            placeholder="From"
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            className="w-20 h-8 text-xs"
            min={1950}
            max={2030}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <Input
            type="number"
            placeholder="To"
            value={yearTo}
            onChange={(e) => setYearTo(e.target.value)}
            className="w-20 h-8 text-xs"
            min={1950}
            max={2030}
          />
        </div>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={clearFilters}
            data-testid="button-clear-timeline-filter"
          >
            <X className="w-3 h-3 mr-1" />
            Clear all
          </Button>
        )}
      </div>

      {/* Event count */}
      {!isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          </Badge>
          {hasActiveFilters && events && (
            <span>of {events.length} total</span>
          )}
        </div>
      )}

      {/* Timeline content */}
      {isLoading ? (
        <div className="flex flex-col gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="w-32 h-8 mx-auto rounded-full" />
              <div className="flex gap-4 items-start">
                <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                <Skeleton className="h-24 flex-1 rounded-lg" />
              </div>
              <div className="flex gap-4 items-start">
                <Skeleton className="h-20 flex-1 rounded-lg" />
                <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <TimelineViz events={filtered} />
      )}
    </div>
  );
}
