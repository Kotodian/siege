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

// Estimate text width (rough: CJK ~12px per char, latin ~7px per char at fontSize)
function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e80 ? fontSize * 0.95 : fontSize * 0.6;
  }
  return w;
}

function layoutNodes(components: Component[]): Node[] {
  const nameSet = new Set(components.map(c => c.name));
  const depCount = new Map<string, number>();

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

  const layers = new Map<number, Component[]>();
  for (const c of components) {
    const depth = depCount.get(c.name) || 0;
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth)!.push(c);
  }

  const PAD_X = 24;
  const PAD_Y = 16;
  const NAME_SIZE = 13;
  const DESC_SIZE = 11;
  const GAP_X = 50;
  const GAP_Y = 60;
  const nodes: Node[] = [];

  // Calculate natural width per component
  const sizes = components.map(c => {
    const nameW = textWidth(c.name, NAME_SIZE);
    const descW = textWidth(c.responsibility, DESC_SIZE);
    const w = Math.max(nameW, descW) + PAD_X * 2;
    return { w: Math.max(140, Math.min(w, 280)), h: 52 + PAD_Y };
  });
  const sizeMap = new Map(components.map((c, i) => [c.name, sizes[i]]));

  const sortedLayers = [...layers.entries()].sort((a, b) => a[0] - b[0]);

  // Calculate total width per layer to center them
  const layerWidths = sortedLayers.map(([, items]) =>
    items.reduce((sum, c) => sum + (sizeMap.get(c.name)?.w || 160), 0) + (items.length - 1) * GAP_X
  );
  const maxLayerW = Math.max(...layerWidths);

  let currentY = 0;
  for (const [li, [, items]] of sortedLayers.entries()) {
    const layerW = layerWidths[li];
    let currentX = (maxLayerW - layerW) / 2;

    for (const comp of items) {
      const size = sizeMap.get(comp.name) || { w: 160, h: 68 };
      nodes.push({
        id: comp.name,
        name: comp.name,
        responsibility: comp.responsibility,
        x: currentX,
        y: currentY,
        w: size.w,
        h: size.h,
        deps: comp.dependencies.filter(d => nameSet.has(d)),
      });
      currentX += size.w + GAP_X;
    }
    const maxH = Math.max(...items.map(c => sizeMap.get(c.name)?.h || 68));
    currentY += maxH + GAP_Y;
  }

  return nodes;
}

export function ArchitectureDiagram({ components }: ArchitectureDiagramProps) {
  if (components.length === 0) return null;

  const nodes = layoutNodes(components);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const pad = 24;
  const svgW = Math.max(...nodes.map(n => n.x + n.w)) + pad * 2;
  const svgH = Math.max(...nodes.map(n => n.y + n.h)) + pad * 2;

  const edges: Array<{ from: Node; to: Node }> = [];
  for (const node of nodes) {
    for (const depName of node.deps) {
      const dep = nodeMap.get(depName);
      if (dep) edges.push({ from: node, to: dep });
    }
  }

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 500 }}>
      <defs>
        <marker id="ah" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <path d="M0,0 L10,3.5 L0,7" fill="none" stroke="#64748b" strokeWidth="1.5" />
        </marker>
      </defs>

      {/* Arrows */}
      {edges.map((edge, i) => {
        const fx = edge.from.x + edge.from.w / 2 + pad;
        const fy = edge.from.y + edge.from.h + pad;
        const tx = edge.to.x + edge.to.w / 2 + pad;
        const ty = edge.to.y + pad;
        const dy = ty - fy;
        const cp = Math.max(Math.abs(dy) * 0.4, 20);

        return (
          <path key={i} d={`M${fx},${fy} C${fx},${fy + cp} ${tx},${ty - cp} ${tx},${ty}`}
            fill="none" stroke="#475569" strokeWidth="1.5" markerEnd="url(#ah)" />
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const nx = node.x + pad;
        const ny = node.y + pad;
        return (
          <g key={node.id}>
            <rect x={nx} y={ny} width={node.w} height={node.h}
              rx="8" ry="8" fill="none" stroke="#334155" strokeWidth="1" />
            <text x={nx + node.w / 2} y={ny + 20} textAnchor="middle"
              fill="#e2e8f0" fontSize="13" fontWeight="600"
              fontFamily="ui-monospace, SFMono-Regular, monospace">
              {node.name}
            </text>
            <text x={nx + node.w / 2} y={ny + 38} textAnchor="middle"
              fill="#64748b" fontSize="11"
              fontFamily="system-ui, -apple-system, sans-serif">
              {node.responsibility.length > 36 ? node.responsibility.slice(0, 35) + "…" : node.responsibility}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
