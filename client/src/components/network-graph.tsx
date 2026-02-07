import { useRef, useEffect, useCallback, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import "d3-transition";
import { scaleLinear } from "d3-scale";
import { drag } from "d3-drag";
import type { Person, Connection } from "@shared/schema";

export interface GraphNode extends SimulationNodeDatum {
  id: number;
  name: string;
  category: string;
  connectionCount: number;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: number;
  connectionType: string;
  description: string | null;
  strength: number;
}

const categoryColors: Record<string, string> = {
  "key figure": "hsl(0, 84%, 60%)",
  associate: "hsl(221, 83%, 53%)",
  victim: "hsl(43, 74%, 49%)",
  witness: "hsl(173, 58%, 39%)",
  legal: "hsl(262, 83%, 58%)",
  political: "hsl(27, 87%, 57%)",
};

const connectionTypeEdgeColors: Record<string, string> = {
  "business associate": "hsl(221, 83%, 53%)",
  "social connection": "hsl(173, 58%, 39%)",
  "legal counsel": "hsl(262, 83%, 58%)",
  employee: "hsl(43, 74%, 49%)",
  "co-conspirator": "hsl(0, 84%, 60%)",
  "travel companion": "hsl(27, 87%, 57%)",
  "political ally": "hsl(27, 87%, 57%)",
  "victim testimony": "hsl(43, 74%, 49%)",
};

interface NetworkGraphProps {
  persons: Person[];
  connections: (Connection & { person1Name: string; person2Name: string })[];
  searchQuery: string;
  selectedPersonId: number | null;
  onSelectPerson: (id: number | null) => void;
}

export default function NetworkGraph({
  persons,
  connections,
  searchQuery,
  selectedPersonId,
  onSelectPerson,
}: NetworkGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const selectedPersonIdRef = useRef(selectedPersonId);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

  const handleZoom = useCallback((delta: number) => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const sel = select(svg);
    sel.transition().duration(300).call(zoomRef.current.scaleBy, delta);
  }, []);

  const handleReset = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const sel = select(svg);
    sel.transition().duration(500).call(zoomRef.current.transform, zoomIdentity);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container || persons.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Build node and link data
    const personIdSet = new Set(persons.map((p) => p.id));
    const nodeMap = new Map<number, GraphNode>();
    persons.forEach((p) => {
      nodeMap.set(p.id, {
        id: p.id,
        name: p.name,
        category: p.category,
        connectionCount: 0,
      });
    });

    const links: GraphLink[] = [];
    connections.forEach((c) => {
      if (!personIdSet.has(c.personId1) || !personIdSet.has(c.personId2)) return;
      const n1 = nodeMap.get(c.personId1)!;
      const n2 = nodeMap.get(c.personId2)!;
      n1.connectionCount++;
      n2.connectionCount++;
      links.push({
        source: n1,
        target: n2,
        id: c.id,
        connectionType: c.connectionType,
        description: c.description,
        strength: c.strength,
      });
    });

    const nodes = Array.from(nodeMap.values());

    // Size scale: min 5, max 24 based on connection count
    const maxConn = Math.max(1, ...nodes.map((n) => n.connectionCount));
    const radiusScale = scaleLinear().domain([0, maxConn]).range([5, 24]);

    // Clear previous
    const svgSel = select(svg);
    svgSel.selectAll("*").remove();
    svgSel.attr("width", width).attr("height", height);

    // Container group for zoom/pan
    const g = svgSel.append("g");

    // Zoom behavior
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svgSel.call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    // Edges
    const linkGroup = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => connectionTypeEdgeColors[d.connectionType] || "hsl(0, 0%, 60%)")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", (d) => Math.max(1, d.strength * 0.8));

    // Nodes group
    const nodeGroup = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("cursor", "pointer");

    // Node circles
    nodeGroup
      .append("circle")
      .attr("r", (d) => radiusScale(d.connectionCount))
      .attr("fill", (d) => categoryColors[d.category] || categoryColors.associate)
      .attr("stroke", "hsl(0, 0%, 100%)")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.9);

    // Node labels (only for nodes with > median connections)
    const medianConn = nodes.length > 0
      ? [...nodes].sort((a, b) => a.connectionCount - b.connectionCount)[
          Math.floor(nodes.length * 0.7)
        ]?.connectionCount ?? 0
      : 0;

    nodeGroup
      .filter((d) => d.connectionCount > medianConn)
      .append("text")
      .text((d) => d.name.split(" ").pop() || d.name)
      .attr("dy", (d) => radiusScale(d.connectionCount) + 12)
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "currentColor")
      .attr("opacity", 0.7)
      .attr("pointer-events", "none");

    // Drag behavior
    const dragBehavior = drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeGroup.call(dragBehavior);

    // Click handler
    nodeGroup.on("click", (_event, d) => {
      onSelectPerson(selectedPersonIdRef.current === d.id ? null : d.id);
    });

    // Hover handlers
    nodeGroup
      .on("mouseenter", (event, d) => {
        const [x, y] = [event.pageX, event.pageY];
        setTooltip({ x, y, node: d });
      })
      .on("mouseleave", () => {
        setTooltip(null);
      });

    // Simulation
    const simulation = forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(80)
          .strength(0.5),
      )
      .force("charge", forceManyBody().strength(-200))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<GraphNode>().radius((d) => radiusScale(d.connectionCount) + 4))
      .on("tick", () => {
        linkGroup
          .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
          .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
          .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
          .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

        nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
    // Re-run when data shape changes, not on every filter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons, connections, onSelectPerson]);

  // Update visual state when selection/search changes (no re-simulation)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const svgSel = select(svg);

    const searchLower = searchQuery.toLowerCase();
    const hasSearch = searchLower.length > 0;

    // Determine connected nodes for selection highlight
    const connectedIds = new Set<number>();
    if (selectedPersonId !== null) {
      connectedIds.add(selectedPersonId);
      connections.forEach((c) => {
        if (c.personId1 === selectedPersonId) connectedIds.add(c.personId2);
        if (c.personId2 === selectedPersonId) connectedIds.add(c.personId1);
      });
    }

    // Update node appearance
    svgSel.selectAll<SVGGElement, GraphNode>("g.nodes g").each(function (d) {
      const group = select(this);
      const circle = group.select("circle");
      const matchesSearch = hasSearch && d.name.toLowerCase().includes(searchLower);
      const isHighlighted = selectedPersonId === null || connectedIds.has(d.id);

      circle
        .attr("opacity", isHighlighted ? 0.9 : 0.15)
        .attr("stroke", matchesSearch ? "hsl(48, 100%, 60%)" : "hsl(0, 0%, 100%)")
        .attr("stroke-width", matchesSearch ? 3 : 1.5);

      group.select("text").attr("opacity", isHighlighted ? 0.7 : 0.1);
    });

    // Update edge appearance
    svgSel.selectAll<SVGLineElement, GraphLink>("g.links line").each(function (d) {
      const link = select(this);
      const src = d.source as GraphNode;
      const tgt = d.target as GraphNode;
      const isHighlighted =
        selectedPersonId === null ||
        src.id === selectedPersonId ||
        tgt.id === selectedPersonId;

      link.attr("stroke-opacity", isHighlighted ? 0.5 : 0.05);
    });
  }, [selectedPersonId, searchQuery, connections]);

  useEffect(() => {
    selectedPersonIdRef.current = selectedPersonId;
  }, [selectedPersonId]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px]">
      <svg
        ref={svgRef}
        className="w-full h-full bg-background rounded-lg border border-border"
        style={{ touchAction: "none" }}
        role="img"
        aria-label="Network graph showing connections between people"
      />

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          onClick={() => handleZoom(1.4)}
          className="w-8 h-8 rounded-md bg-card border border-border flex items-center justify-center text-sm hover:bg-accent transition-colors"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => handleZoom(1 / 1.4)}
          className="w-8 h-8 rounded-md bg-card border border-border flex items-center justify-center text-sm hover:bg-accent transition-colors"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={handleReset}
          className="w-8 h-8 rounded-md bg-card border border-border flex items-center justify-center text-xs hover:bg-accent transition-colors"
          aria-label="Reset zoom"
        >
          ⟲
        </button>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg bg-popover border border-border shadow-lg text-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="font-medium">{tooltip.node.name}</div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{
                backgroundColor:
                  categoryColors[tooltip.node.category] || categoryColors.associate,
              }}
            />
            <span className="capitalize">{tooltip.node.category}</span>
            <span>·</span>
            <span>{tooltip.node.connectionCount} connections</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-3 left-3 bg-card/90 backdrop-blur-sm border border-border rounded-lg p-2.5">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
          Categories
        </div>
        <div className="flex flex-col gap-1">
          {Object.entries(categoryColors).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-muted-foreground capitalize">{cat}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
