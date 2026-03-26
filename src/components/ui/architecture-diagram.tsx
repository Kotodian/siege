"use client";

interface Component {
  name: string;
  responsibility: string;
  dependencies: string[];
}

interface ArchitectureDiagramProps {
  components: Component[];
}

function measureText(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? fontSize * 0.95 : fontSize * 0.58;
  return w;
}

/** Truncate by pixel width instead of character count */
function truncateByWidth(s: string, maxW: number, fontSize: number): string {
  if (measureText(s, fontSize) <= maxW) return s;
  let result = "";
  let w = 0;
  const ellipsisW = fontSize * 0.58;
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0x2e80 ? fontSize * 0.95 : fontSize * 0.58;
    if (w + cw > maxW - ellipsisW) { result += "…"; break; }
    result += ch;
    w += cw;
  }
  return result;
}

interface LayoutNode {
  id: string;
  name: string;
  desc: string;
  tag?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  deps: string[];
}

export function ArchitectureDiagram({ components }: ArchitectureDiagramProps) {
  if (components.length === 0) return null;

  const nameSet = new Set(components.map(c => c.name));

  // Calculate layer depth
  const depth = new Map<string, number>();
  for (const c of components) depth.set(c.name, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of components) {
      for (const d of c.dependencies) {
        if (nameSet.has(d)) {
          const nd = (depth.get(d) || 0) + 1;
          if (nd > (depth.get(c.name) || 0)) { depth.set(c.name, nd); changed = true; }
        }
      }
    }
  }

  // Group into layers
  const layers = new Map<number, Component[]>();
  for (const c of components) {
    const d = depth.get(c.name) || 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(c);
  }

  const layerTags = ["CONFIGURATION", "STATE DEFINITION", "IMPLEMENTATION"];
  const sorted = [...layers.entries()].sort((a, b) => a[0] - b[0]);

  // Size nodes
  const NODE_H = 72;
  const MIN_W = 150;
  const MAX_W = 220;
  const GAP_X = 24;
  const GAP_Y = 80;
  const MARGIN = 32;

  const nodeWidth = (c: Component) => {
    const nw = measureText(c.name, 13);
    const dw = measureText(c.responsibility, 10);
    return Math.max(MIN_W, Math.min(Math.max(nw, dw) + 40, MAX_W));
  };

  const nodes: LayoutNode[] = [];
  const layerWidths = sorted.map(([, items]) =>
    items.reduce((s, c) => s + nodeWidth(c), 0) + (items.length - 1) * GAP_X
  );
  const maxLW = Math.max(...layerWidths);

  let curY = MARGIN;
  for (const [li, [layerNum, items]] of sorted.entries()) {
    const lw = layerWidths[li];
    let curX = MARGIN + (maxLW - lw) / 2;
    for (const comp of items) {
      const w = nodeWidth(comp);
      nodes.push({
        id: comp.name, name: comp.name,
        desc: comp.responsibility,
        tag: items.length <= 2 ? layerTags[Math.min(li, layerTags.length - 1)] : undefined,
        x: curX, y: curY, w, h: NODE_H,
        layer: layerNum,
        deps: comp.dependencies.filter(d => nameSet.has(d)),
      });
      curX += w + GAP_X;
    }
    curY += NODE_H + GAP_Y;
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const svgW = maxLW + MARGIN * 2;
  const svgH = curY - GAP_Y + MARGIN;

  // Build edges
  const edges: Array<{ from: LayoutNode; to: LayoutNode }> = [];
  for (const node of nodes) {
    for (const depName of node.deps) {
      const dep = nodeMap.get(depName);
      if (dep) edges.push({ from: node, to: dep });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      className="w-full"
      style={{ maxHeight: 560 }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="line-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c0c1ff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#8083ff" stopOpacity="0.3" />
        </linearGradient>
        <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0.5 L7,3 L0,5.5" fill="#8083ff" stroke="none" />
        </marker>
      </defs>

      {/* Connection lines */}
      {edges.map((edge, i) => {
        const fx = edge.from.x + edge.from.w / 2;
        const fy = edge.from.y + edge.from.h;
        const tx = edge.to.x + edge.to.w / 2;
        const ty = edge.to.y;
        const cp = Math.max(Math.abs(fy - ty) * 0.4, 25);
        const fromBelow = fy > ty;

        return (
          <g key={i}>
            <path
              d={fromBelow
                ? `M${fx},${fy} C${fx},${fy - cp} ${tx},${ty + cp} ${tx},${ty}`
                : `M${fx},${fy} C${fx},${fy + cp} ${tx},${ty - cp} ${tx},${ty}`}
              fill="none" stroke="url(#line-grad)" strokeWidth="2"
              strokeDasharray="6 4" markerEnd="url(#arr)"
              filter="url(#line-glow)" />
            <text
              x={(fx + tx) / 2 + (fx === tx ? 12 : 0)}
              y={(fy + ty) / 2 - 4}
              textAnchor="middle" fill="#908fa0" fontSize="9"
              fontFamily="Inter, system-ui, sans-serif">
              includes
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const isRoot = n.layer === 0;
        const textMaxW = n.w - 24;

        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h}
              rx="6" ry="6"
              fill={isRoot ? "#1c1b1b" : "#201f1f"}
              stroke={isRoot ? "#8083ff" : "#464554"}
              strokeWidth={isRoot ? 1.5 : 0.5}
              strokeOpacity={isRoot ? 0.8 : 0.3} />

            {n.tag && (
              <text x={n.x + n.w / 2} y={n.y + 16}
                textAnchor="middle" fill={isRoot ? "#c0c1ff" : "#908fa0"}
                fontSize="8" fontWeight="600" letterSpacing="1.5"
                fontFamily="Inter, system-ui, sans-serif">
                {n.tag}
              </text>
            )}

            <text x={n.x + n.w / 2} y={n.y + (n.tag ? 34 : 28)}
              textAnchor="middle" fill="#e5e2e1"
              fontSize="13" fontWeight="600"
              fontFamily="'Space Grotesk', ui-monospace, monospace">
              {truncateByWidth(n.name, textMaxW, 13)}
            </text>

            <text x={n.x + n.w / 2} y={n.y + (n.tag ? 50 : 46)}
              textAnchor="middle" fill="#908fa0"
              fontSize="10" fontStyle="italic"
              fontFamily="Inter, system-ui, sans-serif">
              {truncateByWidth(n.desc, textMaxW, 10)}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${MARGIN}, ${svgH - 20})`}>
        <circle cx="4" cy="0" r="3" fill="#c0c1ff" />
        <text x="12" y="3" fill="#908fa0" fontSize="9" fontFamily="Inter, system-ui, sans-serif">CORE FLOW</text>
        <circle cx="90" cy="0" r="3" fill="#8083ff" />
        <text x="98" y="3" fill="#908fa0" fontSize="9" fontFamily="Inter, system-ui, sans-serif">CRITICAL PATH</text>
      </g>
    </svg>
  );
}
