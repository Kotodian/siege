"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { useGlobalLoading } from "@/components/ui/global-loading";
import { computeDiffStats } from "@/lib/diff";
import { FileSidebar } from "./file-sidebar";
import { DiffViewer } from "./diff-viewer";
import { severityIcons, FileStackIcon, CodeIcon, SearchIcon, RefreshIcon, HourglassIcon, BarChartIcon, ClipboardIcon, WrenchIcon, CheckIcon, type IconProps } from "@/components/ui/icons";
import { ProviderModelSelect } from "@/components/ui/provider-model-select";

interface ReviewComment {
  id: string;
  reviewId: string;
  filePath: string;
  lineNumber: number;
  content: string;
  aiResponse: string | null;
  status: string;
  createdAt: string;
}

interface FileSnapshot {
  filePath: string;
  contentBefore: string;
  contentAfter: string;
  scheduleItemId?: string;
  taskTitle?: string;
  taskOrder?: number;
}

interface ReviewItem {
  id: string;
  reviewId: string;
  targetType: string;
  targetId: string;
  title: string;
  content: string | null;
  severity: string;
  resolved: boolean;
  filePath: string | null;
  lineNumber: number | null;
  taskTitle: string | null;
  taskOrder: number | null;
}

interface Review {
  id: string;
  planId: string;
  type: string;
  status: string;
  content: string | null;
  createdAt: string;
  items: ReviewItem[];
  comments: ReviewComment[];
}

interface ReviewPanelProps {
  planId: string;
  type: "scheme" | "implementation";
  planStatus: string;
  onPlanStatusChange: () => void;
}

const severityStyles: Record<string, { bg: string; border: string; color: string }> = {
  critical: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", color: "#fca5a5" },
  warning: { bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.3)", color: "#fde047" },
  info: { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", color: "#93c5fd" },
};

const SeverityIcon = ({ severity }: { severity: string }) => {
  const Ic = severityIcons[severity] || ((p: IconProps) => <SearchIcon {...p} />);
  return <Ic size={14} className="inline-block align-[-2px]" />;
};

export function ReviewPanel({
  planId,
  type,
  planStatus,
  onPlanStatusChange,
}: ReviewPanelProps) {
  const t = useTranslations();
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  // Note: global loading is still used for handleFix
  const [reviews, setReviews] = useState<Review[]>([]);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [streamContent, setStreamContent] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"diff" | "list">("diff");
  const [selectedTask, setSelectedTask] = useState<string | null>(null); // null = all tasks

  const fetchReviews = async () => {
    const res = await fetch(`/api/reviews?planId=${planId}&type=${type}`);
    const data = await res.json();
    setReviews(data);
    return data as Review[];
  };

  const fetchSnapshots = async () => {
    const res = await fetch(`/api/snapshots?planId=${planId}`);
    if (res.ok) {
      const data = await res.json();
      setSnapshots(data);
    }
  };

  const fetchComments = async (reviewId: string) => {
    const res = await fetch(`/api/review-comments?reviewId=${reviewId}`);
    if (res.ok) {
      const data = await res.json();
      // Update the review's comments in state
      setReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, comments: data } : r))
      );
    }
  };

  useEffect(() => {
    fetchReviews().then((data) => {
      const latest = data[data.length - 1];
      if (latest) {
        fetchComments(latest.id);
      }
    });
    if (type === "implementation") {
      fetchSnapshots();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [planId, type]);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    startElapsedTimer();
    setStreamContent(isZh ? "审查进行中，等待结果..." : "Review in progress, waiting for results...");
    let pollCount = 0;
    pollRef.current = setInterval(async () => {
      pollCount++;
      // Timeout after 5 minutes (100 polls * 3s)
      if (pollCount > 100) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        stopElapsedTimer();
        setStreamContent(isZh ? "审查超时，请重试。" : "Review timed out. Please retry.");
        setGenerating(false);
        return;
      }
      const data = await fetchReviews();
      const latest = data[data.length - 1];
      if (latest && latest.status !== "in_progress") {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        stopElapsedTimer();
        setGenerating(false);
        onPlanStatusChange();
      }
    }, 3000);
  };

  const isZh = t("common.back") === "返回";

  const startElapsedTimer = () => {
    setElapsed(0);
    setStreamContent("");
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  };

  const stopElapsedTimer = () => {
    if (elapsedRef.current) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
  };

  const generatingRef = useRef(false);

  const handleGenerate = async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    startElapsedTimer();
    try {
      const res = await fetch("/api/reviews/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, type, ...(reviewProvider && { provider: reviewProvider }), ...(reviewModel && { model: reviewModel }) }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStreamContent(`Error: ${errData.error || res.statusText}`);
        stopElapsedTimer();
        setGenerating(false);
        generatingRef.current = false;
        return;
      }

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          setStreamContent(content);
        }
      }

      await fetchReviews();
      onPlanStatusChange();
      stopElapsedTimer();
      setGenerating(false);
      generatingRef.current = false;
    } catch (err) {
      setStreamContent(`Error: ${err instanceof Error ? err.message : String(err)}`);
      stopElapsedTimer();
      setGenerating(false);
      generatingRef.current = false;
    }
  };

  const handleResolve = async (itemId: string, resolved: boolean) => {
    await fetch(`/api/review-items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    await fetchReviews();
  };

  const [fixingItem, setFixingItem] = useState<string | null>(null);
  const [fixPromptItem, setFixPromptItem] = useState<ReviewItem | null>(null);
  const [fixUserNote, setFixUserNote] = useState("");
  const [reviewProvider, setReviewProvider] = useState("");
  const [reviewModel, setReviewModel] = useState("");

  const handleFix = async (item: ReviewItem, userNote?: string) => {
    if (!item.targetId || fixingItem) return;
    setFixingItem(item.id);
    setFixPromptItem(null);
    setFixUserNote("");
    startLoading(isZh ? "AI 正在修复..." : "AI fixing...");
    try {
      const schemeRes = await fetch(`/api/schemes/${item.targetId}`);
      const schemeData = schemeRes.ok ? await schemeRes.json() : null;
      const originalUpdatedAt = schemeData?.updatedAt;

      let fixMessage = `Fix the following issue:\n\n**${item.title}**\n\n${item.content}`;
      if (userNote) {
        fixMessage += `\n\nAdditional instructions from user: ${userNote}`;
      }

      await fetch("/api/schemes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemeId: item.targetId,
          message: fixMessage,
        }),
      });

      // Poll for scheme update
      if (originalUpdatedAt) {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const checkRes = await fetch(`/api/schemes/${item.targetId}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.updatedAt !== originalUpdatedAt) break;
          }
        }
      }

      // Mark as resolved
      await fetch(`/api/review-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      });
      await fetchReviews();
      onPlanStatusChange();
      stopLoading(isZh ? "修复完成" : "Fixed");
    } catch {
      stopLoading(isZh ? "修复失败" : "Fix failed");
    } finally {
      setFixingItem(null);
    }
  };

  const canReview =
    type === "scheme"
      ? planStatus === "reviewing"
      : planStatus === "executing" || planStatus === "code_review";

  const latestReview = reviews[reviews.length - 1];
  const isInProgress = latestReview?.status === "in_progress";

  // Auto-start polling if we load with an in_progress review
  useEffect(() => {
    if (isInProgress && !generating) {
      setGenerating(true);
      startPolling();
    }
  }, [isInProgress]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">
          {type === "scheme" ? <><FileStackIcon size={16} className="inline-block align-[-2px]" /> </> : <><CodeIcon size={16} className="inline-block align-[-2px]" /> </>}{type === "scheme" ? t("review.schemeReview") : t("review.codeReview")}
        </h4>
        {(canReview || isInProgress || latestReview) && (
          <div className="flex items-center gap-2">
            <ProviderModelSelect
              provider={reviewProvider}
              model={reviewModel}
              onProviderChange={setReviewProvider}
              onModelChange={setReviewModel}
              disabled={generating}
              compact
            />
            <Button onClick={handleGenerate} disabled={generating} size="sm">
              {generating
                ? <><HourglassIcon size={14} className="inline-block align-[-2px]" /> {t("common.loading")}</>
                : latestReview
                  ? <><RefreshIcon size={14} className="inline-block align-[-2px]" /> {t("review.reReview")}</>
                  : <><SearchIcon size={14} className="inline-block align-[-2px]" /> {t("review.runReview")}</>}
            </Button>
          </div>
        )}
      </div>

      {/* Progress indicator */}
      {generating && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 text-blue-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-medium text-blue-700">
                {isZh ? "AI 正在审查中..." : "AI reviewing..."}
              </span>
            </div>
            <span className="text-xs font-mono text-blue-500">
              {elapsed}s
            </span>
          </div>
          {streamContent ? (
            <div className="mt-3 max-h-40 overflow-y-auto text-xs font-mono text-blue-700 bg-blue-100/50 rounded p-2 whitespace-pre-wrap">
              {(() => {
                // Strip JSON blocks from display — show only readable text
                const cleaned = streamContent
                  .replace(/\{[\s\S]*\}/g, "")
                  .replace(/\[[\s\S]*\]/g, "")
                  .replace(/^\s*[\n]+/gm, "\n")
                  .trim();
                return (cleaned || (isZh ? "AI 正在生成审查结果..." : "AI generating review...")).slice(-500);
              })()}
            </div>
          ) : (
            <p className="text-xs text-blue-500 mt-2">
              {isZh
                ? "等待 AI 响应..."
                : "Waiting for AI response..."}
            </p>
          )}
        </div>
      )}

      {/* Review status + summary (when review exists) */}
      {!generating && latestReview && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StatusBadge
              status={latestReview.status}
              label={t(`review.status.${latestReview.status}`)}
            />
            <span className="text-xs" style={{ color: "var(--muted)" }} suppressHydrationWarning>
              {new Date(latestReview.createdAt).toLocaleString()}
            </span>
          </div>
          {latestReview.content && (
            <div className="rounded-lg border p-4" style={{ background: "var(--card)", borderColor: "var(--card-border)", color: "var(--foreground)" }}>
              <MarkdownRenderer content={latestReview.content} />
            </div>
          )}
        </div>
      )}

      {/* Diff viewer — shows whenever there are git changes, regardless of review */}
      {!generating && type === "implementation" && snapshots.length > 0 ? (
        (() => {
          // Build unique task list for filter
          const taskList: Array<{ id: string; title: string; order: number; fileCount: number }> = [];
          const seen = new Set<string>();
          for (const snap of snapshots) {
            const key = snap.scheduleItemId || "";
            if (key && !seen.has(key)) {
              seen.add(key);
              const uniqueFiles = new Set(snapshots.filter(s => s.scheduleItemId === key).map(s => s.filePath));
              taskList.push({
                id: key,
                title: snap.taskTitle || key,
                order: snap.taskOrder ?? 999,
                fileCount: uniqueFiles.size,
              });
            }
          }
          taskList.sort((a, b) => a.order - b.order);

          // Filter snapshots by selected task, deduplicate by filePath (keep latest)
          const rawFiltered = selectedTask
            ? snapshots.filter(s => s.scheduleItemId === selectedTask)
            : snapshots;
          const filteredSnapshots = Array.from(
            rawFiltered.reduce((map, s) => { map.set(s.filePath, s); return map; }, new Map<string, typeof rawFiltered[0]>()).values()
          );

          return (
        <div className="space-y-3">
          {/* View mode toggle + task filter */}
          <div className="flex items-center gap-2 flex-wrap">
            {latestReview && (
              <>
                <Button
                  size="sm"
                  variant={viewMode === "diff" ? "primary" : "secondary"}
                  onClick={() => setViewMode("diff")}
                >
                  <BarChartIcon size={14} className="inline-block align-[-2px]" /> {t("review.viewDiff")}
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "list" ? "primary" : "secondary"}
                  onClick={() => setViewMode("list")}
                >
                  <ClipboardIcon size={14} className="inline-block align-[-2px]" /> {t("review.viewFindings")}
                </Button>
              </>
            )}
            {taskList.length > 0 && (viewMode === "diff" || !latestReview) && (
              <select
                value={selectedTask || ""}
                onChange={(e) => { setSelectedTask(e.target.value || null); setSelectedFile(null); }}
                className="rounded-md border px-2 py-1.5 text-xs"
                style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
              >
                <option value="">{isZh ? "全部任务" : "All Tasks"} ({filteredSnapshots.length})</option>
                {taskList.map((task) => (
                  <option key={task.id} value={task.id}>
                    #{task.order} {task.title} ({task.fileCount})
                  </option>
                ))}
              </select>
            )}
          </div>

          {viewMode === "diff" || !latestReview ? (
            <div className="flex border rounded-lg overflow-hidden" style={{ height: "600px", borderColor: "var(--card-border)" }}>
              <FileSidebar
                files={filteredSnapshots.map((snap) => {
                  const stats = computeDiffStats(snap.contentBefore, snap.contentAfter);
                  const findingCount = latestReview
                    ? latestReview.items.filter((item) => item.filePath === snap.filePath).length
                    : 0;
                  return {
                    filePath: snap.filePath,
                    additions: stats.additions,
                    deletions: stats.deletions,
                    findingCount,
                    taskTitle: snap.taskTitle,
                    taskOrder: snap.taskOrder,
                  };
                })}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
              />
              {selectedFile ? (
                (() => {
                  const snap = filteredSnapshots.find((s) => s.filePath === selectedFile);
                  if (!snap) return null;
                  return (
                    <DiffViewer
                      filePath={snap.filePath}
                      contentBefore={snap.contentBefore}
                      contentAfter={snap.contentAfter}
                      findings={latestReview?.items || []}
                      comments={latestReview?.comments || []}
                      reviewId={latestReview?.id || ""}
                      onCommentAdded={() => latestReview && fetchComments(latestReview.id)}
                      taskTitle={snap.taskTitle}
                      taskOrder={snap.taskOrder}
                    />
                  );
                })()
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
                  {isZh ? "请选择一个文件查看差异" : "Select a file to view diff"}
                </div>
              )}
            </div>
          ) : (
            /* Findings list view — grouped by task */
            <div className="space-y-2">
              {latestReview.items.length > 0 ? (
                <>
                  <h5 className="text-sm font-medium">
                    {t("review.findings")} ({latestReview.items.length})
                  </h5>
                  {(() => {
                    // Group findings by task
                    const taskGroups = new Map<string, { title: string; order: number; items: ReviewItem[] }>();
                    for (const item of latestReview.items) {
                      const key = item.taskTitle || "";
                      if (!taskGroups.has(key)) {
                        taskGroups.set(key, {
                          title: item.taskTitle || (isZh ? "未关联任务" : "Unlinked"),
                          order: item.taskOrder ?? 999,
                          items: [],
                        });
                      }
                      taskGroups.get(key)!.items.push(item);
                    }
                    const sorted = [...taskGroups.values()].sort((a, b) => a.order - b.order);
                    const hasMultipleTasks = sorted.length > 1 || (sorted.length === 1 && sorted[0].order !== 999);

                    return sorted.map((group) => (
                      <FindingsGroup
                        key={group.title}
                        group={group}
                        hasMultipleTasks={hasMultipleTasks}
                        isZh={isZh}
                        severityStyles={severityStyles}
                        onResolve={handleResolve}
                      />
                    ));
                  })()}
                </>
              ) : (
                <p className="text-sm text-center py-4" style={{ color: "var(--muted)" }}>
                  {t("review.noReview")}
                </p>
              )}
            </div>
          )}
        </div>
          );
        })()
      ) : !generating && type === "scheme" && latestReview ? (
        /* Scheme review: flat list */
        <div className="space-y-2">
          {latestReview.items.length > 0 && (
            <>
              <h5 className="text-sm font-medium">
                {t("review.findings")} ({latestReview.items.length})
              </h5>
              {latestReview.items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 ${
                    item.resolved
                      ? "opacity-60"
                      : ""
                  }`}
                  style={item.resolved
                    ? { background: "var(--background)", borderColor: "var(--card-border)", color: "var(--foreground)" }
                    : (() => { const s = severityStyles[item.severity] || severityStyles.info; return { background: s.bg, borderColor: s.border, color: s.color }; })()
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={item.severity} label={item.severity} />
                      <span className="font-medium text-sm"><SeverityIcon severity={item.severity} /> {item.title}</span>
                    </div>
                    <div className="flex gap-1">
                      {!item.resolved && item.targetId && (
                        <button
                          onClick={() => { setFixPromptItem(item); setFixUserNote(""); }}
                          disabled={fixingItem !== null}
                          className="text-xs px-2 py-1 rounded hover:opacity-80 disabled:opacity-50"
                          style={{ background: "var(--card-border)", color: "var(--foreground)" }}
                        >
                          {fixingItem === item.id
                            ? <><HourglassIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "修复中..." : "Fixing..."}</>
                            : <><WrenchIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "AI 修复" : "AI Fix"}</>}
                        </button>
                      )}
                      <button
                        onClick={() => handleResolve(item.id, !item.resolved)}
                        className="text-xs px-2 py-1 rounded"
                        style={item.resolved
                          ? { background: "var(--card-border)", color: "var(--muted)" }
                          : { background: "rgba(255,255,255,0.5)", color: "var(--foreground)" }}
                      >
                        {item.resolved ? <><CheckIcon size={12} className="inline-block align-[-1px]" /> {t("review.resolved")}</> : t("review.resolve")}
                      </button>
                    </div>
                  </div>
                  {item.content && (
                    <div className="mt-2 text-sm">
                      <MarkdownRenderer content={item.content} />
                    </div>
                  )}
                  {fixPromptItem?.id === item.id && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={fixUserNote}
                        onChange={(e) => setFixUserNote(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleFix(item, fixUserNote)}
                        placeholder={isZh ? "补充说明（可选，直接回车修复）" : "Additional notes (optional, Enter to fix)"}
                        autoFocus
                        className="flex-1 rounded border px-2 py-1 text-xs"
                        style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                      />
                      <button
                        onClick={() => handleFix(item, fixUserNote)}
                        className="shrink-0 px-2 py-1 rounded text-xs font-medium hover:opacity-80"
                        style={{ background: "var(--foreground)", color: "var(--background)" }}
                      >
                        {isZh ? "修复" : "Fix"}
                      </button>
                      <button
                        onClick={() => setFixPromptItem(null)}
                        className="shrink-0 px-2 py-1 rounded text-xs hover:opacity-80"
                        style={{ color: "var(--muted)" }}
                      >
                        {isZh ? "取消" : "Cancel"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ) : !generating && type === "implementation" && snapshots.length === 0 ? (
        <div className="text-center py-6 space-y-3">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {isZh ? "暂无文件变更记录。已完成的任务可从 Git 历史补录。" : "No file change records. Completed tasks can be backfilled from git history."}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const res = await fetch(`/api/snapshots/backfill?planId=${planId}`, { method: "POST" });
              if (res.ok) {
                await fetchSnapshots();
              }
            }}
          >
            {isZh ? "从 Git 历史补录 Diff" : "Backfill Diff from Git"}
          </Button>
        </div>
      ) : !generating && !latestReview && snapshots.length === 0 ? (
        <p className="text-sm text-center py-4" style={{ color: "var(--muted)" }}>
          {t("review.noReview")}
        </p>
      ) : null}
    </div>
  );
}

/** Collapsible findings group by task */
function FindingsGroup({
  group,
  hasMultipleTasks,
  isZh,
  severityStyles: styles,
  onResolve,
}: {
  group: { title: string; order: number; items: ReviewItem[] };
  hasMultipleTasks: boolean;
  isZh: boolean;
  severityStyles: Record<string, { bg: string; border: string; color: string }>;
  onResolve: (id: string, resolved: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(!hasMultipleTasks || group.items.some(i => !i.resolved));
  const unresolvedCount = group.items.filter(i => !i.resolved).length;

  return (
    <div>
      {hasMultipleTasks && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 text-left text-xs font-medium mt-3 mb-1 px-1 py-1 rounded hover:opacity-80"
          style={{ color: "var(--muted)" }}
        >
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 20 20" fill="currentColor"
          >
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
          <span>#{group.order} {group.title}</span>
          <span className="font-normal">({group.items.length})</span>
          {unresolvedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#7f1d1d", color: "#fca5a5" }}>
              {unresolvedCount}
            </span>
          )}
          {unresolvedCount === 0 && (
            <span className="text-[10px] text-green-600">✓</span>
          )}
        </button>
      )}
      {expanded && group.items.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg border p-3 mb-2 ${item.resolved ? "opacity-60" : ""}`}
          style={item.resolved
            ? { background: "var(--background)", borderColor: "var(--card-border)", color: "var(--foreground)" }
            : (() => { const s = styles[item.severity] || styles.info; return { background: s.bg, borderColor: s.border, color: s.color }; })()
          }
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={item.severity} label={item.severity} />
              <span className="font-medium text-sm"><SeverityIcon severity={item.severity} /> {item.title}</span>
              {item.filePath && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--card-border)", color: "var(--muted)" }}>
                  {item.filePath.split("/").pop()}{item.lineNumber ? `:${item.lineNumber}` : ""}
                </span>
              )}
            </div>
            <button
              onClick={() => onResolve(item.id, !item.resolved)}
              className="text-xs px-2 py-1 rounded shrink-0"
              style={item.resolved
                ? { background: "var(--card-border)", color: "var(--muted)" }
                : { background: "rgba(255,255,255,0.5)", color: "var(--foreground)" }}
            >
              {item.resolved ? <><CheckIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "已解决" : "Resolved"}</> : (isZh ? "标记解决" : "Resolve")}
            </button>
          </div>
          {item.content && (
            <div className="mt-2 text-sm">
              <MarkdownRenderer content={item.content} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
