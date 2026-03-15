"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { GanttChart } from "@/components/gantt/gantt-chart";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { useGlobalLoading } from "@/components/ui/global-loading";

interface ScheduleItem {
  id: string;
  scheduleId: string;
  schemeId: string | null;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  order: number;
  status: string;
  progress: number;
  executionLog: string | null;
  engine: string | null;
  skills: string | null;
}

interface Schedule {
  id: string;
  planId: string;
  startDate: string;
  endDate: string;
  items: ScheduleItem[];
}

interface ScheduleViewProps {
  planId: string;
  planStatus: string;
  onPlanStatusChange: () => void;
}

export function ScheduleView({
  planId,
  planStatus,
  onPlanStatusChange,
}: ScheduleViewProps) {
  const t = useTranslations();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScheduleItem | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);

  const fetchSchedule = async () => {
    const res = await fetch(`/api/schedules?planId=${planId}`);
    const data = await res.json();
    setSchedule(data);
  };

  const { startLoading, updateContent, stopLoading } = useGlobalLoading();

  useEffect(() => {
    fetchSchedule();
  }, [planId]);

  const isZh = t("common.back") === "返回";

  const handleGenerate = async () => {
    setGenerating(true);
    startLoading(isZh ? "AI 正在生成排期..." : "AI generating schedule...");
    try {
      await fetch("/api/schedules/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          provider: "anthropic",
        }),
      });

      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        updateContent(isZh
          ? `正在生成排期，已等待 ${(i + 1) * 3} 秒...\n\nAI 正在分析方案并拆分为可执行任务。`
          : `Generating schedule... ${(i + 1) * 3}s elapsed.\n\nAI is breaking schemes into executable tasks.`);
        const res = await fetch(`/api/schedules?planId=${planId}`);
        const data = await res.json();
        if (data && data.items && data.items.length > 0) {
          setSchedule(data);
          onPlanStatusChange();
          stopLoading(isZh ? "排期生成完成" : "Schedule generated");
          break;
        }
      }
    } catch {
      stopLoading(isZh ? "排期生成失败" : "Schedule generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleExecuteItem = async (itemId: string) => {
    setExecuting(itemId);

    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });

    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const progress = JSON.parse(line.slice(6));
            if (progress.type === "done") {
              setExecuting(null);
              await fetchSchedule();
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  };

  const handleDateChange = async (
    taskId: string,
    start: Date,
    end: Date
  ) => {
    await fetch(`/api/schedule-items/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
      }),
    });
    await fetchSchedule();
  };

  const canGenerate = planStatus === "confirmed";
  const canExecute = planStatus === "scheduled" || planStatus === "executing";

  if (!schedule && !canGenerate) {
    return (
      <p className="text-gray-500 text-center py-8">{t("common.noData")}</p>
    );
  }

  const ganttTasks =
    schedule?.items.map((item) => ({
      id: item.id,
      name: item.title,
      start: item.startDate,
      end: item.endDate,
      progress: item.progress,
      custom_class:
        item.status === "completed"
          ? "completed"
          : item.status === "failed"
            ? "failed"
            : "",
    })) || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">
          {t("plan.tabs.schedule")}
        </h3>
        <div className="flex gap-2">
          {canGenerate && (
            <Button onClick={handleGenerate} disabled={generating}>
              {generating
                ? (t("common.back") === "返回" ? "生成中（约1-2分钟）..." : "Generating (~1-2min)...")
                : (t("common.back") === "返回" ? "生成排期" : "Generate Schedule")}
            </Button>
          )}
        </div>
      </div>

      {schedule && (
        <>
          <GanttChart
            tasks={ganttTasks}
            onDateChange={handleDateChange}
            onClick={(taskId) => {
              const item = schedule.items.find((i) => i.id === taskId);
              setSelectedItem(item || null);
            }}
          />

          <div className="mt-6 space-y-3">
            {schedule.items
              .sort((a, b) => a.order - b.order)
              .map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border bg-white p-4 ${
                    selectedItem?.id === item.id
                      ? "ring-2 ring-blue-500"
                      : ""
                  }`}
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">
                        #{item.order}
                      </span>
                      <h4 className="font-medium">{item.title}</h4>
                      <StatusBadge
                        status={item.status}
                        label={item.status}
                      />
                      <span className="text-xs text-gray-400">
                        {item.engine || "claude-code"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">
                        {item.progress}%
                      </span>
                      {canExecute &&
                        item.status === "pending" && (
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExecuteItem(item.id);
                            }}
                            disabled={executing !== null}
                          >
                            {executing === item.id
                              ? t("common.loading")
                              : "Run"}
                          </Button>
                        )}
                    </div>
                  </div>
                  {selectedItem?.id === item.id && item.description && (
                    <div className="mt-3 border-t pt-3">
                      <MarkdownRenderer content={item.description} />
                    </div>
                  )}
                  {selectedItem?.id === item.id && item.executionLog && (
                    <div className="mt-3 border-t pt-3">
                      <h5 className="text-sm font-medium mb-1">
                        {t("plan.tabs.logs")}
                      </h5>
                      <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-60">
                        {item.executionLog}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
