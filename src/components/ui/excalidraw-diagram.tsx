"use client";

import { useEffect, useState } from "react";

interface Component {
  name: string;
  responsibility: string;
  dependencies: string[];
}

interface ExcalidrawDiagramProps {
  components: Component[];
  dataFlow?: string[];
}

// Generate Excalidraw elements from architecture components
function generateScene(components: Component[]) {
  const elements: Array<Record<string, unknown>> = [];
  const CARD_W = 220;
  const CARD_H = 80;
  const GAP_X = 60;
  const GAP_Y = 40;
  const COLS = Math.min(components.length, 3);

  // Position map for arrow routing
  const positions = new Map<string, { x: number; y: number; id: string }>();

  // Create rectangles for each component
  components.forEach((comp, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * (CARD_W + GAP_X) + 50;
    const y = row * (CARD_H + GAP_Y + 40) + 50;
    const id = `rect-${i}`;

    positions.set(comp.name, { x: x + CARD_W / 2, y: y + CARD_H / 2, id });

    // Rectangle
    elements.push({
      id,
      type: "rectangle",
      x,
      y,
      width: CARD_W,
      height: CARD_H,
      strokeColor: "#a5b4fc",
      backgroundColor: "#1e1b4b",
      fillStyle: "solid",
      strokeWidth: 2,
      roundness: { type: 3 },
      boundElements: [],
      groupIds: [],
      frameId: null,
      isDeleted: false,
      opacity: 100,
      angle: 0,
      seed: Math.floor(Math.random() * 1e9),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1e9),
    });

    // Component name text
    elements.push({
      id: `text-name-${i}`,
      type: "text",
      x: x + 15,
      y: y + 12,
      width: CARD_W - 30,
      height: 20,
      text: comp.name,
      fontSize: 14,
      fontFamily: 3, // monospace
      textAlign: "center",
      verticalAlign: "top",
      strokeColor: "#e2e8f0",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      groupIds: [],
      frameId: null,
      isDeleted: false,
      opacity: 100,
      angle: 0,
      containerId: null,
      originalText: comp.name,
      autoResize: true,
      seed: Math.floor(Math.random() * 1e9),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1e9),
      lineHeight: 1.25 as number,
    });

    // Responsibility text (smaller)
    const shortResp = comp.responsibility.length > 40 ? comp.responsibility.slice(0, 38) + "..." : comp.responsibility;
    elements.push({
      id: `text-resp-${i}`,
      type: "text",
      x: x + 10,
      y: y + 38,
      width: CARD_W - 20,
      height: 30,
      text: shortResp,
      fontSize: 11,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "top",
      strokeColor: "#94a3b8",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      groupIds: [],
      frameId: null,
      isDeleted: false,
      opacity: 100,
      angle: 0,
      containerId: null,
      originalText: shortResp,
      autoResize: true,
      seed: Math.floor(Math.random() * 1e9),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1e9),
      lineHeight: 1.25 as number,
    });
  });

  // Create arrows for dependencies
  components.forEach((comp) => {
    const from = positions.get(comp.name);
    if (!from) return;
    for (const depName of comp.dependencies) {
      const to = positions.get(depName);
      if (!to) continue;
      elements.push({
        id: `arrow-${from.id}-${to.id}`,
        type: "arrow",
        x: from.x,
        y: from.y + CARD_H / 2,
        width: to.x - from.x,
        height: to.y - from.y,
        points: [[0, 0], [to.x - from.x, to.y - from.y - CARD_H / 2]],
        strokeColor: "#64748b",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        roundness: { type: 2 },
        startBinding: { elementId: from.id, focus: 0, gap: 5, fixedPoint: null },
        endBinding: { elementId: to.id, focus: 0, gap: 5, fixedPoint: null },
        startArrowhead: null,
        endArrowhead: "arrow",
        groupIds: [],
        frameId: null,
        isDeleted: false,
        opacity: 100,
        angle: 0,
        seed: Math.floor(Math.random() * 1e9),
        version: 1,
        versionNonce: Math.floor(Math.random() * 1e9),
      });
    }
  });

  return elements;
}

export function ExcalidrawDiagram({ components }: ExcalidrawDiagramProps) {
  const [Excalidraw, setExcalidraw] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
  const [elements, setElements] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    setElements(generateScene(components));
    import("@excalidraw/excalidraw").then((mod) => {
      setExcalidraw(() => mod.Excalidraw);
    }).catch(() => { /* excalidraw failed to load */ });
  }, [components]);

  if (!Excalidraw) {
    return <div className="text-xs p-4 animate-pulse" style={{ color: "var(--muted)" }}>Loading diagram...</div>;
  }

  return (
    <div style={{ height: 400, width: "100%" }}>
      <Excalidraw
        initialData={{ elements, appState: { viewBackgroundColor: "transparent", theme: "dark", viewModeEnabled: true } }}
        viewModeEnabled={true}
        UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false } }}
      />
    </div>
  );
}
