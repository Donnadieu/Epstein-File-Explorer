import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Network,
  Search,
  X,
  ExternalLink,
  ChevronRight,
  SlidersHorizontal,
  Loader2,
  FileText,
  Users,
  Link2,
  Focus,
} from "lucide-react";
import type { Connection } from "@shared/schema";
import NetworkGraph, { getCategoryColor } from "@/components/network-graph";

interface NetworkPerson {
  id: number;
  name: string;
  category: string;
  documentCount: number;
  connectionCount: number;
  imageUrl: string | null;
  occupation: string | null;
}

interface NetworkData {
  persons: NetworkPerson[];
  connections: (Connection & { person1Name: string; person2Name: string })[];
  timelineYearRange: [number, number];
  personYears: Record<number, [number, number]>;
}

const connectionTypeColors: Record<string, string> = {
  "business associate": "bg-primary/10 text-primary",
  "social connection": "bg-chart-3/10 text-chart-3",
  "legal counsel": "bg-chart-2/10 text-chart-2",
  employee: "bg-chart-4/10 text-chart-4",
  "co-conspirator": "bg-destructive/10 text-destructive",
  "travel companion": "bg-chart-5/10 text-chart-5",
  "political ally": "bg-chart-5/10 text-chart-5",
  "victim testimony": "bg-chart-4/10 text-chart-4",
};

function FilterControls({
  searchQuery,
  setSearchQuery,
  allCategories,
  activeCategories,
  toggleCategory,
  activeConnectionTypes,
  toggleConnectionType,
  connectionTypes,
  keyword,
  setKeyword,
  minConnections,
  setMinConnections,
  maxConnections,
  minStrength,
  setMinStrength,
  minDocumentCount,
  setMinDocumentCount,
  timeRange,
  setTimeRange,
  yearRange,
}: {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  allCategories: string[];
  activeCategories: Set<string>;
  toggleCategory: (cat: string) => void;
  activeConnectionTypes: Set<string>;
  toggleConnectionType: (type: string) => void;
  connectionTypes: string[];
  keyword: string;
  setKeyword: (v: string) => void;
  minConnections: number;
  setMinConnections: (v: number) => void;
  maxConnections: number;
  minStrength: number;
  setMinStrength: (v: number) => void;
  minDocumentCount: number;
  setMinDocumentCount: (v: number) => void;
  timeRange: [number, number] | null;
  setTimeRange: (v: [number, number]) => void;
  yearRange: [number, number] | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Entity search */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Search People
        </Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
            data-testid="input-network-search"
          />
        </div>
      </div>

      {/* Category checkboxes */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Categories
        </Label>
        <div className="flex flex-col gap-1.5">
          {allCategories.map((cat) => (
            <label key={cat} className="flex items-center gap-2 cursor-pointer py-0.5">
              <Checkbox
                checked={activeCategories.has(cat)}
                onCheckedChange={() => toggleCategory(cat)}
              />
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: getCategoryColor(cat) }}
              />
              <span className="text-sm capitalize">{cat}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Min connections slider */}
      {maxConnections > 1 && (
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
            Min. Connections: {minConnections}
          </Label>
          <div className="px-1">
            <Slider
              min={1}
              max={maxConnections}
              step={1}
              value={[minConnections]}
              onValueChange={(v) => setMinConnections(v[0])}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
            <span>1</span>
            <span>{maxConnections}</span>
          </div>
        </div>
      )}

      {/* Min strength slider */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Min. Strength: {minStrength}
        </Label>
        <div className="px-1">
          <Slider
            min={1}
            max={5}
            step={1}
            value={[minStrength]}
            onValueChange={(v) => setMinStrength(v[0])}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
          <span>1 (weak)</span>
          <span>5 (strong)</span>
        </div>
      </div>

      {/* Min source documents slider */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Min. Source Docs: {minDocumentCount}
        </Label>
        <div className="px-1">
          <Slider
            min={1}
            max={10}
            step={1}
            value={[minDocumentCount]}
            onValueChange={(v) => setMinDocumentCount(v[0])}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
          <span>1</span>
          <span>10+</span>
        </div>
      </div>

      {/* Connection type checkboxes */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Connection Types
        </Label>
        <div className="flex flex-col gap-1.5">
          {connectionTypes.map((type) => (
            <label key={type} className="flex items-center gap-2 cursor-pointer py-0.5">
              <Checkbox
                checked={activeConnectionTypes.has(type)}
                onCheckedChange={() => toggleConnectionType(type)}
              />
              <span className="text-sm capitalize">{type}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Keyword filter */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Keyword Filter
        </Label>
        <Input
          type="search"
          placeholder="Filter by description..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* Time range slider */}
      {yearRange && timeRange && (
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
            Time Range
          </Label>
          <div className="px-1">
            <Slider
              min={yearRange[0]}
              max={yearRange[1]}
              step={1}
              value={timeRange}
              onValueChange={(v) => setTimeRange(v as [number, number])}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
            <span>{timeRange[0]}</span>
            <span>{timeRange[1]}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NetworkPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<number | null>(null);
  const [focusedNode, setFocusedNode] = useState<number | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [activeConnectionTypes, setActiveConnectionTypes] = useState<Set<string> | null>(null);
  const [keyword, setKeyword] = useState("");
  const [minConnections, setMinConnections] = useState(1);
  const [minStrength, setMinStrength] = useState(2);
  const [minDocumentCount, setMinDocumentCount] = useState(2);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const [graphReady, setGraphReady] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const { data, isLoading } = useQuery<NetworkData>({
    queryKey: ["/api/network"],
    staleTime: 300_000,
  });

  // Derive all categories from data
  const allCategories = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.persons.map((p) => p.category))).sort();
  }, [data]);

  // Initialize activeCategories when allCategories arrives
  useEffect(() => {
    if (allCategories.length > 0 && activeCategories.size === 0) {
      setActiveCategories(new Set(allCategories));
    }
  }, [allCategories, activeCategories.size]);

  // Initialize connection type filter and time range when data arrives
  const connectionTypes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.connections.map((c) => c.connectionType)));
  }, [data]);

  // Initialize activeConnectionTypes when connectionTypes first loads
  if (activeConnectionTypes === null && connectionTypes.length > 0) {
    setActiveConnectionTypes(new Set(connectionTypes));
  }

  // Initialize time range when data loads
  const yearRange = data?.timelineYearRange ?? null;
  if (timeRange === null && yearRange) {
    setTimeRange(yearRange);
  }

  const effectiveConnectionTypes = activeConnectionTypes ?? new Set(connectionTypes);

  // Filter chain
  // 0. Only persons mentioned in documents
  const docPersons = useMemo(() => {
    if (!data) return [];
    return data.persons.filter((p) => (p.documentCount ?? 0) > 0);
  }, [data]);

  // 1. Time range -> filter persons
  const timeFilteredPersons = useMemo(() => {
    if (!timeRange) return docPersons;
    return docPersons.filter((p) => {
      const years = data?.personYears[p.id];
      if (!years) return true;
      return years[1] >= timeRange[0] && years[0] <= timeRange[1];
    });
  }, [docPersons, data, timeRange]);

  // 2. Category -> filter persons
  const categoryFilteredPersons = useMemo(() => {
    return timeFilteredPersons.filter((p) => activeCategories.has(p.category));
  }, [timeFilteredPersons, activeCategories]);

  const categoryPersonIds = useMemo(
    () => new Set(categoryFilteredPersons.map((p) => p.id)),
    [categoryFilteredPersons],
  );

  // 3. Connection type -> filter connections
  const typeFilteredConnections = useMemo(() => {
    if (!data) return [];
    return data.connections.filter(
      (c) =>
        effectiveConnectionTypes.has(c.connectionType) &&
        categoryPersonIds.has(c.personId1) &&
        categoryPersonIds.has(c.personId2),
    );
  }, [data, effectiveConnectionTypes, categoryPersonIds]);

  // 4a. Strength filter -> drop weak connections
  const strengthFilteredConnections = useMemo(() => {
    if (minStrength <= 1) return typeFilteredConnections;
    return typeFilteredConnections.filter((c) => c.strength >= minStrength);
  }, [typeFilteredConnections, minStrength]);

  // 4b. Document count filter -> require connections sourced from N+ documents
  const docCountFilteredConnections = useMemo(() => {
    if (minDocumentCount <= 1) return strengthFilteredConnections;
    return strengthFilteredConnections.filter(
      (c) => (c.documentIds?.length ?? 0) >= minDocumentCount,
    );
  }, [strengthFilteredConnections, minDocumentCount]);

  // 5. Keyword -> filter connections by description
  const keywordFilteredConnections = useMemo(() => {
    if (!keyword) return docCountFilteredConnections;
    const kw = keyword.toLowerCase();
    return docCountFilteredConnections.filter(
      (c) => c.description && c.description.toLowerCase().includes(kw),
    );
  }, [docCountFilteredConnections, keyword]);

  // 6. Derive persons from remaining connections
  const filteredConnections = keywordFilteredConnections;
  const connCountPerPerson = useMemo(() => {
    const counts: Record<number, number> = {};
    filteredConnections.forEach((c) => {
      counts[c.personId1] = (counts[c.personId1] || 0) + 1;
      counts[c.personId2] = (counts[c.personId2] || 0) + 1;
    });
    return counts;
  }, [filteredConnections]);

  // 7. Apply min connections filter
  const graphPersons = useMemo(() => {
    const ids = new Set<number>();
    filteredConnections.forEach((c) => {
      ids.add(c.personId1);
      ids.add(c.personId2);
    });
    return categoryFilteredPersons.filter(
      (p) => ids.has(p.id) && (connCountPerPerson[p.id] || 0) >= minConnections,
    );
  }, [categoryFilteredPersons, filteredConnections, connCountPerPerson, minConnections]);

  // Re-filter connections to only include edges where both endpoints survived minConnections
  const graphPersonIds = useMemo(() => new Set(graphPersons.map((p) => p.id)), [graphPersons]);
  const graphConnections = useMemo(() => {
    return filteredConnections.filter(
      (c) => graphPersonIds.has(c.personId1) && graphPersonIds.has(c.personId2),
    );
  }, [filteredConnections, graphPersonIds]);

  // Max connections for slider range
  const maxConnections = useMemo(() => {
    const vals = Object.values(connCountPerPerson);
    return vals.length > 0 ? Math.max(...vals) : 1;
  }, [connCountPerPerson]);

  // Total unfiltered connection count for "X of Y" display
  const totalConnectionCount = data?.connections.length ?? 0;

  // Document count: sum of documentCount across visible persons
  const totalDocs = useMemo(() => {
    return graphPersons.reduce((sum, p) => sum + (p.documentCount ?? 0), 0);
  }, [graphPersons]);

  // Selected person details
  const selectedPersonData = useMemo(() => {
    if (!data || selectedPerson === null) return null;
    return data.persons.find((p) => p.id === selectedPerson) ?? null;
  }, [data, selectedPerson]);

  const selectedPersonConnections = useMemo(() => {
    if (!data || selectedPerson === null) return [];
    return graphConnections.filter(
      (c) => c.personId1 === selectedPerson || c.personId2 === selectedPerson,
    );
  }, [data, graphConnections, selectedPerson]);

  // Focused person name
  const focusedPersonName = useMemo(() => {
    if (!data || focusedNode === null) return null;
    return data.persons.find((p) => p.id === focusedNode)?.name ?? null;
  }, [data, focusedNode]);

  const handleSelectPerson = useCallback((id: number | null) => {
    setSelectedPerson(id);
  }, []);

  const handleFocusNode = useCallback((id: number | null) => {
    setFocusedNode(id);
  }, []);

  const handleGraphReady = useCallback(() => {
    setGraphReady(true);
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
    setGraphReady(false);
  }, []);

  const toggleConnectionType = useCallback((type: string) => {
    setActiveConnectionTypes((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    setGraphReady(false);
  }, []);

  const handleTimeRangeChange = useCallback((v: [number, number]) => {
    setTimeRange(v);
    setGraphReady(false);
  }, []);

  const handleKeywordChange = useCallback((v: string) => {
    setKeyword(v);
    setGraphReady(false);
  }, []);

  const handleMinConnectionsChange = useCallback((v: number) => {
    setMinConnections(v);
    setGraphReady(false);
  }, []);

  const handleMinStrengthChange = useCallback((v: number) => {
    setMinStrength(v);
    setGraphReady(false);
  }, []);

  const handleMinDocumentCountChange = useCallback((v: number) => {
    setMinDocumentCount(v);
    setGraphReady(false);
  }, []);

  // Mobile list data: persons sorted by connection count
  const mobileListPersons = useMemo(() => {
    return graphPersons
      .map((p) => ({ ...p, connCount: connCountPerPerson[p.id] || 0 }))
      .sort((a, b) => b.connCount - a.connCount);
  }, [graphPersons, connCountPerPerson]);

  const filterProps = {
    searchQuery,
    setSearchQuery,
    allCategories,
    activeCategories,
    toggleCategory,
    activeConnectionTypes: effectiveConnectionTypes,
    toggleConnectionType,
    connectionTypes,
    keyword,
    setKeyword: handleKeywordChange,
    minConnections,
    setMinConnections: handleMinConnectionsChange,
    maxConnections,
    minStrength,
    setMinStrength: handleMinStrengthChange,
    minDocumentCount,
    setMinDocumentCount: handleMinDocumentCountChange,
    timeRange,
    setTimeRange: handleTimeRangeChange,
    yearRange,
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 w-full h-full">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-network-title">
            <Network className="w-6 h-6 text-primary" />
            Relationship Network
          </h1>

          {/* Mobile filter button */}
          <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="md:hidden">
                <SlidersHorizontal className="w-4 h-4 mr-1.5" />
                Filters
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>Refine the network graph</SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <FilterControls {...filterProps} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
        <p className="text-sm text-muted-foreground">
          Interactive force-directed graph of connections between individuals. Click nodes to explore relationships.
        </p>
      </div>

      {/* Stats bar */}
      {!isLoading && data && (
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
            <Users className="w-3 h-3" />
            {graphPersons.length} People
          </Badge>
          <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
            <Link2 className="w-3 h-3" />
            {graphConnections.length} of {totalConnectionCount} Connections
          </Badge>
          <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
            <FileText className="w-3 h-3" />
            {totalDocs} Documents
          </Badge>
          {focusedPersonName && (
            <Badge variant="default" className="gap-1.5 text-xs font-normal">
              <Focus className="w-3 h-3" />
              Focused: {focusedPersonName}
              <button
                onClick={() => setFocusedNode(null)}
                className="ml-1 hover:text-primary-foreground/80"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {selectedPerson && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedPerson(null)} className="ml-auto h-7 text-xs" data-testid="button-clear-person">
              <X className="w-3 h-3 mr-1" />
              Clear selection
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 min-h-[500px] w-full rounded-lg border border-border bg-card flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Loading network data...</span>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop: Filter sidebar + Graph + optional detail sidebar */}
          <div className="hidden md:flex flex-1 gap-4 min-h-[500px]">
            {/* Filter sidebar */}
            <div className="w-[240px] shrink-0 border border-border rounded-lg bg-card p-4 overflow-y-auto max-h-[calc(100vh-260px)]">
              <FilterControls {...filterProps} />
            </div>

            {/* Graph area */}
            <div className={`flex-1 relative transition-all ${selectedPersonData ? "md:w-2/3" : "w-full"}`}>
              {/* Spinner overlay while graph computes */}
              {!graphReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-lg">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Computing layout...</span>
                  </div>
                </div>
              )}
              <NetworkGraph
                persons={graphPersons}
                connections={graphConnections}
                searchQuery={searchQuery}
                selectedPersonId={selectedPerson}
                focusedNodeId={focusedNode}
                onSelectPerson={handleSelectPerson}
                onFocusNode={handleFocusNode}
                onReady={handleGraphReady}
              />
            </div>

            {/* Detail sidebar */}
            {selectedPersonData && (
              <div className="w-80 shrink-0 border border-border rounded-lg bg-card p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-260px)]">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-border">
                      {selectedPersonData.imageUrl && <AvatarImage src={selectedPersonData.imageUrl} alt={selectedPersonData.name} />}
                      <AvatarFallback className="text-sm font-medium bg-muted">
                        {selectedPersonData.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="text-sm font-semibold">{selectedPersonData.name}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: getCategoryColor(selectedPersonData.category) }}
                        />
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {selectedPersonData.category}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedPerson(null)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {selectedPersonData.occupation && (
                  <p className="text-xs text-muted-foreground">{selectedPersonData.occupation}</p>
                )}

                <Link href={`/people/${selectedPersonData.id}`}>
                  <Button variant="outline" size="sm" className="w-full text-xs">
                    <ExternalLink className="w-3 h-3 mr-1.5" />
                    View full profile
                  </Button>
                </Link>

                <div className="border-t border-border pt-3">
                  <h4 className="text-xs font-semibold mb-2">
                    Connections ({selectedPersonConnections.length})
                  </h4>
                  <div className="flex flex-col gap-1.5">
                    {selectedPersonConnections.map((conn) => {
                      const otherId = conn.personId1 === selectedPerson ? conn.personId2 : conn.personId1;
                      const otherName = conn.personId1 === selectedPerson ? conn.person2Name : conn.person1Name;
                      return (
                        <div
                          key={conn.id}
                          className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                          onClick={() => setSelectedPerson(otherId)}
                        >
                          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="text-xs truncate flex-1">{otherName}</span>
                          <Badge
                            variant="secondary"
                            className={`text-[9px] shrink-0 ${connectionTypeColors[conn.connectionType] || ""}`}
                          >
                            {conn.connectionType}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Mobile: List view */}
          <div className="flex flex-col gap-2 md:hidden">
            {mobileListPersons.map((person) => {
              const isExpanded = selectedPerson === person.id;
              const initials = person.name.split(" ").map((n) => n[0]).join("").slice(0, 2);
              const personConns = isExpanded
                ? graphConnections.filter(
                    (c) => c.personId1 === person.id || c.personId2 === person.id,
                  )
                : [];

              return (
                <div key={person.id} className="border border-border rounded-lg bg-card">
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer"
                    onClick={() => setSelectedPerson(isExpanded ? null : person.id)}
                    data-testid={`node-person-${person.id}`}
                  >
                    <Avatar className="w-8 h-8 border border-border shrink-0">
                      {person.imageUrl && <AvatarImage src={person.imageUrl} alt={person.name} />}
                      <AvatarFallback className="text-[10px] font-medium bg-muted">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">{person.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {person.connCount} connections
                      </span>
                    </div>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: getCategoryColor(person.category) }}
                    />
                    <ChevronRight
                      className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border px-3 pb-3 pt-2 flex flex-col gap-2">
                      <Link href={`/people/${person.id}`}>
                        <Button variant="outline" size="sm" className="w-full text-xs">
                          <ExternalLink className="w-3 h-3 mr-1.5" />
                          View profile
                        </Button>
                      </Link>
                      {personConns.map((conn) => {
                        const otherName =
                          conn.personId1 === person.id ? conn.person2Name : conn.person1Name;
                        return (
                          <div key={conn.id} className="flex items-center gap-2 text-xs">
                            <span className="truncate flex-1">{otherName}</span>
                            <Badge
                              variant="secondary"
                              className={`text-[9px] shrink-0 ${connectionTypeColors[conn.connectionType] || ""}`}
                            >
                              {conn.connectionType}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {mobileListPersons.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Network className="w-10 h-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No connections match your filters.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
