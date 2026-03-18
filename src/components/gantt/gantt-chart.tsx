"use client";

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

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500",
  failed: "bg-red-500",
  "": "bg-blue-500",
};

export function GanttChart({ tasks, onClick }: GanttChartProps) {
  if (tasks.length === 0) return null;

  // Find date range
  const dates = tasks.flatMap((t) => [new Date(t.start), new Date(t.end)]);
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  const totalMs = maxDate.getTime() - minDate.getTime() || 1;

  const formatDate = (d: string) => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="rounded-lg border bg-white p-4 overflow-x-auto">
      <div className="min-w-[500px]">
        {tasks.map((task) => {
          const startOffset =
            ((new Date(task.start).getTime() - minDate.getTime()) / totalMs) * 100;
          const width =
            ((new Date(task.end).getTime() - new Date(task.start).getTime()) / totalMs) * 100 || 5;
          const barColor = STATUS_COLORS[task.custom_class || ""] || "bg-blue-500";

          return (
            <div
              key={task.id}
              className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-2"
              onClick={() => onClick?.(task.id)}
            >
              <div className="w-36 text-xs text-gray-600 truncate flex-shrink-0">
                {task.name}
              </div>
              <div className="flex-1 relative h-6 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`absolute h-full rounded-full ${barColor} transition-all`}
                  style={{ left: `${startOffset}%`, width: `${Math.max(width, 2)}%` }}
                >
                  {/* Progress overlay */}
                  {task.progress > 0 && task.progress < 100 && (
                    <div
                      className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
                      style={{ width: `${100 - task.progress}%`, right: 0, left: "auto" }}
                    />
                  )}
                </div>
                {/* Date labels */}
                <span
                  className="absolute text-[10px] text-gray-400 top-1"
                  style={{ left: `${startOffset}%`, paddingLeft: 4 }}
                >
                  {formatDate(task.start)}
                </span>
              </div>
              <div className="w-12 text-xs text-right text-gray-500 flex-shrink-0">
                {task.progress}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
