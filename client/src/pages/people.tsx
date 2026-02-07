import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Search, FileText, Network, ArrowUpDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useUrlFilters } from "@/hooks/use-url-filters";
import type { Person } from "@shared/schema";

const ITEMS_PER_PAGE = 50;

const categoryColors: Record<string, string> = {
  "key figure": "bg-destructive/10 text-destructive",
  associate: "bg-primary/10 text-primary",
  victim: "bg-chart-4/10 text-chart-4",
  witness: "bg-chart-3/10 text-chart-3",
  legal: "bg-chart-2/10 text-chart-2",
  political: "bg-chart-5/10 text-chart-5",
};

const filterLabels: Record<string, string> = {
  search: "Search",
  category: "Category",
  sort: "Sort",
};

function PersonCardSkeleton({ index }: { index: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3" style={{ animationDelay: `${index * 75}ms` }}>
          <Skeleton className="w-12 h-12 rounded-full shrink-0" />
          <div className="flex flex-col gap-1.5 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <div className="flex gap-2 mt-1">
              <Skeleton className="h-4 w-16 rounded-full" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PeoplePage() {
  const [filters, setFilter, resetFilters] = useUrlFilters({
    search: "",
    category: "all",
    sort: "documentCount",
    page: "1",
  });

  const { data: persons, isLoading } = useQuery<Person[]>({
    queryKey: ["/api/persons"],
  });

  const filtered = useMemo(() => {
    return persons
      ?.filter((p) => {
        const matchesSearch =
          !filters.search ||
          p.name.toLowerCase().includes(filters.search.toLowerCase()) ||
          (p.occupation || "").toLowerCase().includes(filters.search.toLowerCase()) ||
          (p.description || "").toLowerCase().includes(filters.search.toLowerCase());
        const matchesCategory = filters.category === "all" || p.category === filters.category;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        if (filters.sort === "documentCount") return b.documentCount - a.documentCount;
        if (filters.sort === "connectionCount") return b.connectionCount - a.connectionCount;
        return a.name.localeCompare(b.name);
      });
  }, [persons, filters.search, filters.category, filters.sort]);

  const categories = ["all", ...new Set(persons?.map((p) => p.category) || [])];

  const totalItems = filtered?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  const currentPage = Math.min(Math.max(1, parseInt(filters.page) || 1), totalPages);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginated = filtered?.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const activeFilters = Object.entries(filters).filter(
    ([key, value]) =>
      key !== "page" && key !== "sort" &&
      value !== "" && value !== "all"
  );

  const goToPage = (page: number) => setFilter("page", String(page));

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-people-title">
          <Users className="w-6 h-6 text-primary" />
          People Directory
        </h1>
        <p className="text-sm text-muted-foreground">
          Individuals mentioned in the publicly released Epstein files. Being listed does not imply any wrongdoing.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name, occupation..."
            value={filters.search}
            onChange={(e) => {
              setFilter("search", e.target.value);
              setFilter("page", "1");
            }}
            className="pl-9"
            data-testid="input-people-search"
          />
        </div>
        <Select value={filters.category} onValueChange={(v) => { setFilter("category", v); setFilter("page", "1"); }}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-category-filter">
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
        <Select value={filters.sort} onValueChange={(v) => setFilter("sort", v)}>
          <SelectTrigger className="w-full sm:w-44" data-testid="select-sort">
            <ArrowUpDown className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="documentCount">Most Documents</SelectItem>
            <SelectItem value="connectionCount">Most Connections</SelectItem>
            <SelectItem value="name">Alphabetical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <PersonCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {totalItems === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + ITEMS_PER_PAGE, totalItems)} of {totalItems} individuals
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paginated?.map((person) => {
              const initials = person.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2);

              return (
                <Link key={person.id} href={`/people/${person.id}`}>
                  <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-person-${person.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="w-12 h-12 border border-border shrink-0">
                          <AvatarFallback className="text-sm font-medium bg-muted">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="text-sm font-semibold">{person.name}</span>
                          <span className="text-xs text-muted-foreground truncate">{person.occupation || person.role}</span>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{person.description}</p>
                          <div className="flex items-center gap-2 flex-wrap mt-2">
                            <Badge
                              variant="secondary"
                              className={`text-[10px] ${categoryColors[person.category] || ""}`}
                            >
                              {person.category}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <FileText className="w-2.5 h-2.5" /> {person.documentCount}
                            </span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Network className="w-2.5 h-2.5" /> {person.connectionCount}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          {totalItems === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Users className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground text-center max-w-md">
                No individuals match these filters.
                {filters.search && ` Try a different search term.`}
                {filters.category !== "all" && ` Try removing the "${filters.category}" category filter.`}
              </p>
              {activeFilters.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {activeFilters.map(([key, value]) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => setFilter(key, key === "category" ? "all" : "")}
                    >
                      {filterLabels[key] || key}: {value}
                      <X className="w-3 h-3" />
                    </Button>
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" onClick={resetFilters} data-testid="button-clear-filters">
                Clear all filters
              </Button>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
                data-testid="button-prev-page"
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
                data-testid="button-next-page"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
