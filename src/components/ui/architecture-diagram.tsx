"use client";

interface Component {
  name: string;
  responsibility: string;
  dependencies: string[];
}

interface ArchitectureDiagramProps {
  components: Component[];
  dataFlow?: string[];
}

// Estimate text width
function measureText(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e80 ? fontSize * 0.95 : fontSize * 0.58;
  }
  return w;
}

// Word-wrap text to fit maxWidth, returns lines
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/(?<=[\s，、。；])|(?=[\s])/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current + word;
    if (measureText(test.trim(), fontSize) > maxWidth && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = test;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.length ? lines : [text];
}

interface FlowNode {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

export function ArchitectureDiagram({ components, dataFlow }: ArchitectureDiagramProps) {
  // If we have dataFlow, render as flow diagram; otherwise render component dependency graph
  if (dataFlow && dataFlow.length > 0) {
    return <FlowDiagram steps={dataFlow} />;
  }
  if (components.length > 0) {
    return <DependencyGraph components={components} />;
  }
  return null;
}

/** Flow diagram: sequential steps with arrows */
function FlowDiagram({ steps }: { steps: string[] }) {
  const FONT_SIZE = 11;
  const MAX_TEXT_W = 260;
  const PAD_X = 16;
  const PAD_Y = 10;
  const GAP = 16;
  const ARROW_LEN = 28;
  const MARGIN = 20;

  // Build nodes
  const nodes: FlowNode[] = [];
  let currentY = MARGIN;

  for (const step of steps) {
    const lines = wrapText(step, FONT_SIZE, MAX_TEXT_W);
    const textH = lines.length * (FONT_SIZE + 4);
    const w = Math.min(
      Math.max(...lines.map(l => measureText(l, FONT_SIZE))) + PAD_X * 2,
      MAX_TEXT_W + PAD_X * 2
    );
    const h = textH + PAD_Y * 2;

    nodes.push({ label: step, x: 0, y: currentY, w, h, lines });
    currentY += h + ARROW_LEN + GAP;
  }

  // Center horizontally
  const maxW = Math.max(...nodes.map(n => n.w));
  for (const n of nodes) n.x = MARGIN + (maxW - n.w) / 2;

  const svgW = maxW + MARGIN * 2;
  const svgH = currentY - ARROW_LEN - GAP + MARGIN;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 600 }}>
      <defs>
        <marker id="flow-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0.5 L7,3 L0,5.5" fill="none" stroke="#6366f1" strokeWidth="1.2" />
        </marker>
      </defs>

      {nodes.map((node, i) => {
        const isFirst = i === 0;
        const isLast = i === nodes.length - 1;
        const rx = 10;

        return (
          <g key={i}>
            {/* Box */}
            <rect
              x={node.x} y={node.y} width={node.w} height={node.h}
              rx={rx} ry={rx}
              fill="none"
              stroke={isFirst ? "#6366f1" : isLast ? "#ef4444" : "#334155"}
              strokeWidth={isFirst || isLast ? 1.5 : 1}
              strokeDasharray={undefined}
            />

            {/* Step number badge */}
            <circle cx={node.x + 14} cy={node.y} r={9}
              fill="#18181b" stroke="#334155" strokeWidth="1" />
            <text x={node.x + 14} y={node.y + 3.5} textAnchor="middle"
              fill="#a1a1aa" fontSize="9" fontWeight="600" fontFamily="system-ui">{i + 1}</text>

            {/* Text lines */}
            {node.lines.map((line, li) => (
              <text key={li}
                x={node.x + PAD_X} y={node.y + PAD_Y + (li + 1) * (FONT_SIZE + 4) - 3}
                fill="#d4d4d8" fontSize={FONT_SIZE}
                fontFamily="system-ui, -apple-system, sans-serif">
                {line}
              </text>
            ))}

            {/* Arrow to next */}
            {!isLast && (
              <line
                x1={node.x + node.w / 2} y1={node.y + node.h}
                x2={node.x + node.w / 2} y2={node.y + node.h + ARROW_LEN + GAP}
                stroke="#6366f1" strokeWidth="1.5" markerEnd="url(#flow-arrow)"
                opacity="0.6"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Dependency graph: components with arrows showing relationships */
function DependencyGraph({ components }: { components: Component[] }) {
  const nameSet = new Set(components.map(c => c.name));
  const FONT_SIZE = 12;
  const DESC_FONT = 10;
  const PAD_X = 16;
  const PAD_Y = 12;
  const GAP_X = 50;
  const GAP_Y = 50;
  const MARGIN = 24;

  // Calculate depth
  const depCount = new Map<string, number>();
  for (const c of components) depCount.set(c.name, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of components) {
      for (const d of c.dependencies) {
        if (nameSet.has(d)) {
          const nd = (depCount.get(d) || 0) + 1;
          if (nd > (depCount.get(c.name) || 0)) { depCount.set(c.name, nd); changed = true; }
        }
      }
    }
  }

  // Group into layers
  const layers = new Map<number, Component[]>();
  for (const c of components) {
    const d = depCount.get(c.name) || 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(c);
  }

  interface GNode { id: string; name: string; desc: string; x: number; y: number; w: number; h: number; deps: string[] }
  const nodes: GNode[] = [];

  const sorted = [...layers.entries()].sort((a, b) => a[0] - b[0]);
  // Measure each node
  const sizeOf = (c: Component) => {
    const nameW = measureText(c.name, FONT_SIZE);
    const descW = measureText(c.responsibility, DESC_FONT);
    const w = Math.max(nameW, descW) + PAD_X * 2;
    return { w: Math.max(120, Math.min(w, 240)), h: 48 };
  };

  const layerWidths = sorted.map(([, items]) =>
    items.reduce((s, c) => s + sizeOf(c).w, 0) + (items.length - 1) * GAP_X
  );
  const maxLW = Math.max(...layerWidths);

  let curY = MARGIN;
  for (const [li, [, items]] of sorted.entries()) {
    const lw = layerWidths[li];
    let curX = MARGIN + (maxLW - lw) / 2;
    let maxH = 0;
    for (const comp of items) {
      const sz = sizeOf(comp);
      nodes.push({
        id: comp.name, name: comp.name,
        desc: comp.responsibility.length > 32 ? comp.responsibility.slice(0, 31) + "…" : comp.responsibility,
        x: curX, y: curY, w: sz.w, h: sz.h,
        deps: comp.dependencies.filter(d => nameSet.has(d)),
      });
      curX += sz.w + GAP_X;
      maxH = Math.max(maxH, sz.h);
    }
    curY += maxH + GAP_Y;
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const svgW = maxLW + MARGIN * 2;
  const svgH = curY - GAP_Y + MARGIN;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 500 }}>
      <defs>
        <marker id="dep-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0,0.5 L7,3 L0,5.5" fill="none" stroke="#475569" strokeWidth="1.2" />
        </marker>
      </defs>

      {/* Dependency arrows */}
      {nodes.flatMap(node =>
        node.deps.map(depName => {
          const dep = nodeMap.get(depName);
          if (!dep) return null;
          const fx = node.x + node.w / 2;
          const fy = node.y;
          const tx = dep.x + dep.w / 2;
          const ty = dep.y + dep.h;
          const cp = Math.max(Math.abs(fy - ty) * 0.35, 15);
          return (
            <path key={`${node.id}-${depName}`}
              d={`M${fx},${fy} C${fx},${fy - cp} ${tx},${ty + cp} ${tx},${ty}`}
              fill="none" stroke="#334155" strokeWidth="1" markerEnd="url(#dep-arrow)" />
          );
        })
      )}

      {/* Nodes */}
      {nodes.map(n => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="8" ry="8"
            fill="none" stroke="#334155" strokeWidth="1" />
          <text x={n.x + n.w / 2} y={n.y + 20} textAnchor="middle"
            fill="#e2e8f0" fontSize={FONT_SIZE} fontWeight="600"
            fontFamily="ui-monospace, monospace">{n.name}</text>
          <text x={n.x + n.w / 2} y={n.y + 36} textAnchor="middle"
            fill="#64748b" fontSize={DESC_FONT}
            fontFamily="system-ui, sans-serif">{n.desc}</text>
        </g>
      ))}
    </svg>
  );
}
