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
import { severityIcons, FileStackIcon, CodeIcon, SearchIcon, RefreshIcon, HourglassIcon, BarChartIcon, ClipboardIcon, WrenchIcon, CheckIcon, XIcon, type IconProps } from "@/components/ui/icons";
import { ProviderModelSelect } from "@/components/ui/provider-model-select";
import { Dialog } from "@/components/ui/dialog";
import { CheckCircleIcon, FlaskIcon } from "@/components/ui/icons";

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
  options: string | null;
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
        body: JSON.stringify({ planId, type, ...(reviewProvider && { provider: reviewProvider }), ...(reviewModel && { model: reviewModel }), ...(reviewTaskId && { scheduleItemId: reviewTaskId }) }),
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
    const fresh = await fetchReviews();
    if (resolved) checkAllResolved(fresh, itemId);
  };

  const [fixingItem, setFixingItem] = useState<string | null>(null);
  const [fixingAll, setFixingAll] = useState(false);
  const [fixPromptItem, setFixPromptItem] = useState<ReviewItem | null>(null);
  const [allResolvedPrompt, setAllResolvedPrompt] = useState(false);
  const [resolvedTaskInfo, setResolvedTaskInfo] = useState<{ id: string; title: string } | null>(null);

  /** Check if all findings for the resolved item's task are done */
  const checkAllResolved = (freshReviews?: Review[], resolvedItemId?: string) => {
    const rev = freshReviews ? freshReviews[freshReviews.length - 1] : latestReview;
    if (!rev) return;
    // Find which task this item belongs to
    const resolvedItem = rev.items.find(i => i.id === resolvedItemId);
    const taskId = resolvedItem?.targetId;
    const taskTitle = resolvedItem?.taskTitle;
    if (!taskId) {
      // No task association — check all items
      if (rev.items.length > 0 && rev.items.every((i: ReviewItem) => i.resolved)) {
        setResolvedTaskInfo(null);
        setAllResolvedPrompt(true);
      }
      return;
    }
    // Check only findings for this task
    const taskItems = rev.items.filter(i => i.targetId === taskId);
    if (taskItems.length > 0 && taskItems.every(i => i.resolved)) {
      setResolvedTaskInfo({ id: taskId, title: taskTitle || "" });
      setAllResolvedPrompt(true);
    }
  };
  const [fixUserNote, setFixUserNote] = useState("");
  const [reviewProvider, setReviewProvider] = useState("");
  const [reviewModel, setReviewModel] = useState("");
  const [reviewTaskId, setReviewTaskId] = useState<string>("");

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

  const handleFixAll = async () => {
    if (!latestReview || fixingAll) return;
    const unresolvedItems = latestReview.items.filter(i => !i.resolved && i.targetId);
    if (unresolvedItems.length === 0) return;

    setFixingAll(true);
    startLoading(isZh
      ? `一键修复 ${unresolvedItems.length} 个问题...`
      : `Fixing all ${unresolvedItems.length} issues...`);

    let fixed = 0;
    let failed = 0;
    for (const item of unresolvedItems) {
      updateContent(isZh
        ? `正在修复 ${fixed + failed + 1}/${unresolvedItems.length}: ${item.title}...`
        : `Fixing ${fixed + failed + 1}/${unresolvedItems.length}: ${item.title}...`);
      try {
        const fixMessage = `Fix the following issue:\n\n**${item.title}**\n\n${item.content}`;
        await fetch("/api/schemes/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schemeId: item.targetId, message: fixMessage }),
        });
        await fetch(`/api/review-items/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolved: true }),
        });
        fixed++;
      } catch {
        failed++;
      }
    }

    await fetchReviews();
    onPlanStatusChange();
    setFixingAll(false);
    stopLoading(isZh
      ? `修复完成: ${fixed} 成功${failed > 0 ? `, ${failed} 失败` : ""}`
      : `Done: ${fixed} fixed${failed > 0 ? `, ${failed} failed` : ""}`);
  };

  /** Accept a finding: create a fix sub-task after the parent task and mark resolved */
  const handleAcceptFinding = async (item: ReviewItem, chosenOption?: string) => {
    const desc = [
      item.content || "",
      chosenOption ? `\n**Solution:** ${chosenOption}` : "",
      item.filePath ? `\nFile: ${item.filePath}${item.lineNumber ? `:${item.lineNumber}` : ""}` : "",
    ].filter(Boolean).join("\n");

    await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        title: `[fix] ${item.title}`,
        description: desc,
        afterItemId: item.targetId || undefined,
      }),
    });
    // Mark finding as resolved
    await fetch(`/api/review-items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    const fresh = await fetchReviews();
    onPlanStatusChange();
    checkAllResolved(fresh, item.id);
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
          <div className="flex items-center gap-2 flex-wrap">
            <ProviderModelSelect
              provider={reviewProvider}
              model={reviewModel}
              onProviderChange={setReviewProvider}
              onModelChange={setReviewModel}
              disabled={generating}
              compact
            />
            {type === "implementation" && snapshots.length > 0 && (() => {
              const taskSet = new Map<string, { title: string; order: number }>();
              for (const s of snapshots) {
                if (s.scheduleItemId && !taskSet.has(s.scheduleItemId)) {
                  taskSet.set(s.scheduleItemId, { title: s.taskTitle || "", order: s.taskOrder ?? 999 });
                }
              }
              const taskOptions = [...taskSet.entries()].sort((a, b) => a[1].order - b[1].order).map(([id, t]) => ({ id, title: t.title, order: t.order, fileCount: 0 }));
              return taskOptions.length > 0 ? (
                <TaskFilterDropdown
                  tasks={taskOptions}
                  selectedTask={reviewTaskId || null}
                  onSelect={(id) => setReviewTaskId(id || "")}
                  totalFiles={0}
                  isZh={isZh}
                />
              ) : null;
            })()}
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
        <div className="rounded-lg border p-4" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" style={{ color: "var(--foreground)" }} viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                {isZh ? "AI 正在审查中..." : "AI reviewing..."}
              </span>
            </div>
            <span className="text-xs font-mono" style={{ color: "var(--muted)" }}>
              {elapsed}s
            </span>
          </div>
          {streamContent ? (
            <div className="mt-3 max-h-40 overflow-y-auto text-xs rounded p-2 whitespace-pre-wrap" style={{ background: "var(--background)", color: "var(--foreground)" }}>
              {(() => {
                // Extract "summary" value from partial JSON, or show non-JSON text
                const summaryMatch = streamContent.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                if (summaryMatch) {
                  return summaryMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').slice(-500);
                }
                // If no JSON at all, show the text
                if (!streamContent.includes('"items"') && !streamContent.includes('"summary"')) {
                  return streamContent.slice(-500);
                }
                return isZh ? `AI 正在生成审查结果... (${Math.round(streamContent.length / 1024)}KB)` : `AI generating review... (${Math.round(streamContent.length / 1024)}KB)`;
              })()}
            </div>
          ) : (
            <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
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
          {/* Review action buttons */}
          {latestReview.status !== "in_progress" && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={async (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  btn.textContent = isZh ? "处理中..." : "Processing...";
                  if (type === "scheme") {
                    await fetch(`/api/plans/${planId}/confirm`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "confirm" }),
                    });
                  } else {
                    await fetch(`/api/plans/${planId}/review-action`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "accept" }),
                    });
                  }
                  await fetchReviews();
                  onPlanStatusChange();
                }}
              >
                <CheckIcon size={14} className="inline-block align-[-2px]" /> {type === "scheme"
                  ? (isZh ? "通过方案" : "Approve")
                  : (isZh ? "通过并进入测试" : "Accept & Test")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  btn.textContent = isZh ? "处理中..." : "Processing...";
                  if (type === "scheme") {
                    await fetch(`/api/plans/${planId}/confirm`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "revoke" }),
                    });
                  } else {
                    await fetch(`/api/plans/${planId}/review-action`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "rework" }),
                    });
                  }
                  onPlanStatusChange();
                }}
              >
                <XIcon size={14} className="inline-block align-[-2px]" /> {type === "scheme"
                  ? (isZh ? "驳回方案" : "Reject")
                  : (isZh ? "返回排期修复" : "Rework")}
              </Button>
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
              <TaskFilterDropdown
                tasks={taskList}
                selectedTask={selectedTask}
                onSelect={(id) => { setSelectedTask(id); setSelectedFile(null); }}
                totalFiles={filteredSnapshots.length}
                isZh={isZh}
              />
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
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                      {t("review.findings")} ({latestReview.items.length})
                    </h5>
                    {latestReview.items.some(i => !i.resolved && i.targetId) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleFixAll}
                        disabled={fixingAll || fixingItem !== null}
                      >
                        <WrenchIcon size={14} className="inline-block align-[-2px]" /> {fixingAll
                          ? (isZh ? "修复中..." : "Fixing...")
                          : (isZh ? `一键修复 (${latestReview.items.filter(i => !i.resolved && i.targetId).length})` : `Fix All (${latestReview.items.filter(i => !i.resolved && i.targetId).length})`)}
                      </Button>
                    )}
                  </div>
                  {(() => {
                    // Group findings by task, mark fix sub-tasks
                    const taskGroups = new Map<string, { title: string; order: number; isFix: boolean; items: ReviewItem[] }>();
                    for (const item of latestReview.items) {
                      const key = item.taskTitle || "";
                      if (!taskGroups.has(key)) {
                        taskGroups.set(key, {
                          title: item.taskTitle || (isZh ? "未关联任务" : "Unlinked"),
                          order: item.taskOrder ?? 999,
                          isFix: (item.taskTitle || "").startsWith("[fix]"),
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
                        isFix={group.isFix}
                        isZh={isZh}
                        severityStyles={severityStyles}
                        onAccept={handleAcceptFinding}
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
                    <div className="mt-2 text-sm" style={{ color: "var(--foreground)" }}>
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

      {/* Task findings all resolved prompt */}
      <Dialog
        open={allResolvedPrompt}
        onClose={() => setAllResolvedPrompt(false)}
        title={resolvedTaskInfo
          ? (isZh ? `任务审查完成` : `Task Review Complete`)
          : (isZh ? "所有审查意见已处理" : "All Findings Resolved")}
      >
        <div className="space-y-4">
          <div className="text-center py-2">
            <CheckCircleIcon size={40} className="mx-auto text-green-500" />
            {resolvedTaskInfo && (
              <p className="text-xs mt-2 font-mono" style={{ color: "var(--muted)" }}>
                {resolvedTaskInfo.title}
              </p>
            )}
            <p className="text-sm mt-3" style={{ color: "var(--foreground)" }}>
              {resolvedTaskInfo
                ? (isZh ? "该任务的所有审查意见已处理完毕，接下来：" : "All findings for this task are resolved. Next:")
                : (isZh ? "所有审查意见已处理完毕，接下来：" : "All findings resolved. Next:")}
            </p>
          </div>
          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={async () => {
                setAllResolvedPrompt(false);
                // Generate tests for this specific task
                if (resolvedTaskInfo) {
                  await fetch("/api/test-suites/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      planId,
                      scheduleItemIds: [resolvedTaskInfo.id],
                    }),
                  });
                }
                onPlanStatusChange();
              }}
            >
              <FlaskIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "为该任务生成测试" : "Generate Tests for This Task"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                setAllResolvedPrompt(false);
                // Re-review this specific task
                setReviewTaskId(resolvedTaskInfo?.id || "");
                handleGenerate();
              }}
            >
              <RefreshIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "重新审查该任务" : "Re-review This Task"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setAllResolvedPrompt(false)}
            >
              {isZh ? "暂不操作" : "Do Nothing"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Collapsible findings group by task */
function FindingsGroup({
  group,
  hasMultipleTasks,
  isFix,
  isZh,
  severityStyles: styles,
  onResolve,
  onAccept,
}: {
  group: { title: string; order: number; items: ReviewItem[] };
  hasMultipleTasks: boolean;
  isFix: boolean;
  isZh: boolean;
  severityStyles: Record<string, { bg: string; border: string; color: string }>;
  onResolve: (id: string, resolved: boolean) => void;
  onAccept: (item: ReviewItem, chosenOption?: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(!hasMultipleTasks || group.items.some(i => !i.resolved));
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const unresolvedCount = group.items.filter(i => !i.resolved).length;

  return (
    <div>
      {hasMultipleTasks && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 text-left text-xs font-medium mt-3 mb-1 py-1 rounded hover:opacity-80"
          style={{ color: isFix ? "#c4b5fd" : "var(--muted)", paddingLeft: isFix ? "1.5rem" : "0.25rem" }}
        >
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 20 20" fill="currentColor"
          >
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
          {isFix && <span>↳</span>}
          <span>#{group.order} {isFix ? group.title.replace("[fix] ", "") : group.title}</span>
          {isFix && (
            <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(124,58,237,0.2)", color: "#c4b5fd" }}>fix</span>
          )}
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
            {item.resolved ? (
              <span className="text-xs px-2 py-1 rounded shrink-0" style={{
                background: acceptedIds.has(item.id) ? "rgba(124,58,237,0.15)" : "var(--card-border)",
                color: acceptedIds.has(item.id) ? "#c4b5fd" : "var(--muted)",
              }}>
                <CheckIcon size={12} className="inline-block align-[-1px]" /> {acceptedIds.has(item.id)
                  ? (isZh ? "已加入排期" : "Added to Schedule")
                  : (isZh ? "已忽略" : "Dismissed")}
              </span>
            ) : (
              <button
                onClick={() => onResolve(item.id, true)}
                className="text-xs px-2 py-1 rounded hover:opacity-80 shrink-0"
                style={{ background: "rgba(239,68,68,0.15)", color: "#fca5a5" }}
              >
                {isZh ? "忽略" : "Dismiss"}
              </button>
            )}
          </div>
          {item.content && (
            <div className="mt-2 text-sm" style={{ color: "var(--foreground)" }}>
              <MarkdownRenderer content={item.content} />
            </div>
          )}
          {!item.resolved && (() => {
            const opts: string[] = item.options ? (() => { try { return JSON.parse(item.options); } catch { return []; } })() : [];
            return opts.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-[10px] self-center" style={{ color: "var(--muted)" }}>
                  {isZh ? "解决方案:" : "Solutions:"}
                </span>
                {opts.map((opt: string, i: number) => (
                  <button
                    key={i}
                    onClick={async (e) => {
                      const btn = e.currentTarget;
                      btn.disabled = true;
                      btn.textContent = "...";
                      await onAccept(item, opt);
                      setAcceptedIds(prev => new Set(prev).add(item.id));
                    }}
                    className="text-[11px] px-2 py-1 rounded border hover:opacity-80"
                    style={{ borderColor: "rgba(34,197,94,0.3)", color: "#86efac", background: "rgba(34,197,94,0.1)" }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : !item.resolved ? (
              <div className="mt-2">
                <button
                  onClick={async (e) => {
                    const btn = e.currentTarget;
                    btn.disabled = true;
                    btn.textContent = "...";
                    await onAccept(item);
                    setAcceptedIds(prev => new Set(prev).add(item.id));
                  }}
                  className="text-[11px] px-2 py-1 rounded hover:opacity-80"
                  style={{ background: "rgba(34,197,94,0.2)", color: "#86efac" }}
                >
                  {isZh ? "采纳为子任务" : "Create Fix Task"}
                </button>
              </div>
            ) : null;
          })()}
        </div>
      ))}
    </div>
  );
}

/** Custom dropdown for task filter with parent/child visual */
function TaskFilterDropdown({
  tasks,
  selectedTask,
  onSelect,
  totalFiles,
  isZh,
}: {
  tasks: Array<{ id: string; title: string; order: number; fileCount: number }>;
  selectedTask: string | null;
  onSelect: (id: string | null) => void;
  totalFiles: number;
  isZh: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = tasks.find(t => t.id === selectedTask);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md border px-3 py-1.5 text-xs flex items-center gap-2 min-w-[180px]"
        style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
      >
        <span className="flex-1 text-left truncate">
          {selected
            ? `#${selected.order} ${selected.title.startsWith("[fix]") ? selected.title.replace("[fix] ", "↳ ") : selected.title}`
            : (isZh ? `全部任务${totalFiles ? ` (${totalFiles})` : ""}` : `All Tasks${totalFiles ? ` (${totalFiles})` : ""}`)}
        </span>
        <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-72 rounded-lg border shadow-lg z-20 max-h-64 overflow-y-auto"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}
        >
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs hover:opacity-80"
            style={{
              background: !selectedTask ? "var(--background)" : undefined,
              color: "var(--foreground)",
              borderBottom: "1px solid var(--card-border)",
            }}
          >
            {isZh ? "全部任务" : "All Tasks"}{totalFiles ? ` (${totalFiles})` : ""}
          </button>
          {tasks.map((task) => {
            const isFix = task.title.startsWith("[fix]");
            const isActive = selectedTask === task.id;
            return (
              <button
                key={task.id}
                onClick={() => { onSelect(task.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:opacity-80 flex items-center gap-1.5"
                style={{
                  background: isActive ? "var(--background)" : undefined,
                  paddingLeft: isFix ? "1.75rem" : "0.75rem",
                  color: isFix ? "#c4b5fd" : "var(--foreground)",
                  borderBottom: "1px solid var(--card-border)",
                }}
              >
                {isFix && <span>↳</span>}
                <span className="flex-1 truncate">
                  #{task.order} {isFix ? task.title.replace("[fix] ", "") : task.title}
                </span>
                {isFix && (
                  <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: "rgba(124,58,237,0.2)" }}>fix</span>
                )}
                {task.fileCount > 0 && <span className="shrink-0" style={{ color: "var(--muted)" }}>({task.fileCount})</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
