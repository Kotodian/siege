"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RunTaskDialog } from "./run-task-dialog";
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
  autoExecute: boolean;
  items: ScheduleItem[];
}

interface ScheduleViewProps {
  planId: string;
  planStatus: string;
  projectId: string;
  onPlanStatusChange: () => void;
}

export function ScheduleView({
  planId,
  planStatus,
  projectId,
  onPlanStatusChange,
}: ScheduleViewProps) {
  const t = useTranslations();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [gitInfo, setGitInfo] = useState<{ isGit: boolean; currentBranch?: string; branches?: string[] } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScheduleItem | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [runDialogItem, setRunDialogItem] = useState<ScheduleItem | null>(null);
  const [autoExecute, setAutoExecute] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSchedule = async () => {
    const res = await fetch(`/api/schedules?planId=${planId}`);
    const data = await res.json();
    setSchedule(data);
  };

  const { startLoading, updateContent, stopLoading } = useGlobalLoading();

  useEffect(() => {
    fetchSchedule().then(() => {
      // Sync autoExecute state from schedule
      if (schedule?.autoExecute) setAutoExecute(true);
    });
    // Check git status
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(p => {
        if (p.targetRepoPath) {
          fetch(`/api/git?path=${encodeURIComponent(p.targetRepoPath)}`)
            .then(r => r.json())
            .then(setGitInfo)
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [planId, projectId]);

  // Sync autoExecute from fetched schedule
  useEffect(() => {
    if (schedule?.autoExecute !== undefined) {
      setAutoExecute(schedule.autoExecute);
    }
  }, [schedule?.autoExecute]);

  // Auto-execute polling
  useEffect(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (!autoExecute || !schedule) return;
    const tick = async () => {
      try {
        const res = await fetch("/api/schedules/tick", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          if (data.executed) {
            // Refresh schedule to see status changes
            await fetchSchedule();
            onPlanStatusChange();
          }
        }
      } catch { /* ignore */ }
    };
    tick(); // Run immediately
    tickRef.current = setInterval(tick, 30000); // Then every 30s
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [autoExecute, schedule?.id]);

  const handleToggleAutoExecute = async () => {
    if (!schedule) return;
    const newValue = !autoExecute;
    setAutoExecute(newValue);
    await fetch("/api/schedules/auto-execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId: schedule.id, enabled: newValue }),
    });
  };

  const isZh = t("common.back") === "返回";

  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);

  const handleCreateBranch = async () => {
    if (!branchName.trim()) return;
    setCreatingBranch(true);
    try {
      const projRes = await fetch(`/api/projects/${projectId}`);
      const proj = await projRes.json();
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: proj.targetRepoPath,
          branchName: branchName.trim(),
          baseBranch: baseBranch || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGitInfo((prev) => prev ? { ...prev, currentBranch: data.branch } : prev);
        setBranchDialogOpen(false);
        setBranchName("");
        setBaseBranch("");
      }
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    startLoading(isZh ? "AI 正在生成排期..." : "AI generating schedule...");
    try {
      const res = await fetch("/api/schedules/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, provider: "openai" }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateContent(content);
        }
      }

      await new Promise((r) => setTimeout(r, 500));
      await fetchSchedule();
      onPlanStatusChange();
      stopLoading(isZh ? "排期生成完成" : "Schedule generated");
    } catch {
      stopLoading(isZh ? "排期生成失败" : "Schedule generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleExecuteItem = async (itemId: string, skills: string[] = []) => {
    setExecuting(itemId);
    startLoading(isZh ? "AI 正在执行任务..." : "AI executing task...");

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, skills }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateContent(content);
        }
      }

      await new Promise((r) => setTimeout(r, 500));
      await fetchSchedule();
      onPlanStatusChange();
      stopLoading(isZh ? "任务执行完成" : "Task completed");
    } catch {
      stopLoading(isZh ? "执行失败" : "Execution failed");
    } finally {
      setExecuting(null);
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
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      }),
    });
    await fetchSchedule();
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
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
        <div className="flex items-center gap-2">
          {gitInfo?.isGit && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-400 font-mono">
                {gitInfo.currentBranch}
              </span>
              <Button variant="ghost" size="sm" onClick={() => { setBranchName(`feat/plan-${planId.slice(0, 8)}`); setBranchDialogOpen(true); }}>
                {isZh ? "创建分支" : "New Branch"}
              </Button>
            </div>
          )}
          {schedule && canExecute && (
            <button
              onClick={handleToggleAutoExecute}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                autoExecute
                  ? "bg-green-100 text-green-700 hover:bg-green-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${autoExecute ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
              {autoExecute
                ? (isZh ? "自动执行中" : "Auto-Executing")
                : (isZh ? "定时执行" : "Auto-Execute")}
            </button>
          )}
          {(canGenerate || planStatus === "scheduled") && (
            <Button onClick={handleGenerate} disabled={generating}>
              {generating
                ? (isZh ? "生成中..." : "Generating...")
                : schedule
                  ? (isZh ? "重新生成" : "Regenerate")
                  : (isZh ? "生成排期" : "Generate")}
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-gray-400">
                        #{item.order}
                      </span>
                      <h4 className="font-medium">{item.title}</h4>
                      <StatusBadge
                        status={item.status}
                        label={item.status}
                      />
                      <span className="text-xs text-gray-400 font-mono">
                        {formatDateTime(item.startDate)} → {formatDateTime(item.endDate)}
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
                              setRunDialogItem(item);
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
      {runDialogItem && (
        <RunTaskDialog
          open={!!runDialogItem}
          onClose={() => setRunDialogItem(null)}
          onRun={(skills) => handleExecuteItem(runDialogItem.id, skills)}
          taskTitle={runDialogItem.title}
        />
      )}

      <Dialog
        open={branchDialogOpen}
        onClose={() => setBranchDialogOpen(false)}
        title={isZh ? "创建 Git 分支" : "Create Git Branch"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "基于分支" : "Base Branch"}
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
            >
              <option value="">{gitInfo?.currentBranch ? `${isZh ? "当前分支" : "Current"}: ${gitInfo.currentBranch}` : (isZh ? "当前 HEAD" : "Current HEAD")}</option>
              {gitInfo?.branches?.filter(b => b !== gitInfo.currentBranch).map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <Input
            label={isZh ? "新分支名称" : "New Branch Name"}
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="feat/my-feature"
            onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBranchDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCreateBranch} disabled={!branchName.trim() || creatingBranch}>
              {creatingBranch ? t("common.loading") : (isZh ? "创建并切换" : "Create & Checkout")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
