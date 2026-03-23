"use client";

import { useEffect, useState, useMemo } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

interface Component {
  name: string;
  responsibility: string;
  dependencies: string[];
}

interface ExcalidrawDiagramProps {
  components: Component[];
}

function buildElements(components: Component[]): ExcalidrawElement[] {
  const CARD_W = 200;
  const CARD_H = 70;
  const GAP_X = 80;
  const GAP_Y = 100;
  const COLS = Math.min(components.length <= 4 ? 2 : 3, components.length);

  const elements: ExcalidrawElement[] = [];
  const nodeMap = new Map<string, { cx: number; cy: number; id: string; x: number; y: number }>();
  let nextId = 1;
  const mkId = () => `el-${nextId++}`;

  // Layout components in grid
  components.forEach((comp, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * (CARD_W + GAP_X);
    const y = row * (CARD_H + GAP_Y);
    const id = mkId();

    nodeMap.set(comp.name, { cx: x + CARD_W / 2, cy: y + CARD_H / 2, id, x, y });

    // Rectangle
    const textId = mkId();
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
      boundElements: [{ id: textId, type: "text" }],
      angle: 0,
      opacity: 100,
      seed: i * 1000 + 1,
      version: 1,
      versionNonce: i * 1000 + 2,
      isDeleted: false,
      groupIds: [],
      frameId: null,
      index: `a${i}`,
      link: null,
      locked: false,
      updated: Date.now(),
    } as unknown as ExcalidrawElement);

    // Text bound inside rectangle
    const label = comp.name + (comp.responsibility ? `\n${comp.responsibility.slice(0, 35)}` : "");
    elements.push({
      id: textId,
      type: "text",
      x: x + 10,
      y: y + CARD_H / 2 - 14,
      width: CARD_W - 20,
      height: 28,
      text: label,
      fontSize: 13,
      fontFamily: 3,
      textAlign: "center",
      verticalAlign: "middle",
      strokeColor: "#e2e8f0",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      angle: 0,
      opacity: 100,
      containerId: id,
      originalText: label,
      autoResize: true,
      lineHeight: 1.25,
      seed: i * 1000 + 3,
      version: 1,
      versionNonce: i * 1000 + 4,
      isDeleted: false,
      groupIds: [],
      frameId: null,
      index: `a${i}b`,
      link: null,
      locked: false,
      updated: Date.now(),
    } as unknown as ExcalidrawElement);
  });

  // Create arrows for dependencies
  components.forEach((comp) => {
    const from = nodeMap.get(comp.name);
    if (!from) return;
    for (const depName of comp.dependencies) {
      const to = nodeMap.get(depName);
      if (!to) continue;

      const dx = to.cx - from.cx;
      const dy = to.cy - from.cy;
      const arrowId = mkId();

      elements.push({
        id: arrowId,
        type: "arrow",
        x: from.cx,
        y: from.cy,
        width: Math.abs(dx),
        height: Math.abs(dy),
        points: [[0, 0], [dx, dy]],
        strokeColor: "#64748b",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        roundness: { type: 2 },
        startBinding: { elementId: from.id, focus: 0, gap: 5, fixedPoint: null },
        endBinding: { elementId: to.id, focus: 0, gap: 5, fixedPoint: null },
        startArrowhead: null,
        endArrowhead: "arrow",
        angle: 0,
        opacity: 100,
        seed: nextId * 1000 + 5,
        version: 1,
        versionNonce: nextId * 1000 + 6,
        isDeleted: false,
        groupIds: [],
        frameId: null,
        index: `b${nextId}`,
        link: null,
        locked: false,
        updated: Date.now(),
      } as unknown as ExcalidrawElement);
    }
  });

  return elements;
}

export function ExcalidrawDiagram({ components }: ExcalidrawDiagramProps) {
  const [Comp, setComp] = useState<{ Excalidraw: React.ComponentType<Record<string, unknown>> } | null>(null);
  const elements = useMemo(() => buildElements(components), [components]);

  useEffect(() => {
    import("@excalidraw/excalidraw").then((mod) => {
      setComp({ Excalidraw: mod.Excalidraw });
    }).catch(() => {});
  }, []);

  if (!Comp) {
    return <div className="text-xs p-4 animate-pulse" style={{ color: "var(--muted)" }}>Loading diagram...</div>;
  }

  return (
    <div style={{ height: 420, width: "100%" }}>
      <Comp.Excalidraw
        initialData={{
          elements,
          appState: {
            viewBackgroundColor: "transparent",
            theme: "dark",
            viewModeEnabled: true,
            zoom: { value: 0.9 },
            scrollToContent: true,
          },
          scrollToContent: true,
        }}
        viewModeEnabled={true}
      />
    </div>
  );
}
