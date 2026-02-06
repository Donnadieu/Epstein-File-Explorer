import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Search, FileText, Network, ArrowUpDown } from "lucide-react";
import type { Person } from "@shared/schema";

const categoryColors: Record<string, string> = {
  "key figure": "bg-destructive/10 text-destructive",
  associate: "bg-primary/10 text-primary",
  victim: "bg-chart-4/10 text-chart-4",
  witness: "bg-chart-3/10 text-chart-3",
  legal: "bg-chart-2/10 text-chart-2",
  political: "bg-chart-5/10 text-chart-5",
};

export default function PeoplePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("documentCount");

  const { data: persons, isLoading } = useQuery<Person[]>({
    queryKey: ["/api/persons"],
  });

  const filtered = persons
    ?.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.occupation || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      if (sortBy === "documentCount") return b.documentCount - a.documentCount;
      if (sortBy === "connectionCount") return b.connectionCount - a.connectionCount;
      return a.name.localeCompare(b.name);
    });

  const categories = ["all", ...new Set(persons?.map((p) => p.category) || [])];

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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-people-search"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
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
        <Select value={sortBy} onValueChange={setSortBy}>
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
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {filtered?.length || 0} of {persons?.length || 0} individuals
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered?.map((person) => {
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
          {filtered?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Users className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No individuals match your search.</p>
              <Button variant="outline" size="sm" onClick={() => { setSearchQuery(""); setCategoryFilter("all"); }} data-testid="button-clear-filters">
                Clear filters
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
