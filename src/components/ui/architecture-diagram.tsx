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

interface GNode {
  id: string;
  name: string;
  desc: string;
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
  const NAME_SIZE = 12;
  const DESC_SIZE = 10;
  const PAD_X = 20;
  const NODE_H = 52;
  const GAP_X = 60;
  const GAP_Y = 80;
  const MARGIN = 30;

  // Calculate dependency depth (0 = root, no deps)
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

  const sorted = [...layers.entries()].sort((a, b) => a[0] - b[0]);

  // Size each node
  const nodeWidth = (c: Component) => {
    const nw = measureText(c.name, NAME_SIZE);
    const dw = measureText(c.responsibility, DESC_SIZE);
    return Math.max(130, Math.min(Math.max(nw, dw) + PAD_X * 2, 260));
  };

  // Layout
  const nodes: GNode[] = [];
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

  // Build edges with label
  const edges: Array<{ from: GNode; to: GNode; label: string }> = [];
  for (const node of nodes) {
    for (const depName of node.deps) {
      const dep = nodeMap.get(depName);
      if (dep) {
        // Label: "uses" / "depends on" based on direction
        edges.push({ from: node, to: dep, label: "" });
      }
    }
  }

  // Offset overlapping arrows between same pair
  const edgeOffsets = new Map<string, number>();
  for (const e of edges) {
    const key = [e.from.id, e.to.id].sort().join("|");
    const count = edgeOffsets.get(key) || 0;
    edgeOffsets.set(key, count + 1);
  }

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 520 }}>
      <defs>
        <marker id="arr" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
          <path d="M0,1 L10,4 L0,7" fill="#6366f1" stroke="none" />
        </marker>
      </defs>

      {/* Edges — thick, colored, with filled arrowheads */}
      {edges.map((edge, i) => {
        const from = edge.from;
        const to = edge.to;

        // From bottom of 'from' to top of 'to'
        const fromBelow = from.y > to.y;
        const fx = from.x + from.w / 2;
        const fy = fromBelow ? from.y : from.y + from.h;
        const tx = to.x + to.w / 2;
        const ty = fromBelow ? to.y + to.h : to.y;

        const dx = tx - fx;
        const dy = ty - fy;
        const cpOffset = Math.max(Math.abs(dy) * 0.4, 30);

        // Slight horizontal offset if multiple edges to same target
        const offset = i % 2 === 0 ? 0 : 6;

        return (
          <path key={i}
            d={`M${fx + offset},${fy} C${fx + offset},${fy + (fromBelow ? -cpOffset : cpOffset)} ${tx + offset},${ty + (fromBelow ? cpOffset : -cpOffset)} ${tx + offset},${ty}`}
            fill="none" stroke="#6366f1" strokeWidth="2" strokeOpacity="0.7"
            markerEnd="url(#arr)" />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const isRoot = n.layer === 0;
        const desc = n.desc.length > 34 ? n.desc.slice(0, 33) + "…" : n.desc;

        return (
          <g key={n.id}>
            {/* Card */}
            <rect x={n.x} y={n.y} width={n.w} height={n.h}
              rx="8" ry="8"
              fill={isRoot ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)"}
              stroke={isRoot ? "#6366f1" : "#3f3f46"}
              strokeWidth={isRoot ? 1.5 : 1} />

            {/* Name */}
            <text x={n.x + n.w / 2} y={n.y + 22} textAnchor="middle"
              fill="#e4e4e7" fontSize={NAME_SIZE} fontWeight="600"
              fontFamily="ui-monospace, SFMono-Regular, monospace">
              {n.name}
            </text>

            {/* Description */}
            <text x={n.x + n.w / 2} y={n.y + 39} textAnchor="middle"
              fill="#71717a" fontSize={DESC_SIZE}
              fontFamily="system-ui, -apple-system, sans-serif">
              {desc}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
