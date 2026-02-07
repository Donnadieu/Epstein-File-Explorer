import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Network,
  Search,
  X,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import type { Person, Connection } from "@shared/schema";
import NetworkGraph from "@/components/network-graph";

interface NetworkData {
  persons: Person[];
  connections: (Connection & { person1Name: string; person2Name: string })[];
}

const categoryColors: Record<string, string> = {
  "key figure": "hsl(0, 84%, 60%)",
  associate: "hsl(221, 83%, 53%)",
  victim: "hsl(43, 74%, 49%)",
  witness: "hsl(173, 58%, 39%)",
  legal: "hsl(262, 83%, 58%)",
  political: "hsl(27, 87%, 57%)",
};

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

export default function NetworkPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<number | null>(null);
  const [connectionTypeFilter, setConnectionTypeFilter] = useState("all");

  const { data, isLoading } = useQuery<NetworkData>({
    queryKey: ["/api/network"],
  });

  const connectionTypes = useMemo(
    () => ["all", ...Array.from(new Set(data?.connections.map((c) => c.connectionType) || []))],
    [data],
  );

  const filteredConnections = useMemo(() => {
    if (!data) return [];
    return data.connections.filter((conn) => {
      const matchesType = connectionTypeFilter === "all" || conn.connectionType === connectionTypeFilter;
      const matchesSearch =
        !searchQuery ||
        conn.person1Name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conn.person2Name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [data, connectionTypeFilter, searchQuery]);

  // Persons involved in filtered connections (for graph)
  const graphPersons = useMemo(() => {
    if (!data) return [];
    const ids = new Set<number>();
    filteredConnections.forEach((c) => {
      ids.add(c.personId1);
      ids.add(c.personId2);
    });
    return data.persons.filter((p) => ids.has(p.id));
  }, [data, filteredConnections]);

  // Selected person details
  const selectedPersonData = useMemo(() => {
    if (!data || selectedPerson === null) return null;
    return data.persons.find((p) => p.id === selectedPerson) ?? null;
  }, [data, selectedPerson]);

  const selectedPersonConnections = useMemo(() => {
    if (!data || selectedPerson === null) return [];
    return filteredConnections.filter(
      (c) => c.personId1 === selectedPerson || c.personId2 === selectedPerson,
    );
  }, [data, filteredConnections, selectedPerson]);

  const handleSelectPerson = useCallback((id: number | null) => {
    setSelectedPerson(id);
  }, []);

  // Mobile list data: persons sorted by connection count
  const mobileListPersons = useMemo(() => {
    const counts: Record<number, number> = {};
    filteredConnections.forEach((c) => {
      counts[c.personId1] = (counts[c.personId1] || 0) + 1;
      counts[c.personId2] = (counts[c.personId2] || 0) + 1;
    });
    return graphPersons
      .map((p) => ({ ...p, connCount: counts[p.id] || 0 }))
      .sort((a, b) => b.connCount - a.connCount);
  }, [graphPersons, filteredConnections]);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 w-full h-full">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-network-title">
          <Network className="w-6 h-6 text-primary" />
          Relationship Network
        </h1>
        <p className="text-sm text-muted-foreground">
          Interactive force-directed graph of connections between individuals. Click nodes to explore relationships.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search people..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-network-search"
          />
        </div>
        <Select value={connectionTypeFilter} onValueChange={setConnectionTypeFilter}>
          <SelectTrigger className="w-full sm:w-48" data-testid="select-connection-type">
            <SelectValue placeholder="Connection Type" />
          </SelectTrigger>
          <SelectContent>
            {connectionTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type === "all" ? "All Types" : type.charAt(0).toUpperCase() + type.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedPerson && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedPerson(null)} data-testid="button-clear-person">
            <X className="w-3 h-3 mr-1" />
            Clear selection
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto hidden sm:block">
          {graphPersons.length} people · {filteredConnections.length} connections
        </span>
      </div>

      {isLoading ? (
        <Skeleton className="flex-1 min-h-[500px] w-full rounded-lg" />
      ) : (
        <>
          {/* Desktop: Graph + optional sidebar */}
          <div className="hidden md:flex flex-1 gap-4 min-h-[500px]">
            <div className={`flex-1 transition-all ${selectedPersonData ? "md:w-2/3" : "w-full"}`}>
              <NetworkGraph
                persons={graphPersons}
                connections={filteredConnections}
                searchQuery={searchQuery}
                selectedPersonId={selectedPerson}
                onSelectPerson={handleSelectPerson}
              />
            </div>

            {/* Detail sidebar */}
            {selectedPersonData && (
              <div className="w-80 shrink-0 border border-border rounded-lg bg-card p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-260px)]">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-border">
                      <AvatarFallback className="text-sm font-medium bg-muted">
                        {selectedPersonData.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="text-sm font-semibold">{selectedPersonData.name}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: categoryColors[selectedPersonData.category] || categoryColors.associate }}
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
                ? filteredConnections.filter(
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
                      style={{ backgroundColor: categoryColors[person.category] || categoryColors.associate }}
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
