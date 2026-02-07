import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph2D from "react-force-graph-2d";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronRight,
  FileText,
  GitBranch,
  Users,
  Network as NetworkIcon,
} from "lucide-react";
import type { Person, Connection } from "@shared/schema";

interface NetworkData {
  persons: Person[];
  connections: (Connection & { person1Name: string; person2Name: string })[];
}

interface StatsData {
  personCount: number;
  documentCount: number;
  connectionCount: number;
  eventCount: number;
}

interface GraphNode {
  id: number;
  name: string;
  category: string;
  connectionCount: number;
  val: number;
  color: string;
}

interface GraphLink {
  source: number;
  target: number;
  connectionType: string;
  strength: number;
}

const categoryColors: Record<string, string> = {
  "key figure": "#ef4444",
  associate: "#3b82f6",
  victim: "#eab308",
  witness: "#14b8a6",
  legal: "#a855f7",
  political: "#f97316",
};

const connectionTypeSet = [
  "business associate",
  "social connection",
  "legal counsel",
  "employee",
  "co-conspirator",
  "travel companion",
  "political ally",
  "victim testimony",
];

export default function NetworkPage() {
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const [searchQuery, setSearchQuery] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [includeUndated, setIncludeUndated] = useState(false);
  const [connectionTypeFilters, setConnectionTypeFilters] = useState<Set<string>>(
    new Set(connectionTypeSet)
  );
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [contentTagsOpen, setContentTagsOpen] = useState(false);
  const [docCategoriesOpen, setDocCategoriesOpen] = useState(false);

  const { data: networkData } = useQuery<NetworkData>({
    queryKey: ["/api/network"],
  });

  const { data: stats } = useQuery<StatsData>({
    queryKey: ["/api/stats"],
  });

  // Resize observer for the graph container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Build graph data from network API response
  const graphData = useMemo(() => {
    if (!networkData) return { nodes: [], links: [] };

    const filteredConnections = networkData.connections.filter((conn) => {
      if (!connectionTypeFilters.has(conn.connectionType)) return false;
      if (keywordFilter) {
        const kw = keywordFilter.toLowerCase();
        const matchesDescription = conn.description?.toLowerCase().includes(kw);
        const matchesType = conn.connectionType.toLowerCase().includes(kw);
        if (!matchesDescription && !matchesType) return false;
      }
      return true;
    });

    // Find person IDs involved in filtered connections
    const involvedPersonIds = new Set<number>();
    filteredConnections.forEach((conn) => {
      involvedPersonIds.add(conn.personId1);
      involvedPersonIds.add(conn.personId2);
    });

    // Apply search filter to persons
    let filteredPersons = networkData.persons.filter((p) =>
      involvedPersonIds.has(p.id)
    );
    if (searchQuery) {
      const sq = searchQuery.toLowerCase();
      const matchingIds = new Set(
        filteredPersons.filter((p) => p.name.toLowerCase().includes(sq)).map((p) => p.id)
      );
      // Show matching persons and their direct connections
      filteredPersons = filteredPersons.filter((p) => matchingIds.has(p.id));
      const searchFilteredIds = new Set(filteredPersons.map((p) => p.id));
      // Also include persons connected to matching ones
      filteredConnections.forEach((conn) => {
        if (searchFilteredIds.has(conn.personId1)) {
          const p = networkData.persons.find((pp) => pp.id === conn.personId2);
          if (p && !searchFilteredIds.has(p.id)) {
            filteredPersons.push(p);
            searchFilteredIds.add(p.id);
          }
        }
        if (searchFilteredIds.has(conn.personId2)) {
          const p = networkData.persons.find((pp) => pp.id === conn.personId1);
          if (p && !searchFilteredIds.has(p.id)) {
            filteredPersons.push(p);
            searchFilteredIds.add(p.id);
          }
        }
      });
    }

    const personIds = new Set(filteredPersons.map((p) => p.id));

    // Count connections per person for sizing
    const connCounts: Record<number, number> = {};
    filteredConnections.forEach((conn) => {
      if (personIds.has(conn.personId1) && personIds.has(conn.personId2)) {
        connCounts[conn.personId1] = (connCounts[conn.personId1] || 0) + 1;
        connCounts[conn.personId2] = (connCounts[conn.personId2] || 0) + 1;
      }
    });

    const nodes: GraphNode[] = filteredPersons.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      connectionCount: connCounts[p.id] || 0,
      val: Math.max(1, (connCounts[p.id] || 0) * 0.5),
      color: categoryColors[p.category] || categoryColors.associate,
    }));

    const links: GraphLink[] = filteredConnections
      .filter((conn) => personIds.has(conn.personId1) && personIds.has(conn.personId2))
      .map((conn) => ({
        source: conn.personId1,
        target: conn.personId2,
        connectionType: conn.connectionType,
        strength: conn.strength,
      }));

    return { nodes, links };
  }, [networkData, searchQuery, keywordFilter, connectionTypeFilters]);

  // Extract unique tags and document types from data
  const contentTags = useMemo(() => {
    if (!networkData) return [];
    const tagSet = new Set<string>();
    networkData.connections.forEach((conn) => {
      if (conn.connectionType) tagSet.add(conn.connectionType);
    });
    return Array.from(tagSet).sort();
  }, [networkData]);

  const categories = useMemo(() => {
    if (!networkData) return [];
    const catSet = new Set<string>();
    networkData.persons.forEach((p) => {
      if (p.category) catSet.add(p.category);
    });
    return Array.from(catSet).sort();
  }, [networkData]);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node as GraphNode);
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 400);
      graphRef.current.zoom(3, 400);
    }
  }, []);

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.name as string;
      const size = Math.max(2, Math.sqrt(node.val || 1) * 2.5);
      const isSelected = selectedNode?.id === node.id;
      const color = node.color || "#3b82f6";

      // Glow effect
      ctx.beginPath();
      ctx.arc(node.x, node.y, size + 2, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected
        ? `${color}88`
        : `${color}33`;
      ctx.fill();

      // Main node
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? "#ffffff" : color;
      ctx.fill();

      // Label (only show when zoomed in or for selected node)
      if (globalScale > 1.5 || isSelected) {
        const fontSize = Math.max(10 / globalScale, 2);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillText(label, node.x, node.y + size + 2);
      }
    },
    [selectedNode]
  );

  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D) => {
      const start = link.source;
      const end = link.target;
      if (!start || !end || typeof start.x !== "number") return;

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = "rgba(100, 140, 200, 0.12)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    },
    []
  );

  const toggleConnectionType = (type: string) => {
    setConnectionTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleKeywordGo = () => {
    // keyword filter is already reactive
  };

  return (
    <div className="flex h-[calc(100vh-49px)] w-full overflow-hidden bg-[#0a0e1a]">
      {/* Left Sidebar Panel */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-[#1a2040] bg-[#0d1220] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-[#1a2040]">
          <div className="flex items-center gap-2 mb-1">
            <NetworkIcon className="w-5 h-5 text-blue-400" />
            <h1 className="text-base font-semibold text-white">
              The Epstein Network
            </h1>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            Explore files and connections
          </p>

          {/* Stats */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <FileText className="w-3 h-3" />
                Documents
              </span>
              <span className="text-xs font-medium text-blue-400 tabular-nums">
                {stats?.documentCount?.toLocaleString() ?? "..."}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <GitBranch className="w-3 h-3" />
                Relationships
              </span>
              <span className="text-xs font-medium text-blue-400 tabular-nums">
                {stats?.connectionCount?.toLocaleString() ?? "..."}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <Users className="w-3 h-3" />
                Actors
              </span>
              <span className="text-xs font-medium text-blue-400 tabular-nums">
                {stats?.personCount?.toLocaleString() ?? "..."}
              </span>
            </div>
          </div>
        </div>

        {/* Graph Settings */}
        <Collapsible
          open={graphSettingsOpen}
          onOpenChange={setGraphSettingsOpen}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 text-xs font-medium text-slate-300 hover:bg-[#141c30] transition-colors border-b border-[#1a2040]">
            Graph Settings
            <ChevronRight
              className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                graphSettingsOpen ? "rotate-90" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 py-3 border-b border-[#1a2040] space-y-3">
            <div className="space-y-2">
              <label className="text-[11px] text-slate-400">Node size</label>
              <Slider
                defaultValue={[50]}
                max={100}
                step={1}
                className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0d1220] [&_.bg-primary]:bg-blue-500 [&_.bg-secondary]:bg-[#1a2040]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] text-slate-400">Link opacity</label>
              <Slider
                defaultValue={[30]}
                max={100}
                step={1}
                className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0d1220] [&_.bg-primary]:bg-blue-500 [&_.bg-secondary]:bg-[#1a2040]"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Filters */}
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 text-xs font-medium text-slate-300 hover:bg-[#141c30] transition-colors border-b border-[#1a2040]">
            Filters
            <ChevronRight
              className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                filtersOpen ? "rotate-90" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 py-3 border-b border-[#1a2040] space-y-4">
            {/* Time Range */}
            <div className="space-y-2">
              <label className="text-[11px] text-slate-400">
                Time range: 1960 - 2025
              </label>
              <Slider
                defaultValue={[1960, 2025]}
                min={1960}
                max={2025}
                step={1}
                className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0d1220] [&_.bg-primary]:bg-blue-500 [&_.bg-secondary]:bg-[#1a2040]"
              />
            </div>

            {/* Include undated */}
            <div className="flex items-center gap-2">
              <Checkbox
                checked={includeUndated}
                onCheckedChange={(v) => setIncludeUndated(!!v)}
                className="h-3.5 w-3.5 border-slate-600 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
              />
              <label className="text-[11px] text-slate-400">
                Include undated events
              </label>
            </div>

            {/* Search entities */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400">
                Search entities
              </label>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g., Jeffrey Epstein"
                className="h-8 text-xs bg-[#0a0e1a] border-[#1a2040] text-slate-300 placeholder:text-slate-600 focus-visible:ring-blue-500/30"
              />
            </div>

            {/* Keyword filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400">
                Keyword filter
              </label>
              <div className="flex gap-1.5">
                <Input
                  value={keywordFilter}
                  onChange={(e) => setKeywordFilter(e.target.value)}
                  placeholder="e.g., massage, aircraft, island"
                  className="h-8 text-xs bg-[#0a0e1a] border-[#1a2040] text-slate-300 placeholder:text-slate-600 focus-visible:ring-blue-500/30"
                />
                <Button
                  size="sm"
                  onClick={handleKeywordGo}
                  className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-500 text-white shrink-0"
                >
                  Go
                </Button>
              </div>
              <p className="text-[10px] text-slate-600">
                Filter by document keywords, descriptions, search terms
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Content Tags (Connection Types) */}
        <Collapsible open={contentTagsOpen} onOpenChange={setContentTagsOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 text-xs font-medium text-slate-300 hover:bg-[#141c30] transition-colors border-b border-[#1a2040]">
            Content Tags
            <ChevronRight
              className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                contentTagsOpen ? "rotate-90" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 py-3 border-b border-[#1a2040] space-y-1.5">
            {contentTags.map((tag) => (
              <div key={tag} className="flex items-center gap-2">
                <Checkbox
                  checked={connectionTypeFilters.has(tag)}
                  onCheckedChange={() => toggleConnectionType(tag)}
                  className="h-3.5 w-3.5 border-slate-600 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                />
                <label className="text-[11px] text-slate-400 capitalize">
                  {tag}
                </label>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>

        {/* Document Categories (Person Categories) */}
        <Collapsible
          open={docCategoriesOpen}
          onOpenChange={setDocCategoriesOpen}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 text-xs font-medium text-slate-300 hover:bg-[#141c30] transition-colors border-b border-[#1a2040]">
            Document Categories
            <ChevronRight
              className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                docCategoriesOpen ? "rotate-90" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 py-3 border-b border-[#1a2040] space-y-1.5">
            {categories.map((cat) => (
              <div key={cat} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      categoryColors[cat] || categoryColors.associate,
                  }}
                />
                <span className="text-[11px] text-slate-400 capitalize">
                  {cat}
                </span>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Main Graph Area */}
      <div className="flex-1 relative" ref={containerRef}>
        {/* Selected node info overlay */}
        {selectedNode && (
          <div className="absolute top-4 right-4 z-10 bg-[#0d1220]/90 backdrop-blur-sm border border-[#1a2040] rounded-lg p-3 max-w-xs">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="text-sm font-medium text-white truncate">
                {selectedNode.name}
              </h3>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-slate-500 hover:text-white text-xs shrink-0"
              >
                &times;
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: selectedNode.color }}
              />
              <span className="text-[11px] text-slate-400 capitalize">
                {selectedNode.category}
              </span>
              <span className="text-[11px] text-slate-500">
                {selectedNode.connectionCount} connections
              </span>
            </div>
          </div>
        )}

        {/* Force Graph */}
        <ForceGraph2D
          ref={graphRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeId="id"
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={(node: any, color, ctx) => {
            const size = Math.max(2, Math.sqrt(node.val || 1) * 2.5);
            ctx.beginPath();
            ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          linkCanvasObject={linkCanvasObject}
          onNodeClick={handleNodeClick}
          backgroundColor="#0a0e1a"
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          enableNodeDrag={true}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />

        {/* Bottom hint */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <p className="text-[11px] text-slate-500 flex items-center gap-3">
            <span>Click nodes to explore relationships</span>
            <span className="text-slate-700">&middot;</span>
            <span>Scroll to zoom</span>
            <span className="text-slate-700">&middot;</span>
            <span>Drag to pan</span>
          </p>
        </div>
      </div>
    </div>
  );
}
