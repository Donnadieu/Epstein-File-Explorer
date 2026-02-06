import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Network,
  Search,
  Users,
  ArrowRight,
  Filter,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Person, Connection } from "@shared/schema";

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
  "employee": "bg-chart-4/10 text-chart-4",
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
    () => ["all", ...new Set(data?.connections.map((c) => c.connectionType) || [])],
    [data]
  );

  const filteredConnections = useMemo(() => {
    if (!data) return [];
    return data.connections.filter((conn) => {
      const matchesPerson =
        !selectedPerson || conn.personId1 === selectedPerson || conn.personId2 === selectedPerson;
      const matchesType = connectionTypeFilter === "all" || conn.connectionType === connectionTypeFilter;
      const matchesSearch =
        !searchQuery ||
        conn.person1Name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conn.person2Name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesPerson && matchesType && matchesSearch;
    });
  }, [data, selectedPerson, connectionTypeFilter, searchQuery]);

  const personConnectionCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    filteredConnections.forEach((conn) => {
      counts[conn.personId1] = (counts[conn.personId1] || 0) + 1;
      counts[conn.personId2] = (counts[conn.personId2] || 0) + 1;
    });
    return counts;
  }, [filteredConnections]);

  const networkNodes = useMemo(() => {
    if (!data) return [];
    const involvedIds = new Set<number>();
    filteredConnections.forEach((conn) => {
      involvedIds.add(conn.personId1);
      involvedIds.add(conn.personId2);
    });
    return data.persons
      .filter((p) => involvedIds.has(p.id))
      .sort((a, b) => (personConnectionCounts[b.id] || 0) - (personConnectionCounts[a.id] || 0));
  }, [data, filteredConnections, personConnectionCounts]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-network-title">
          <Network className="w-6 h-6 text-primary" />
          Relationship Network
        </h1>
        <p className="text-sm text-muted-foreground">
          Explore connections between individuals mentioned in the Epstein files. Relationships are derived from public documents and records.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search connections..."
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
            Clear person filter
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <Skeleton className="h-96 w-full" />
          </div>
          <div className="lg:col-span-2">
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 flex flex-col gap-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Key Nodes ({networkNodes.length})
            </h3>
            <div className="flex flex-col gap-1.5 max-h-[600px] overflow-y-auto pr-1">
              {networkNodes.slice(0, 20).map((person) => {
                const initials = person.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2);
                const isSelected = selectedPerson === person.id;
                const connCount = personConnectionCounts[person.id] || 0;

                return (
                  <div
                    key={person.id}
                    className={`flex items-center gap-3 p-2.5 rounded-md cursor-pointer hover-elevate ${
                      isSelected ? "bg-primary/10 ring-1 ring-primary/20" : ""
                    }`}
                    onClick={() => setSelectedPerson(isSelected ? null : person.id)}
                    data-testid={`node-person-${person.id}`}
                  >
                    <Avatar className="w-8 h-8 border border-border shrink-0">
                      <AvatarFallback className="text-[10px] font-medium bg-muted">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-medium truncate">{person.name}</span>
                      <span className="text-[10px] text-muted-foreground">{connCount} connections</span>
                    </div>
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: categoryColors[person.category] || categoryColors.associate }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col gap-1.5 mt-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Legend</span>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(categoryColors).map(([cat, color]) => (
                  <div key={cat} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[10px] text-muted-foreground capitalize">{cat}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" />
              Connections ({filteredConnections.length})
            </h3>
            <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredConnections.map((conn) => {
                const p1 = data?.persons.find((p) => p.id === conn.personId1);
                const p2 = data?.persons.find((p) => p.id === conn.personId2);
                if (!p1 || !p2) return null;

                const p1Initials = p1.name.split(" ").map((n) => n[0]).join("").slice(0, 2);
                const p2Initials = p2.name.split(" ").map((n) => n[0]).join("").slice(0, 2);

                return (
                  <Card key={conn.id} data-testid={`card-connection-${conn.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Link href={`/people/${p1.id}`}>
                          <div className="flex items-center gap-2 hover-elevate rounded-md p-1 cursor-pointer shrink-0">
                            <Avatar className="w-7 h-7 border border-border">
                              <AvatarFallback className="text-[10px] bg-muted">{p1Initials}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium hidden sm:block">{p1.name}</span>
                          </div>
                        </Link>

                        <div className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
                          <div className="w-full h-px bg-border relative">
                            <ArrowRight className="w-3 h-3 text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card" />
                          </div>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${connectionTypeColors[conn.connectionType] || ""}`}
                          >
                            {conn.connectionType}
                          </Badge>
                        </div>

                        <Link href={`/people/${p2.id}`}>
                          <div className="flex items-center gap-2 hover-elevate rounded-md p-1 cursor-pointer shrink-0">
                            <span className="text-xs font-medium hidden sm:block">{p2.name}</span>
                            <Avatar className="w-7 h-7 border border-border">
                              <AvatarFallback className="text-[10px] bg-muted">{p2Initials}</AvatarFallback>
                            </Avatar>
                          </div>
                        </Link>
                      </div>
                      {conn.description && (
                        <p className="text-[10px] text-muted-foreground mt-2 pl-1">{conn.description}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {filteredConnections.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Network className="w-10 h-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No connections match your filters.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
