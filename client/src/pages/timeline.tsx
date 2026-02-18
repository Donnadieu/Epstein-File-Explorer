import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { TimelineEvent } from "@shared/schema";
import TimelineViz from "@/components/timeline-viz";
import { useUrlFilters } from "@/hooks/use-url-filters";

interface EnrichedTimelineEvent extends TimelineEvent {
  persons?: { id: number; name: string }[];
  documents?: { id: number; title: string }[];
}

const ITEMS_PER_PAGE = 50;

const CATEGORIES = [
  "all", "legal", "arrest", "investigation", "travel",
  "court", "political", "death", "disclosure", "relationship",
];

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
  const [filters, setFilter, resetFilters] = useUrlFilters({
    category: "all",
    significance: "all",
    yearFrom: "1980",
    yearTo: "",
    page: "1",
  });

  const currentPage = Math.max(1, parseInt(filters.page) || 1);

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(currentPage));
  queryParams.set("limit", String(ITEMS_PER_PAGE));
  if (filters.category !== "all") queryParams.set("category", filters.category);
  if (filters.yearFrom) queryParams.set("yearFrom", filters.yearFrom);
  if (filters.yearTo) queryParams.set("yearTo", filters.yearTo);
  if (filters.significance === "key") queryParams.set("significance", "5");

  const { data: result, isLoading } = useQuery<{
    data: EnrichedTimelineEvent[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: [`/api/timeline?${queryParams.toString()}`],
    placeholderData: keepPreviousData,
  });

  const events = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;

  const hasActiveFilters =
    filters.category !== "all" ||
    filters.significance !== "all" ||
    filters.yearFrom !== "1980" ||
    filters.yearTo !== "";

  const goToPage = (p: number) => setFilter("page", String(p));

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilter(key, value);
    setFilter("page", "1");
  };

  const clearFilters = () => {
    resetFilters();
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
            variant={filters.yearFrom === String(d.start) && filters.yearTo === String(d.end) ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => {
              if (d.start === 0) {
                handleFilterChange("yearFrom", "");
                setFilter("yearTo", "");
              } else if (filters.yearFrom === String(d.start) && filters.yearTo === String(d.end)) {
                handleFilterChange("yearFrom", "1980");
                setFilter("yearTo", "");
              } else {
                handleFilterChange("yearFrom", String(d.start));
                setFilter("yearTo", String(d.end));
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
        <Select value={filters.category} onValueChange={(v) => handleFilterChange("category", v)}>
          <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-timeline-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat === "all" ? "All Categories" : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Significance toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <Button
            variant={filters.significance === "all" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs rounded-none px-2.5"
            onClick={() => handleFilterChange("significance", "all")}
          >
            <Eye className="w-3 h-3 mr-1" />
            All
          </Button>
          <Button
            variant={filters.significance === "key" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs rounded-none px-2.5"
            onClick={() => handleFilterChange("significance", "key")}
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
            value={filters.yearFrom}
            onChange={(e) => handleFilterChange("yearFrom", e.target.value)}
            className="w-20 h-8 text-xs"
            min={1950}
            max={2030}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <Input
            type="number"
            placeholder="To"
            value={filters.yearTo}
            onChange={(e) => handleFilterChange("yearTo", e.target.value)}
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
            {total} event{total !== 1 ? "s" : ""}
          </Badge>
          {totalPages > 1 && (
            <span>page {currentPage} of {totalPages}</span>
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
        <TimelineViz events={events} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-3">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
