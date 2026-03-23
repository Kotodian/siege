"use client";

import { useEffect, useRef, useState } from "react";

interface MermaidDiagramProps {
  chart: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            primaryColor: "#1e293b",
            primaryTextColor: "#e2e8f0",
            primaryBorderColor: "#475569",
            lineColor: "#64748b",
            secondaryColor: "#1e3a5f",
            tertiaryColor: "#1a2a3a",
            fontFamily: "ui-monospace, monospace",
            fontSize: "13px",
          },
          flowchart: { curve: "basis", padding: 15 },
        });
        const id = `mermaid-${Date.now()}`;
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setSvg("");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [chart]);

  if (error) {
    // Fallback: show as preformatted text
    return (
      <pre className="text-xs p-4 rounded-lg overflow-x-auto"
        style={{ background: "var(--background)", color: "var(--foreground)", whiteSpace: "pre" }}>
        {chart}
      </pre>
    );
  }

  if (!svg) {
    return <div className="text-xs animate-pulse p-4" style={{ color: "var(--muted)" }}>Loading diagram...</div>;
  }

  return (
    <div ref={containerRef} className="overflow-x-auto flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
