"use client";

import { useRef, useState, useCallback } from "react";

interface GanttTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  custom_class?: string;
}

interface GanttChartProps {
  tasks: GanttTask[];
  onDateChange?: (taskId: string, start: Date, end: Date) => void;
  onProgressChange?: (taskId: string, progress: number) => void;
  onClick?: (taskId: string) => void;
}

const STATUS_COLORS: Record<string, { bar: string; light: string }> = {
  completed: { bar: "#22c55e", light: "rgba(34,197,94,0.08)" },
  failed:    { bar: "#ef4444", light: "rgba(239,68,68,0.08)" },
  "":        { bar: "#6366f1", light: "rgba(99,102,241,0.06)" },
};

export function GanttChart({ tasks, onDateChange, onClick }: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    taskId: string;
    mode: "move" | "resize";
    startX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);
  const [preview, setPreview] = useState<{ taskId: string; startMs: number; endMs: number } | null>(null);

  if (tasks.length === 0) return null;

  const dates = tasks.flatMap((t) => [new Date(t.start), new Date(t.end)]);
  const minMs = Math.min(...dates.map((d) => d.getTime()));
  const maxMs = Math.max(...dates.map((d) => d.getTime()));
  const totalMs = maxMs - minMs || 1;

  const formatDate = (d: string | Date) => {
    const date = typeof d === "string" ? new Date(d) : d;
    const m = date.getMonth() + 1;
    const day = date.getDate();
    const h = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    return `${m}/${day} ${h}:${min}`;
  };

  const pxToMs = useCallback((px: number) => {
    if (!containerRef.current) return 0;
    const timelineEl = containerRef.current.querySelector("[data-timeline]") as HTMLElement;
    if (!timelineEl) return 0;
    return (px / timelineEl.offsetWidth) * totalMs;
  }, [totalMs]);

  const handlePointerDown = (
    e: React.PointerEvent,
    taskId: string,
    mode: "move" | "resize"
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const origStart = new Date(task.start).getTime();
    const origEnd = new Date(task.end).getTime();
    setDragState({ taskId, mode, startX: e.clientX, origStart, origEnd });
    setPreview({ taskId, startMs: origStart, endMs: origEnd });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const deltaMs = pxToMs(e.clientX - dragState.startX);
    if (dragState.mode === "move") {
      setPreview({ taskId: dragState.taskId, startMs: dragState.origStart + deltaMs, endMs: dragState.origEnd + deltaMs });
    } else {
      const newEnd = Math.max(dragState.origStart + 30 * 60000, dragState.origEnd + deltaMs);
      setPreview({ taskId: dragState.taskId, startMs: dragState.origStart, endMs: newEnd });
    }
  };

  const handlePointerUp = () => {
    if (!dragState || !preview) { setDragState(null); setPreview(null); return; }
    const movedMs = Math.abs(preview.startMs - dragState.origStart) + Math.abs(preview.endMs - dragState.origEnd);
    if (movedMs > 60000 && onDateChange) {
      onDateChange(dragState.taskId, new Date(preview.startMs), new Date(preview.endMs));
    }
    setDragState(null);
    setPreview(null);
  };

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-gray-200 bg-white p-5 overflow-x-auto select-none shadow-sm"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div className="min-w-[600px] space-y-1">
        {tasks.map((task, index) => {
          const isPreview = preview?.taskId === task.id;
          const startMs = isPreview ? preview.startMs : new Date(task.start).getTime();
          const endMs = isPreview ? preview.endMs : new Date(task.end).getTime();

          const startOffset = ((startMs - minMs) / totalMs) * 100;
          const width = ((endMs - startMs) / totalMs) * 100 || 5;
          const colors = STATUS_COLORS[task.custom_class || ""] || STATUS_COLORS[""];
          const isDragging = dragState?.taskId === task.id;

          return (
            <div
              key={task.id}
              className={`flex items-center gap-4 py-2 rounded-lg px-3 transition-colors ${
                isDragging ? "bg-gray-50" : "cursor-pointer hover:bg-gray-50/60"
              }`}
              style={{ background: index % 2 === 0 ? "transparent" : colors.light }}
              onClick={() => !isDragging && onClick?.(task.id)}
            >
              {/* Task name */}
              <div
                className="w-40 flex-shrink-0 truncate"
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#374151",
                  letterSpacing: "-0.01em",
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
                }}
                title={task.name}
              >
                {task.name}
              </div>

              {/* Timeline bar area */}
              <div className="flex-1 relative h-8 rounded-lg bg-gray-100/60" data-timeline>
                <div
                  className="absolute h-full rounded-lg flex items-center shadow-sm"
                  style={{
                    left: `${startOffset}%`,
                    width: `${Math.max(width, 2)}%`,
                    background: `linear-gradient(135deg, ${colors.bar}, ${colors.bar}dd)`,
                    cursor: onDateChange ? "grab" : "pointer",
                    opacity: isDragging ? 0.85 : 1,
                    zIndex: isDragging ? 10 : 1,
                    transition: isDragging ? "none" : "left 0.2s ease, width 0.2s ease",
                  }}
                  onPointerDown={(e) => onDateChange && handlePointerDown(e, task.id, "move")}
                >
                  {/* Progress fill */}
                  {task.progress > 0 && task.progress < 100 && (
                    <div
                      className="absolute inset-y-0 right-0 bg-black/10 rounded-r-lg"
                      style={{ width: `${100 - task.progress}%` }}
                    />
                  )}

                  {/* Date range label inside bar */}
                  <span
                    className="truncate px-2 pointer-events-none whitespace-nowrap"
                    style={{
                      fontSize: "10px",
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.92)",
                      fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace',
                      letterSpacing: "0.02em",
                      textShadow: "0 1px 2px rgba(0,0,0,0.15)",
                    }}
                  >
                    {formatDate(isPreview ? new Date(startMs) : task.start)}
                    <span style={{ opacity: 0.6, margin: "0 3px" }}>&rarr;</span>
                    {formatDate(isPreview ? new Date(endMs) : task.end)}
                  </span>

                  {/* Resize handle */}
                  {onDateChange && (
                    <div
                      className="absolute right-0 top-0 w-2.5 h-full cursor-ew-resize rounded-r-lg"
                      style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25))" }}
                      onPointerDown={(e) => handlePointerDown(e, task.id, "resize")}
                    />
                  )}
                </div>
              </div>

              {/* Progress percentage */}
              <div
                className="w-12 text-right flex-shrink-0"
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: task.progress === 100 ? colors.bar : "#9ca3af",
                  fontFamily: '"SF Mono", "Cascadia Code", Menlo, monospace',
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {task.progress}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
