"use client";

interface Component {
  name: string;
  responsibility: string;
  dependencies: string[];
}

interface ArchitectureDiagramProps {
  components: Component[];
}

interface Node {
  id: string;
  name: string;
  responsibility: string;
  x: number;
  y: number;
  w: number;
  h: number;
  deps: string[];
}

// Simple layered layout: group by dependency depth
function layoutNodes(components: Component[]): Node[] {
  const nameSet = new Set(components.map(c => c.name));
  const depCount = new Map<string, number>();

  // Calculate dependency depth for each component
  for (const c of components) depCount.set(c.name, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of components) {
      for (const d of c.dependencies) {
        if (nameSet.has(d)) {
          const newDepth = (depCount.get(d) || 0) + 1;
          if (newDepth > (depCount.get(c.name) || 0)) {
            depCount.set(c.name, newDepth);
            changed = true;
          }
        }
      }
    }
  }

  // Group into layers by depth
  const layers = new Map<number, Component[]>();
  for (const c of components) {
    const depth = depCount.get(c.name) || 0;
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth)!.push(c);
  }

  const W = 180;
  const H = 56;
  const GAP_X = 40;
  const GAP_Y = 70;
  const nodes: Node[] = [];

  const sortedLayers = [...layers.entries()].sort((a, b) => a[0] - b[0]);
  const maxCols = Math.max(...sortedLayers.map(([, items]) => items.length));
  const totalW = maxCols * (W + GAP_X) - GAP_X;

  for (const [, items] of sortedLayers) {
    const layerW = items.length * (W + GAP_X) - GAP_X;
    const offsetX = (totalW - layerW) / 2;
    const row = nodes.length === 0 ? 0 : Math.max(...nodes.map(n => n.y + n.h)) + GAP_Y;

    items.forEach((comp, col) => {
      nodes.push({
        id: comp.name,
        name: comp.name,
        responsibility: comp.responsibility,
        x: offsetX + col * (W + GAP_X),
        y: row,
        w: W,
        h: H,
        deps: comp.dependencies.filter(d => nameSet.has(d)),
      });
    });
  }

  return nodes;
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function ArchitectureDiagram({ components }: ArchitectureDiagramProps) {
  if (components.length === 0) return null;

  const nodes = layoutNodes(components);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Calculate SVG bounds
  const pad = 30;
  const maxX = Math.max(...nodes.map(n => n.x + n.w)) + pad * 2;
  const maxY = Math.max(...nodes.map(n => n.y + n.h)) + pad * 2;

  // Build edges
  const edges: Array<{ from: Node; to: Node }> = [];
  for (const node of nodes) {
    for (const depName of node.deps) {
      const dep = nodeMap.get(depName);
      if (dep) edges.push({ from: node, to: dep });
    }
  }

  return (
    <svg viewBox={`0 0 ${maxX} ${maxY}`} className="w-full" style={{ maxHeight: 420 }}>
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <path d="M0,0 L8,3 L0,6" fill="#64748b" />
        </marker>
        <filter id="card-shadow" x="-4%" y="-4%" width="108%" height="116%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.3" />
        </filter>
        <linearGradient id="card-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>

      {/* Edges */}
      {edges.map((edge, i) => {
        const fx = edge.from.x + edge.from.w / 2 + pad;
        const fy = edge.from.y + edge.from.h + pad;
        const tx = edge.to.x + edge.to.w / 2 + pad;
        const ty = edge.to.y + pad;

        // Curved path
        const midY = (fy + ty) / 2;
        const path = `M${fx},${fy} C${fx},${midY} ${tx},${midY} ${tx},${ty}`;

        return (
          <path key={i} d={path} fill="none" stroke="#475569" strokeWidth="1.5"
            markerEnd="url(#arrowhead)" strokeDasharray={undefined} />
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.x + pad}, ${node.y + pad})`}>
          <rect width={node.w} height={node.h} rx="10" ry="10"
            fill="url(#card-bg)" stroke="#334155" strokeWidth="1.5"
            filter="url(#card-shadow)" />
          {/* Accent line at top */}
          <rect width={node.w - 20} height="2" x="10" y="0" rx="1"
            fill="#818cf8" opacity="0.6" />
          {/* Name */}
          <text x={node.w / 2} y={22} textAnchor="middle"
            fill="#e2e8f0" fontSize="12" fontWeight="600" fontFamily="ui-monospace, monospace">
            {truncate(node.name, 24)}
          </text>
          {/* Responsibility */}
          <text x={node.w / 2} y={40} textAnchor="middle"
            fill="#94a3b8" fontSize="10" fontFamily="system-ui, sans-serif">
            {truncate(node.responsibility, 30)}
          </text>
        </g>
      ))}
    </svg>
  );
}
