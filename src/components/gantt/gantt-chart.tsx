"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";

interface GanttTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  dependencies?: string[];
  custom_class?: string;
}

interface GanttChartProps {
  tasks: GanttTask[];
  onDateChange?: (
    taskId: string,
    start: Date,
    end: Date
  ) => void;
  onProgressChange?: (taskId: string, progress: number) => void;
  onClick?: (taskId: string) => void;
  viewMode?: "Day" | "Week" | "Month";
}

function GanttChartInner({
  tasks,
  onDateChange,
  onProgressChange,
  onClick,
  viewMode = "Day",
}: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || tasks.length === 0) return;

    // Dynamic import to avoid SSR issues
    import("frappe-gantt").then(({ default: Gantt }) => {
      // Clear previous chart
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }

      const ganttTasks = tasks.map((t) => ({
        id: t.id,
        name: t.name,
        start: t.start,
        end: t.end,
        progress: t.progress,
        dependencies: t.dependencies?.join(", ") || "",
        custom_class: t.custom_class || "",
      }));

      ganttRef.current = new Gantt(containerRef.current!, ganttTasks, {
        view_mode: viewMode,
        bar_height: 30,
        column_width: 45,
        padding: 18,
        on_date_change: (task: any, start: Date, end: Date) => {
          onDateChange?.(task.id, start, end);
        },
        on_progress_change: (task: any, progress: number) => {
          onProgressChange?.(task.id, progress);
        },
        on_click: (task: any) => {
          onClick?.(task.id);
        },
      });
    });

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [tasks, viewMode]);

  if (tasks.length === 0) {
    return null;
  }

  return <div ref={containerRef} className="overflow-x-auto bg-white rounded-lg border" />;
}

// Wrap in dynamic to avoid SSR
export const GanttChart = dynamic(() => Promise.resolve(GanttChartInner), {
  ssr: false,
});
