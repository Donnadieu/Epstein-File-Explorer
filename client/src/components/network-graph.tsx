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
import { scaleLinear } from "d3-scale";
import { quadtree, type Quadtree } from "d3-quadtree";
import type { Connection } from "@shared/schema";

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

// --- Dynamic color helpers ---

const KNOWN_CATEGORY_COLORS: Record<string, string> = {
  "key figure": "hsl(0, 84%, 60%)",
  associate: "hsl(221, 83%, 53%)",
  victim: "hsl(43, 74%, 49%)",
  witness: "hsl(173, 58%, 39%)",
  legal: "hsl(262, 83%, 58%)",
  political: "hsl(27, 87%, 57%)",
};

export function getCategoryColor(cat: string): string {
  if (KNOWN_CATEGORY_COLORS[cat]) return KNOWN_CATEGORY_COLORS[cat];
  // Fallback: deterministic hash for any unknown category
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = cat.charCodeAt(i) + ((hash << 5) - hash);
  const h = ((hash % 360) + 360) % 360;
  return `hsl(${h}, 50%, 65%)`;
}

const KNOWN_EDGE_COLORS: Record<string, string> = {
  "business associate": "hsl(221, 83%, 53%)",
  "social connection": "hsl(173, 58%, 39%)",
  "legal counsel": "hsl(262, 83%, 58%)",
  employee: "hsl(43, 74%, 49%)",
  "co-conspirator": "hsl(0, 84%, 60%)",
  "travel companion": "hsl(27, 87%, 57%)",
  "political ally": "hsl(27, 87%, 57%)",
  "victim testimony": "hsl(43, 74%, 49%)",
};

function getEdgeColor(type: string): string {
  if (KNOWN_EDGE_COLORS[type]) return KNOWN_EDGE_COLORS[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = type.charCodeAt(i) + ((hash << 5) - hash);
  const h = ((hash % 360) + 360) % 360;
  return `hsl(${h}, 50%, 55%)`;
}

// Parse HSL string to rgba for canvas
function hslToCanvasColor(hsl: string, alpha = 1): string {
  if (alpha === 1) return hsl;
  // Inject alpha: hsl(h, s%, l%) -> hsla(h, s%, l%, a)
  return hsl.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
}

interface NetworkGraphProps {
  persons: { id: number; name: string; category: string }[];
  connections: (Connection & { person1Name: string; person2Name: string })[];
  searchQuery: string;
  selectedPersonId: number | null;
  focusedNodeId: number | null;
  onSelectPerson: (id: number | null) => void;
  onFocusNode: (id: number | null) => void;
  onReady?: () => void;
}

export default function NetworkGraph({
  persons,
  connections,
  searchQuery,
  selectedPersonId,
  focusedNodeId,
  onSelectPerson,
  onFocusNode,
  onReady,
}: NetworkGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const quadtreeRef = useRef<Quadtree<GraphNode> | null>(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const radiusScaleRef = useRef<ReturnType<typeof scaleLinear>>(scaleLinear());
  const dragNodeRef = useRef<GraphNode | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const selectedIdRef = useRef(selectedPersonId);
  const focusedIdRef = useRef(focusedNodeId);
  const searchRef = useRef(searchQuery);
  const connectionsRef = useRef(connections);
  const hoveredIdRef = useRef<number | null>(null);
  const animFrameRef = useRef<number>(0);

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

  // Keep refs in sync
  useEffect(() => { selectedIdRef.current = selectedPersonId; }, [selectedPersonId]);
  useEffect(() => { focusedIdRef.current = focusedNodeId; }, [focusedNodeId]);
  useEffect(() => { searchRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);

  // Request a redraw whenever visual-only props change
  useEffect(() => {
    drawFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonId, focusedNodeId, searchQuery]);

  const findNodeAt = useCallback((canvasX: number, canvasY: number): GraphNode | null => {
    const qt = quadtreeRef.current;
    if (!qt) return null;
    const t = transformRef.current;
    // Convert canvas coords to simulation coords
    const sx = (canvasX - t.x) / t.k;
    const sy = (canvasY - t.y) / t.k;
    const rScale = radiusScaleRef.current;
    let found: GraphNode | null = null;
    const searchRadius = 30 / t.k;
    qt.visit((quadNode, x0, y0, x1, y1) => {
      if (found) return true;
      if (!("data" in quadNode)) {
        // Check if this quad could contain a hit
        return x0 > sx + searchRadius || x1 < sx - searchRadius ||
               y0 > sy + searchRadius || y1 < sy - searchRadius;
      }
      let node = quadNode as { data: GraphNode; next?: typeof quadNode };
      do {
        const d = node.data;
        const r = rScale(d.connectionCount) as number;
        const dx = sx - (d.x ?? 0);
        const dy = sy - (d.y ?? 0);
        if (dx * dx + dy * dy < r * r) {
          found = d;
        }
        node = node.next as typeof node;
      } while (node && !found);
      return false;
    });
    return found;
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const t = transformRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const rScale = radiusScaleRef.current;
    const selectedId = selectedIdRef.current;
    const focusedId = focusedIdRef.current;
    const search = searchRef.current.toLowerCase();
    const hasSearch = search.length > 0;

    // Clear (background provided by CSS class)
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Determine which node is "active" (hovered, selected, or focused)
    const hoveredId = hoveredIdRef.current;
    const activeId = focusedId ?? selectedId ?? hoveredId;

    // Build active neighborhood (1-hop from active node)
    let activeNeighborIds: Set<number> | null = null;
    if (activeId !== null) {
      activeNeighborIds = new Set<number>([activeId]);
      const conns = connectionsRef.current;
      for (const c of conns) {
        if (c.personId1 === activeId) activeNeighborIds.add(c.personId2);
        if (c.personId2 === activeId) activeNeighborIds.add(c.personId1);
      }
    }

    const isFocusMode = focusedId !== null;

    // Draw links
    for (const link of links) {
      const src = link.source as GraphNode;
      const tgt = link.target as GraphNode;

      let alpha: number;
      if (activeNeighborIds) {
        if (isFocusMode) {
          const inNeighborhood = activeNeighborIds.has(src.id) && activeNeighborIds.has(tgt.id);
          alpha = inNeighborhood ? 0.5 : 0.05;
        } else {
          const touches = src.id === activeId || tgt.id === activeId;
          alpha = touches ? 0.5 : 0.05;
        }
      } else {
        alpha = 0.4;
      }

      ctx.beginPath();
      ctx.moveTo(src.x ?? 0, src.y ?? 0);
      ctx.lineTo(tgt.x ?? 0, tgt.y ?? 0);
      ctx.strokeStyle = `rgba(160, 160, 170, ${alpha})`;
      ctx.lineWidth = 0.5 / t.k;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const r = rScale(node.connectionCount) as number;
      const color = getCategoryColor(node.category);
      const matchesSearch = hasSearch && node.name.toLowerCase().includes(search);

      let alpha: number;
      if (activeNeighborIds) {
        if (isFocusMode) {
          alpha = activeNeighborIds.has(node.id) ? 0.9 : 0.15;
        } else {
          alpha = activeNeighborIds.has(node.id) ? 0.9 : 0.15;
        }
      } else {
        alpha = 0.9;
      }

      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = hslToCanvasColor(color, alpha);
      ctx.fill();

      // Search highlight ring only
      if (matchesSearch) {
        ctx.strokeStyle = hslToCanvasColor("hsl(48, 100%, 60%)", alpha);
        ctx.lineWidth = 3 / t.k;
        ctx.stroke();
      }
    }

    // Draw labels — nodes above 70th percentile
    const sortedByConn = [...nodes].sort((a, b) => a.connectionCount - b.connectionCount);
    const medianConn = sortedByConn[Math.floor(nodes.length * 0.7)]?.connectionCount ?? 0;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "9px system-ui, sans-serif";

    for (const node of nodes) {
      if (node.connectionCount <= medianConn) continue;
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const r = rScale(node.connectionCount) as number;

      let alpha: number;
      if (activeNeighborIds) {
        if (isFocusMode) {
          alpha = activeNeighborIds.has(node.id) ? 0.7 : 0.1;
        } else {
          alpha = activeNeighborIds.has(node.id) ? 0.7 : 0.1;
        }
      } else {
        alpha = 0.7;
      }

      const label = node.name.split(" ").pop() || node.name;
      ctx.fillStyle = `rgba(60, 60, 60, ${alpha})`;
      ctx.fillText(label, nx, ny + r + 4);
    }

    ctx.restore();

    // Update quadtree
    quadtreeRef.current = quadtree<GraphNode>()
      .x((d) => d.x ?? 0)
      .y((d) => d.y ?? 0)
      .addAll(nodes);
  }, []);

  const handleZoom = useCallback((delta: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cx = (canvas.width / dpr) / 2;
    const cy = (canvas.height / dpr) / 2;
    const t = transformRef.current;
    const newK = Math.max(0.2, Math.min(5, t.k * delta));
    // Zoom toward center
    transformRef.current = {
      x: cx - (cx - t.x) * (newK / t.k),
      y: cy - (cy - t.y) * (newK / t.k),
      k: newK,
    };
    drawFrame();
  }, [drawFrame]);

  const handleReset = useCallback(() => {
    transformRef.current = { x: 0, y: 0, k: 1 };
    drawFrame();
  }, [drawFrame]);

  // Main simulation effect
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || persons.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    // Reset transform
    transformRef.current = { x: 0, y: 0, k: 1 };

    // Build nodes and links
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

    const builtLinks: GraphLink[] = [];
    connections.forEach((c) => {
      if (!personIdSet.has(c.personId1) || !personIdSet.has(c.personId2)) return;
      const n1 = nodeMap.get(c.personId1)!;
      const n2 = nodeMap.get(c.personId2)!;
      n1.connectionCount++;
      n2.connectionCount++;
      builtLinks.push({
        source: n1,
        target: n2,
        id: c.id,
        connectionType: c.connectionType,
        description: c.description,
        strength: c.strength,
      });
    });

    const builtNodes = Array.from(nodeMap.values());
    nodesRef.current = builtNodes;
    linksRef.current = builtLinks;

    const maxConn = Math.max(1, ...builtNodes.map((n) => n.connectionCount));
    radiusScaleRef.current = scaleLinear().domain([0, maxConn]).range([5, 24]);

    // Simulation
    let tickCount = 0;
    let readyFired = false;
    const simulation = forceSimulation<GraphNode>(builtNodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(builtLinks)
          .id((d) => d.id)
          .distance(80)
          .strength(0.5),
      )
      .force("charge", forceManyBody().strength(-200))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<GraphNode>().radius((d) => (radiusScaleRef.current(d.connectionCount) as number) + 4))
      .on("tick", () => {
        drawFrame();
        tickCount++;
        if (!readyFired && tickCount >= 60) {
          readyFired = true;
          onReady?.();
        }
      });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons, connections, onReady, drawFrame]);

  // Canvas interaction handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getCanvasPos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleMouseDown = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const node = findNodeAt(pos.x, pos.y);
      if (node) {
        dragNodeRef.current = node;
        dragStartRef.current = { x: pos.x, y: pos.y };
        if (simulationRef.current) simulationRef.current.alphaTarget(0.3).restart();
        node.fx = node.x;
        node.fy = node.y;
      } else {
        isPanningRef.current = true;
        panStartRef.current = { x: pos.x, y: pos.y, tx: transformRef.current.x, ty: transformRef.current.y };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getCanvasPos(e);

      if (dragNodeRef.current) {
        const t = transformRef.current;
        dragNodeRef.current.fx = (pos.x - t.x) / t.k;
        dragNodeRef.current.fy = (pos.y - t.y) / t.k;
        return;
      }

      if (isPanningRef.current && panStartRef.current) {
        const dx = pos.x - panStartRef.current.x;
        const dy = pos.y - panStartRef.current.y;
        transformRef.current = {
          ...transformRef.current,
          x: panStartRef.current.tx + dx,
          y: panStartRef.current.ty + dy,
        };
        drawFrame();
        return;
      }

      // Hover tooltip + highlight
      const node = findNodeAt(pos.x, pos.y);
      const prevHovered = hoveredIdRef.current;
      if (node) {
        canvas.style.cursor = "pointer";
        hoveredIdRef.current = node.id;
        setTooltip({ x: e.pageX, y: e.pageY, node });
      } else {
        canvas.style.cursor = "default";
        hoveredIdRef.current = null;
        setTooltip(null);
      }
      if (hoveredIdRef.current !== prevHovered) drawFrame();
    };

    const handleMouseUp = () => {
      if (dragNodeRef.current) {
        if (simulationRef.current) simulationRef.current.alphaTarget(0);
        dragNodeRef.current.fx = null;
        dragNodeRef.current.fy = null;
        dragNodeRef.current = null;
        dragStartRef.current = null;
      }
      isPanningRef.current = false;
      panStartRef.current = null;
    };

    const handleClick = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      // If we were dragging, don't trigger click
      if (dragStartRef.current) {
        const dx = pos.x - dragStartRef.current.x;
        const dy = pos.y - dragStartRef.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) return;
      }
      const node = findNodeAt(pos.x, pos.y);
      if (node) {
        onSelectPerson(selectedIdRef.current === node.id ? null : node.id);
      }
    };

    const handleDblClick = (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const node = findNodeAt(pos.x, pos.y);
      if (node) {
        onFocusNode(focusedIdRef.current === node.id ? null : node.id);
      } else {
        onFocusNode(null);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      const t = transformRef.current;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newK = Math.max(0.2, Math.min(5, t.k * delta));
      transformRef.current = {
        x: pos.x - (pos.x - t.x) * (newK / t.k),
        y: pos.y - (pos.y - t.y) * (newK / t.k),
        k: newK,
      };
      drawFrame();
    };

    const handleMouseLeave = () => {
      hoveredIdRef.current = null;
      setTooltip(null);
      handleMouseUp();
      drawFrame();
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("dblclick", handleDblClick);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("dblclick", handleDblClick);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [findNodeAt, onSelectPerson, onFocusNode, drawFrame]);

  // Resize handler
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      drawFrame();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawFrame]);

  // Build legend categories from persons prop
  const legendCategories = Array.from(new Set(persons.map((p) => p.category))).sort();

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px]">
      <canvas
        ref={canvasRef}
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

      {/* Focus reset button */}
      {focusedNodeId !== null && (
        <button
          onClick={() => onFocusNode(null)}
          className="absolute top-3 right-3 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-md"
        >
          Reset focus
        </button>
      )}

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
              style={{ backgroundColor: getCategoryColor(tooltip.node.category) }}
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
          {legendCategories.map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getCategoryColor(cat) }} />
              <span className="text-[10px] text-muted-foreground capitalize">{cat}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
