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
import { GitBranchIcon, PlusIcon, RefreshIcon, PlayIcon, SparklesIcon, HourglassIcon, XIcon } from "@/components/ui/icons";

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

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
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
  const abortRef = useRef<AbortController | null>(null);

  // Edit state
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", startDate: "", endDate: "", engine: "claude-code" });

  // Add task state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ title: "", description: "", startDate: "", endDate: "", estimatedHours: "2" });

  const fetchSchedule = async () => {
    const res = await fetch(`/api/schedules?planId=${planId}`);
    const data = await res.json();
    setSchedule(data);
    // Sync selectedItem with fresh data
    if (data && selectedItem) {
      const updated = data.items?.find((i: ScheduleItem) => i.id === selectedItem.id);
      setSelectedItem(updated || null);
    }
  };

  const { startLoading, updateContent, stopLoading, setTasks, updateTaskStatus, setOnCancel } = useGlobalLoading();

  useEffect(() => {
    fetchSchedule();
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

  useEffect(() => {
    if (schedule?.autoExecute !== undefined) setAutoExecute(schedule.autoExecute);
  }, [schedule?.autoExecute]);

  // Auto-execute: run tasks one after another with progress display
  useEffect(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (!autoExecute || !schedule) return;

    const controller = new AbortController();
    abortRef.current = controller;

    // Register cancel handler so the loading dialog's cancel button works
    setOnCancel(() => handleToggleAutoExecute());

    const runLoop = async () => {
      let firstRun = true;
      while (!controller.signal.aborted) {
        try {
          const res = await fetch("/api/schedules/tick", { method: "POST", signal: controller.signal });
          if (!res.ok) break;
          const data = await res.json();
          if (!data.executed || !data.nextTask) break;

          if (firstRun && data.allTasks) {
            setTasks(data.allTasks);
            firstRun = false;
          }
          updateTaskStatus(data.nextTask.itemId, "running");

          const { title, order } = data.nextTask;
          await handleExecuteItem(data.nextTask.itemId, [], `#${order} ${title}`, undefined, undefined, controller.signal);

          if (controller.signal.aborted) break;
          updateTaskStatus(data.nextTask.itemId, "completed");
          await fetchSchedule();
          onPlanStatusChange();
        } catch {
          break;
        }
      }
    };

    runLoop();
    tickRef.current = setInterval(() => { if (!executing && !controller.signal.aborted) runLoop(); }, 30000);
    return () => {
      controller.abort();
      abortRef.current = null;
      setOnCancel(null);
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [autoExecute, schedule?.id]);

  const handleToggleAutoExecute = async () => {
    if (!schedule) return;
    const newValue = !autoExecute;
    if (!newValue && abortRef.current) {
      // Cancel immediately: abort running fetch + close loading dialog
      abortRef.current.abort();
      abortRef.current = null;
      setExecuting(null);
      stopLoading(isZh ? "已停止自动执行" : "Auto-execute stopped");
      setTasks([]);
      await fetchSchedule();
    }
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
        body: JSON.stringify({ planId }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        updateContent(isZh ? "AI 正在分析方案并拆解任务..." : "AI analyzing schemes and breaking down tasks...");
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          // Parse partial JSON to show tasks as markdown list
          try {
            const tasks = JSON.parse(content.trim().replace(/,\s*$/, "") + "]") as Array<{ title?: string; description?: string; estimatedHours?: number; order?: number }>;
            if (tasks.length > 0) {
              const md = tasks.map((t, i) =>
                `### ${t.order || i + 1}. ${t.title || "..."}\n${t.description || ""}\n\n> ${isZh ? "预估" : "Est."} ${t.estimatedHours || "?"}h`
              ).join("\n\n---\n\n");
              updateContent(md);
            }
          } catch {
            // JSON not complete yet — try extracting what we can
            const titles = content.match(/"title"\s*:\s*"([^"]+)"/g);
            if (titles && titles.length > 0) {
              const list = titles.map((m, i) => {
                const t = m.match(/"title"\s*:\s*"([^"]+)"/)?.[1] || "";
                return `${i + 1}. ${t}`;
              }).join("\n");
              updateContent(`${isZh ? "已拆解任务：" : "Tasks so far:"}\n\n${list}\n\n${isZh ? "继续生成中..." : "Generating..."}`);
            }
          }
        }

        if (content.includes("Error:") && content.trim().split("\n").length < 5) {
          stopLoading(isZh ? `排期生成失败: ${content.trim()}` : `Failed: ${content.trim()}`);
        } else {
          await new Promise((r) => setTimeout(r, 500));
          await fetchSchedule();
          onPlanStatusChange();
          stopLoading(isZh ? "排期生成完成" : "Schedule generated");
        }
      } else {
        stopLoading(isZh ? `排期生成失败 (${res.status})` : `Failed (${res.status})`);
      }
    } catch (err) {
      stopLoading(isZh ? `排期生成失败: ${err instanceof Error ? err.message : "未知错误"}` : `Failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRetry = async (item: ScheduleItem) => {
    if (item.status === "failed") {
      // Reset to pending first
      await fetch(`/api/schedule-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending", progress: 0, executionLog: "" }),
      });
      await fetchSchedule();
    }
    setRunDialogItem(item);
  };

  const handleExecuteItem = async (itemId: string, skills: string[] = [], progressLabel?: string, provider?: string, model?: string, signal?: AbortSignal) => {
    setExecuting(itemId);
    startLoading(progressLabel || (isZh ? "AI 正在执行任务..." : "AI executing task..."));
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, skills, ...(provider && { provider }), ...(model && { model }) }),
        signal,
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          if (signal?.aborted) { reader.cancel(); break; }
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateContent(content);
        }
      }

      if (signal?.aborted) throw new Error("cancelled");
      await new Promise((r) => setTimeout(r, 500));
      await fetchSchedule();
      onPlanStatusChange();
      stopLoading(isZh ? "任务执行完成" : "Task completed");
    } catch (err) {
      if (signal?.aborted) {
        stopLoading(isZh ? "已取消自动执行" : "Auto-execute cancelled");
      } else {
        stopLoading(isZh ? "执行失败" : "Execution failed");
      }
    } finally {
      setExecuting(null);
    }
  };

  // Reschedule: shift all pending/failed tasks from now
  const handleReschedule = async () => {
    if (!schedule) return;
    const pendingItems = schedule.items
      .filter(i => i.status === "pending" || i.status === "failed")
      .sort((a, b) => a.order - b.order);

    if (pendingItems.length === 0) return;

    const now = new Date();
    let cursor = now;

    for (const item of pendingItems) {
      const originalDuration = new Date(item.endDate).getTime() - new Date(item.startDate).getTime();
      const duration = originalDuration > 0 ? originalDuration : 2 * 3600000; // default 2h
      const newStart = new Date(cursor);
      const newEnd = new Date(cursor.getTime() + duration);
      cursor = newEnd;

      await fetch(`/api/schedule-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          ...(item.status === "failed" && { status: "pending" }),
        }),
      });
    }

    await fetchSchedule();
  };

  // Edit task
  const startEditing = (item: ScheduleItem) => {
    setEditingItem(item.id);
    setEditForm({
      title: item.title,
      description: item.description || "",
      startDate: toLocalDatetime(item.startDate),
      endDate: toLocalDatetime(item.endDate),
      engine: item.engine || "claude-code",
    });
  };

  const saveEdit = async () => {
    if (!editingItem) return;
    await fetch(`/api/schedule-items/${editingItem}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editForm.title,
        description: editForm.description,
        startDate: new Date(editForm.startDate).toISOString(),
        endDate: new Date(editForm.endDate).toISOString(),
        engine: editForm.engine,
      }),
    });
    setEditingItem(null);
    await fetchSchedule();
  };

  // Delete task
  const handleDeleteItem = async (itemId: string) => {
    await fetch(`/api/schedule-items/${itemId}`, { method: "DELETE" });
    setSelectedItem(null);
    await fetchSchedule();
  };

  // Add task
  const handleAddTask = async () => {
    if (!addForm.title.trim()) return;
    await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        title: addForm.title,
        description: addForm.description,
        startDate: addForm.startDate ? new Date(addForm.startDate).toISOString() : undefined,
        endDate: addForm.endDate ? new Date(addForm.endDate).toISOString() : undefined,
        estimatedHours: Number(addForm.estimatedHours) || 2,
      }),
    });
    setAddDialogOpen(false);
    setAddForm({ title: "", description: "", startDate: "", endDate: "", estimatedHours: "2" });
    await fetchSchedule();
    onPlanStatusChange();
  };

  const handleDateChange = async (taskId: string, start: Date, end: Date) => {
    await fetch(`/api/schedule-items/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: start.toISOString(), endDate: end.toISOString() }),
    });
    await fetchSchedule();
  };

  const canGenerate = planStatus === "confirmed";
  const canExecute = planStatus === "scheduled" || planStatus === "executing";
  const canEdit = planStatus === "scheduled" || planStatus === "confirmed" || planStatus === "executing" || planStatus === "code_review" || planStatus === "testing";

  if (!schedule && !canGenerate && planStatus !== "confirmed") {
    return (
      <p className="text-center py-8" style={{ color: "var(--muted)" }}>{t("common.noData")}</p>
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

  const pendingCount = schedule?.items.filter(i => i.status === "pending" || i.status === "failed").length || 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">
          {t("plan.tabs.schedule")}
        </h3>
        <div className="flex items-center gap-2">
          {gitInfo?.isGit && (
            <div className="flex items-center gap-1 text-xs">
              <span className="font-mono" style={{ color: "var(--muted)" }}>
                {gitInfo.currentBranch}
              </span>
              <Button variant="ghost" size="sm" onClick={() => { setBranchName(`feat/plan-${planId.slice(0, 8)}`); setBranchDialogOpen(true); }}>
                <><GitBranchIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "创建分支" : "New Branch"}</>
              </Button>
            </div>
          )}
          {schedule && canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setAddDialogOpen(true)}>
              <><PlusIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "添加任务" : "Add Task"}</>
            </Button>
          )}
          {schedule && pendingCount > 0 && canEdit && (
            <Button variant="secondary" size="sm" onClick={handleReschedule}>
              <><RefreshIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "重新排期" : "Reschedule"}</>
            </Button>
          )}
          {schedule && canExecute && (
            <button
              onClick={handleToggleAutoExecute}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                autoExecute
                  ? "bg-green-100 text-green-700 hover:bg-green-200"
                  : "hover:opacity-80"
              }`}
              style={!autoExecute ? { background: "var(--card-border)", color: "var(--muted)" } : undefined}
            >
              <span className={`w-2 h-2 rounded-full ${autoExecute ? "bg-green-500 animate-pulse" : ""}`} style={!autoExecute ? { background: "var(--muted)" } : undefined} />
              <><PlayIcon size={14} className="inline-block align-[-2px]" /> {autoExecute
                ? (isZh ? "自动执行中" : "Auto-Executing")
                : (isZh ? "自动执行" : "Auto-Execute")}</>
            </button>
          )}
          {(canGenerate || planStatus === "scheduled") && (
            <Button onClick={handleGenerate} disabled={generating}>
              {generating
                ? <><HourglassIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "生成中..." : "Generating..."}</>
                : schedule
                  ? <><SparklesIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "重新生成" : "Regenerate"}</>
                  : <><SparklesIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "生成排期" : "Generate"}</>}
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
              setSelectedItem(selectedItem?.id === taskId ? null : item || null);
            }}
          />

          {/* Selected task detail panel */}
          {selectedItem && (() => {
            const item = selectedItem;
            const isEditing = editingItem === item.id;
            return (
              <div className="mt-4 rounded-lg border p-4" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
                {isEditing ? (
                  <div className="space-y-3">
                    <input
                      className="w-full border rounded px-2 py-1 text-sm font-medium"
                      style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    />
                    <textarea
                      className="w-full border rounded px-2 py-1 text-sm resize-y min-h-[60px]"
                      style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      placeholder={isZh ? "任务描述..." : "Task description..."}
                    />
                    <div className="flex gap-3">
                      <label className="flex-1">
                        <span className="text-xs" style={{ color: "var(--muted)" }}>{isZh ? "开始时间" : "Start"}</span>
                        <input type="datetime-local" className="w-full border rounded px-2 py-1 text-sm"
                          style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                          value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
                      </label>
                      <label className="flex-1">
                        <span className="text-xs" style={{ color: "var(--muted)" }}>{isZh ? "结束时间" : "End"}</span>
                        <input type="datetime-local" className="w-full border rounded px-2 py-1 text-sm"
                          style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                          value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
                      </label>
                    </div>
                    <div>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>{isZh ? "执行引擎" : "Engine"}</span>
                      <select className="w-full border rounded px-2 py-1 text-sm"
                        style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                        value={editForm.engine} onChange={(e) => setEditForm({ ...editForm, engine: e.target.value })}>
                        <option value="claude-code">Claude Code (SDK)</option>
                        <option value="acp">Claude Code (ACP)</option>
                        <option value="codex-acp">Codex (ACP)</option>
                      </select>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="secondary" size="sm" onClick={() => setEditingItem(null)}>{t("common.cancel")}</Button>
                      <Button size="sm" onClick={saveEdit}>{t("common.save")}</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm" style={{ color: "var(--muted)" }}>#{item.order}</span>
                        <h4 className="font-medium">{item.title}</h4>
                        <StatusBadge status={item.status} label={item.status} />
                        {item.engine === "acp" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--card-border)", color: "var(--foreground)" }}>ACP</span>
                        )}
                        {item.engine === "codex-acp" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--card-border)", color: "var(--foreground)" }}>Codex</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm" style={{ color: "var(--muted)" }}>{item.progress}%</span>
                        {canEdit && (item.status === "pending" || item.status === "failed") && (
                          <>
                            <button onClick={() => startEditing(item)} className="text-xs px-2 py-1 rounded" style={{ color: "var(--muted)" }}>{t("common.edit")}</button>
                            <button onClick={() => handleDeleteItem(item.id)} className="text-xs px-2 py-1 rounded text-red-500">{t("common.delete")}</button>
                          </>
                        )}
                        {canExecute && (item.status === "pending" || item.status === "failed") && (
                          <Button size="sm" onClick={() => handleRetry(item)} disabled={executing !== null}>
                            {executing === item.id ? t("common.loading") : item.status === "failed" ? <><RefreshIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "重试" : "Retry"}</> : (isZh ? "运行" : "Run")}
                          </Button>
                        )}
                        <button onClick={() => setSelectedItem(null)} className="text-xs px-2 py-1 rounded" style={{ color: "var(--muted)" }}><XIcon size={14} /></button>
                      </div>
                    </div>
                    {item.description && (
                      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--card-border)" }}>
                        <MarkdownRenderer content={item.description} />
                      </div>
                    )}
                    {item.executionLog && (
                      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--card-border)" }}>
                        <h5 className="text-sm font-medium mb-1">{t("plan.tabs.logs")}</h5>
                        <pre className="text-xs p-3 rounded overflow-auto max-h-60" style={{ background: "var(--background)" }}>
                          {item.executionLog}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </>
      )}

      {runDialogItem && (
        <RunTaskDialog
          open={!!runDialogItem}
          onClose={() => setRunDialogItem(null)}
          onRun={(skills, provider, model) => handleExecuteItem(runDialogItem.id, skills, undefined, provider, model)}
          taskTitle={runDialogItem.title}
        />
      )}

      {/* Add Task Dialog */}
      <Dialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        title={isZh ? "添加任务" : "Add Task"}
      >
        <div className="space-y-4">
          <Input
            label={isZh ? "任务标题" : "Task Title"}
            value={addForm.title}
            onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
            placeholder={isZh ? "例如：实现用户认证模块" : "e.g., Implement user auth module"}
          />
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
              {isZh ? "任务描述" : "Description"}
            </label>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[80px]"
              style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
              placeholder={isZh ? "描述任务的详细内容..." : "Describe what to implement..."}
            />
          </div>
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>{isZh ? "开始时间" : "Start Time"}</span>
              <input
                type="datetime-local"
                className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                value={addForm.startDate}
                onChange={(e) => setAddForm({ ...addForm, startDate: e.target.value })}
              />
            </label>
            <label className="flex-1">
              <span className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>{isZh ? "结束时间" : "End Time"}</span>
              <input
                type="datetime-local"
                className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                value={addForm.endDate}
                onChange={(e) => setAddForm({ ...addForm, endDate: e.target.value })}
              />
            </label>
          </div>
          {!addForm.startDate && !addForm.endDate && (
            <Input
              label={isZh ? "预估工时（小时）" : "Estimated Hours"}
              type="number"
              value={addForm.estimatedHours}
              onChange={(e) => setAddForm({ ...addForm, estimatedHours: e.target.value })}
              placeholder="2"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleAddTask} disabled={!addForm.title.trim()}>
              {t("common.create")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Branch Dialog */}
      <Dialog
        open={branchDialogOpen}
        onClose={() => setBranchDialogOpen(false)}
        title={isZh ? "创建 Git 分支" : "Create Git Branch"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
              {isZh ? "基于分支" : "Base Branch"}
            </label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
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
