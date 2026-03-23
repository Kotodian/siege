"use client";

interface Component {
  name: string;
  responsibility: string;
  dependencies: string[];
}

interface ArchitectureDiagramProps {
  components: Component[];
}

interface TreeNode {
  comp: Component;
  children: TreeNode[];
}

function buildTree(components: Component[]): TreeNode[] {
  const nameSet = new Set(components.map(c => c.name));
  const compMap = new Map(components.map(c => [c.name, c]));

  // Find which components are depended upon by others
  const hasParent = new Set<string>();
  for (const c of components) {
    for (const d of c.dependencies) {
      if (nameSet.has(d)) hasParent.add(c.name);
    }
  }

  // Roots: components that nothing depends on (or have no deps themselves)
  const roots = components.filter(c => !hasParent.has(c.name));
  if (roots.length === 0) return components.map(c => ({ comp: c, children: [] }));

  // Build tree: children are components that list this node as a dependency
  const childrenOf = (parentName: string): TreeNode[] => {
    const kids = components.filter(c => c.dependencies.includes(parentName) && c.name !== parentName);
    return kids.map(k => ({ comp: k, children: childrenOf(k.name) }));
  };

  return roots.map(r => ({ comp: r, children: childrenOf(r.name) }));
}

function NodeCard({ comp, isRoot }: { comp: Component; isRoot?: boolean }) {
  return (
    <div className="relative px-4 py-2.5 rounded-lg border text-center min-w-[120px] max-w-[200px]"
      style={{
        background: isRoot ? "rgba(99,102,241,0.1)" : "var(--card)",
        borderColor: isRoot ? "#6366f1" : "var(--card-border)",
      }}>
      <div className="text-xs font-mono font-semibold truncate" style={{ color: "var(--foreground)" }}>
        {comp.name}
      </div>
      <div className="text-[10px] mt-0.5 truncate" style={{ color: "var(--muted)" }}>
        {comp.responsibility}
      </div>
    </div>
  );
}

function TreeLevel({ nodes, isRoot }: { nodes: TreeNode[]; isRoot?: boolean }) {
  if (nodes.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-0">
      {/* Current level nodes */}
      <div className="flex items-start justify-center gap-6">
        {nodes.map((node, i) => (
          <div key={node.comp.name} className="flex flex-col items-center">
            <NodeCard comp={node.comp} isRoot={isRoot} />

            {/* Connector line down if has children */}
            {node.children.length > 0 && (
              <>
                <div className="w-px h-5" style={{ background: "#6366f1", opacity: 0.4 }} />
                <div className="flex items-start justify-center relative">
                  {/* Horizontal connector bar if multiple children */}
                  {node.children.length > 1 && (
                    <div className="absolute top-0 h-px"
                      style={{
                        background: "#6366f1",
                        opacity: 0.4,
                        left: `calc(50% - ${(node.children.length - 1) * 50}%)`,
                        right: `calc(50% - ${(node.children.length - 1) * 50}%)`,
                        minWidth: `${(node.children.length - 1) * 140}px`,
                      }} />
                  )}
                  <div className="flex items-start justify-center gap-4 pt-0">
                    {node.children.map((child) => (
                      <div key={child.comp.name} className="flex flex-col items-center">
                        <div className="w-px h-5" style={{ background: "#6366f1", opacity: 0.4 }} />
                        {/* Arrow tip */}
                        <div className="w-0 h-0 mb-1" style={{
                          borderLeft: "4px solid transparent",
                          borderRight: "4px solid transparent",
                          borderTop: "5px solid rgba(99,102,241,0.5)",
                        }} />
                        <NodeCard comp={child.comp} />
                        {/* Recurse for grandchildren */}
                        {child.children.length > 0 && (
                          <>
                            <div className="w-px h-5" style={{ background: "#6366f1", opacity: 0.4 }} />
                            <TreeLevel nodes={child.children} />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArchitectureDiagram({ components }: ArchitectureDiagramProps) {
  if (components.length === 0) return null;

  const tree = buildTree(components);

  return (
    <div className="overflow-x-auto py-4">
      <div className="inline-flex justify-center min-w-full">
        <TreeLevel nodes={tree} isRoot />
      </div>
    </div>
  );
}
