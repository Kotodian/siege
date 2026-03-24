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
        body: JSON.stringify({ planId, type, locale: isZh ? "zh" : "en", ...(reviewProvider && { provider: reviewProvider }), ...(reviewModel && { model: reviewModel }), ...(reviewTaskId && { scheduleItemId: reviewTaskId }) }),
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
  const [reviewActing, setReviewActing] = useState(false);
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
    const parts = item.targetId.split(":");
    const pureSchemeId = parts[0];
    const sectionHint = parts[1] || "";
    setFixingItem(item.id);
    setFixPromptItem(null);
    setFixUserNote("");
    startLoading(isZh ? "AI 正在修复..." : "AI fixing...");
    try {
      const schemeRes = await fetch(`/api/schemes/${pureSchemeId}`);
      const schemeData = schemeRes.ok ? await schemeRes.json() : null;
      if (!schemeData?.content) {
        stopLoading(isZh ? "找不到方案" : "Scheme not found", "error");
        setFixingItem(null);
        return;
      }

      // Extract the specific section to edit
      const schemeContent = schemeData.content as string;
      const sectionMatch = sectionHint.match(/^section-(\d+)$/);
      let sectionHeading = "";
      let sectionContent = "";

      if (sectionMatch) {
        const sectionIdx = parseInt(sectionMatch[1], 10);
        const headingRegex = /^(#{1,3})\s+(.+)/gm;
        const starts: Array<{ title: string; start: number; heading: string }> = [];
        let m;
        while ((m = headingRegex.exec(schemeContent)) !== null) {
          starts.push({ title: m[2].trim(), start: m.index, heading: m[0] });
        }
        if (sectionIdx < starts.length) {
          const sec = starts[sectionIdx];
          const nextStart = sectionIdx + 1 < starts.length ? starts[sectionIdx + 1].start : schemeContent.length;
          sectionHeading = sec.heading;
          sectionContent = schemeContent.slice(sec.start, nextStart).trim();
        }
      }

      if (sectionContent) {
        // Section-level fix: only modify the specific section
        let fixMessage = `请根据以下审查意见修复方案中「${sectionHeading.replace(/^#+\s*/, "")}」段落：\n\n**${item.title}**\n${item.content || ""}`;
        if (userNote) fixMessage += `\n\n用户补充说明：${userNote}`;
        fixMessage += `\n\n当前该段落内容：\n${sectionContent}`;

        const chatRes = await fetch("/api/schemes/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemeId: pureSchemeId,
            message: fixMessage,
            sectionOnly: true,
            ...(reviewProvider && { provider: reviewProvider }),
            ...(reviewModel && { model: reviewModel }),
          }),
        });

        if (chatRes.ok && chatRes.body) {
          const reader = chatRes.body.getReader();
          const decoder = new TextDecoder();
          let aiContent = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            aiContent += decoder.decode(value, { stream: true });
            updateContent(aiContent);
          }

          // Replace the section in the full scheme
          if (aiContent.trim()) {
            const sectionIdx = parseInt(sectionMatch![1], 10);
            const headingRegex2 = /^(#{1,3})\s+(.+)/gm;
            const starts2: Array<{ start: number; heading: string }> = [];
            let m2;
            while ((m2 = headingRegex2.exec(schemeContent)) !== null) {
              starts2.push({ start: m2.index, heading: m2[0] });
            }
            if (sectionIdx < starts2.length) {
              const secStart = starts2[sectionIdx].start;
              const secEnd = sectionIdx + 1 < starts2.length ? starts2[sectionIdx + 1].start : schemeContent.length;
              const newContent = schemeContent.slice(0, secStart) + starts2[sectionIdx].heading + "\n" + aiContent.trim() + "\n\n" + schemeContent.slice(secEnd);
              await fetch(`/api/schemes/${pureSchemeId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: newContent.trim() }),
              });
            }
          }
        }
      } else {
        // Fallback: full scheme edit
        let fixMessage = `Fix the following issue:\n\n**${item.title}**\n\n${item.content}`;
        if (userNote) fixMessage += `\n\nAdditional instructions from user: ${userNote}`;

        const chatRes2 = await fetch("/api/schemes/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemeId: pureSchemeId,
            message: fixMessage,
            ...(reviewProvider && { provider: reviewProvider }),
            ...(reviewModel && { model: reviewModel }),
          }),
        });

        if (chatRes2.ok && chatRes2.body) {
          const reader2 = chatRes2.body.getReader();
          const decoder2 = new TextDecoder();
          let content2 = "";
          while (true) {
            const { done, value } = await reader2.read();
            if (done) break;
            content2 += decoder2.decode(value, { stream: true });
            updateContent(content2);
          }
        }
      }

      // Mark as resolved
      await fetch(`/api/review-items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true, resolution: "approved" }),
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
        await handleFix(item);
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
        afterItemId: item.targetId?.split(":")[0] || undefined,
      }),
    });
    // Don't mark resolved — wait for fix task to complete
    // resolveRelatedFindings() in execute route will auto-resolve when done
    await fetchReviews();
    onPlanStatusChange();
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
        <div className="rounded-lg border p-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" style={{ color: "var(--on-surface)" }} viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-medium" style={{ color: "var(--on-surface)" }}>
                {isZh ? "AI 正在审查中..." : "AI reviewing..."}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono" style={{ color: "var(--outline)" }}>{elapsed}s</span>
              <button
                onClick={async () => {
                  // Cancel: reset in_progress reviews for this plan
                  await fetch("/api/reviews/cancel", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ planId }),
                  }).catch(() => {});
                  if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                  stopElapsedTimer();
                  setGenerating(false);
                  generatingRef.current = false;
                  setStreamContent("");
                  await fetchReviews();
                }}
                className="text-xs px-2 py-1 rounded hover:opacity-80"
                style={{ background: "var(--error-container)", color: "var(--error)" }}
              >
                {isZh ? "取消" : "Cancel"}
              </button>
            </div>
          </div>
          {streamContent ? (
            <div className="mt-3 max-h-40 overflow-y-auto text-xs rounded p-2 space-y-1" style={{ background: "var(--background)" }}>
              {streamContent.split("\n").filter(Boolean).map((line, i) => {
                // Tool call lines
                if (line.startsWith("> **")) {
                  return <div key={i} className="flex items-center gap-1" style={{ color: "var(--outline)" }}>
                    <span className="text-[10px]">▸</span>
                    <span>{line.replace(/^> \*\*/, "").replace(/\*\*.*/, "")}: {line.replace(/.*\*\*:?\s*/, "").slice(0, 80)}</span>
                  </div>;
                }
                // Thinking lines
                if (line.startsWith("[thinking]")) {
                  return <div key={i} className="italic" style={{ color: "var(--outline)" }}>{line.replace("[thinking] ", "").slice(0, 80)}...</div>;
                }
                // Status lines
                if (line.startsWith("AI ") || line.startsWith("Session:")) {
                  return <div key={i} style={{ color: "var(--outline)" }}>{line}</div>;
                }
                // JSON lines — hide
                if (line.trim().startsWith("{") || line.trim().startsWith('"') || line.trim().startsWith("[")) {
                  return null;
                }
                // Normal text
                return <div key={i} style={{ color: "var(--on-surface)" }}>{line.slice(0, 120)}</div>;
              })}
            </div>
          ) : (
            <p className="text-xs mt-2" style={{ color: "var(--outline)" }}>
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
            <span className="text-xs" style={{ color: "var(--outline)" }} suppressHydrationWarning>
              {new Date(latestReview.createdAt + "Z").toLocaleString()}
            </span>
          </div>
          {latestReview.content && (
            <div className="rounded-lg border p-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)", color: "var(--on-surface)" }}>
              <MarkdownRenderer content={latestReview.content} />
            </div>
          )}
          {/* Review action buttons */}
          {latestReview.status !== "in_progress" && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={reviewActing}
                onClick={async () => {
                  setReviewActing(true);
                  try {
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
                    stopLoading(type === "scheme"
                      ? (isZh ? "审查通过，方案已确认" : "Review approved, scheme confirmed")
                      : (isZh ? "审查通过，已进入测试" : "Review approved, entering testing"));
                  } catch { /* ignore */ }
                  setReviewActing(false);
                }}
              >
                {reviewActing
                  ? (isZh ? "处理中..." : "Processing...")
                  : <><CheckIcon size={14} className="inline-block align-[-2px]" /> {type === "scheme"
                      ? (isZh ? "通过审查" : "Approve Review")
                      : (isZh ? "通过并进入测试" : "Accept & Test")}</>}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={reviewActing}
                onClick={async () => {
                  setReviewActing(true);
                  try {
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
                    stopLoading(type === "scheme"
                      ? (isZh ? "审查已驳回" : "Review rejected")
                      : (isZh ? "已返回排期修复" : "Returned to rework"), "warning");
                  } catch { /* ignore */ }
                  setReviewActing(false);
                }}
              >
                {reviewActing
                  ? (isZh ? "处理中..." : "Processing...")
                  : <><XIcon size={14} className="inline-block align-[-2px]" /> {type === "scheme"
                      ? (isZh ? "驳回审查" : "Reject Review")
                      : (isZh ? "返回排期修复" : "Rework")}</>}
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
            <div className="flex border rounded-lg overflow-hidden" style={{ height: "600px", borderColor: "var(--outline-variant)" }}>
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
                <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--outline)" }}>
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
                    <h5 className="text-sm font-medium" style={{ color: "var(--on-surface)" }}>
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
                <p className="text-sm text-center py-4" style={{ color: "var(--outline)" }}>
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
                    ? { background: "var(--background)", borderColor: "var(--outline-variant)", color: "var(--on-surface)" }
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
                          style={{ background: "var(--outline-variant)", color: "var(--on-surface)" }}
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
                          ? { background: "var(--outline-variant)", color: "var(--outline)" }
                          : { background: "var(--surface-container)", color: "var(--on-surface)" }}
                      >
                        {item.resolved ? <><CheckIcon size={12} className="inline-block align-[-1px]" /> {t("review.resolved")}</> : t("review.resolve")}
                      </button>
                    </div>
                  </div>
                  {item.content && (
                    <div className="mt-2 text-sm" style={{ color: "var(--on-surface)" }}>
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
                        style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
                      />
                      <button
                        onClick={() => handleFix(item, fixUserNote)}
                        className="shrink-0 px-2 py-1 rounded text-xs font-medium hover:opacity-80"
                        style={{ background: "var(--on-surface)", color: "var(--background)" }}
                      >
                        {isZh ? "修复" : "Fix"}
                      </button>
                      <button
                        onClick={() => setFixPromptItem(null)}
                        className="shrink-0 px-2 py-1 rounded text-xs hover:opacity-80"
                        style={{ color: "var(--outline)" }}
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
          <p className="text-sm" style={{ color: "var(--outline)" }}>
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
        <p className="text-sm text-center py-4" style={{ color: "var(--outline)" }}>
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
            <CheckCircleIcon size={40} className="mx-auto text-[var(--success)]" />
            {resolvedTaskInfo && (
              <p className="text-xs mt-2 font-mono" style={{ color: "var(--outline)" }}>
                {resolvedTaskInfo.title}
              </p>
            )}
            <p className="text-sm mt-3" style={{ color: "var(--on-surface)" }}>
              {resolvedTaskInfo
                ? (isZh ? "该任务的所有审查意见已处理完毕，接下来：" : "All findings for this task are resolved. Next:")
                : (isZh ? "所有审查意见已处理完毕，接下来：" : "All findings resolved. Next:")}
            </p>
          </div>
          <div className="space-y-2">
            {type === "scheme" ? (
              <>
                <Button
                  className="w-full"
                  onClick={async () => {
                    setAllResolvedPrompt(false);
                    // Confirm scheme → plan enters "confirmed" status → can generate schedule
                    await fetch(`/api/plans/${planId}/confirm`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "confirm" }),
                    });
                    onPlanStatusChange();
                  }}
                >
                  <CheckIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "确认方案，生成排期" : "Confirm & Generate Schedule"}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={async () => {
                    setAllResolvedPrompt(false);
                    handleGenerate();
                  }}
                >
                  <RefreshIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "重新审查" : "Re-review"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="w-full"
                  onClick={async () => {
                    setAllResolvedPrompt(false);
                    if (resolvedTaskInfo) {
                      await fetch("/api/test-suites/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          planId,
                          locale: isZh ? "zh" : "en",
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
                    setReviewTaskId(resolvedTaskInfo?.id || "");
                    handleGenerate();
                  }}
                >
                  <RefreshIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "重新审查该任务" : "Re-review This Task"}
                </Button>
              </>
            )}
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
          style={{ color: isFix ? "var(--secondary)" : "var(--outline)", paddingLeft: isFix ? "1.5rem" : "0.25rem" }}
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
            <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(124,58,237,0.2)", color: "var(--secondary)" }}>fix</span>
          )}
          <span className="font-normal">({group.items.length})</span>
          {unresolvedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#7f1d1d", color: "#fca5a5" }}>
              {unresolvedCount}
            </span>
          )}
          {unresolvedCount === 0 && (
            <span className="text-[10px] text-[var(--success)]">✓</span>
          )}
        </button>
      )}
      {expanded && group.items.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg border p-3 mb-2 ${item.resolved ? "opacity-60" : ""}`}
          style={item.resolved
            ? { background: "var(--background)", borderColor: "var(--outline-variant)", color: "var(--on-surface)" }
            : (() => { const s = styles[item.severity] || styles.info; return { background: s.bg, borderColor: s.border, color: s.color }; })()
          }
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={item.severity} label={item.severity} />
              <span className="font-medium text-sm"><SeverityIcon severity={item.severity} /> {item.title}</span>
              {item.filePath && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--outline-variant)", color: "var(--outline)" }}>
                  {item.filePath.split("/").pop()}{item.lineNumber ? `:${item.lineNumber}` : ""}
                </span>
              )}
            </div>
            {item.resolved ? (
              <span className="text-xs px-2 py-1 rounded shrink-0" style={{ background: "var(--outline-variant)", color: "var(--outline)" }}>
                <CheckIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "已解决" : "Resolved"}
              </span>
            ) : acceptedIds.has(item.id) ? (
              <span className="text-xs px-2 py-1 rounded shrink-0" style={{ background: "rgba(124,58,237,0.15)", color: "var(--secondary)" }}>
                {isZh ? "已加入排期" : "Scheduled"}
              </span>
            ) : (
              <button
                onClick={() => onResolve(item.id, true)}
                className="text-xs px-2 py-1 rounded hover:opacity-80 shrink-0"
                style={{ background: "var(--error-container)", color: "#fca5a5" }}
              >
                {isZh ? "忽略" : "Dismiss"}
              </button>
            )}
          </div>
          {item.content && (
            <div className="mt-2 text-sm" style={{ color: "var(--on-surface)" }}>
              <MarkdownRenderer content={item.content} />
            </div>
          )}
          {!item.resolved && !acceptedIds.has(item.id) && (() => {
            const opts: string[] = item.options ? (() => { try { return JSON.parse(item.options); } catch { return []; } })() : [];
            return opts.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-[10px] self-center" style={{ color: "var(--outline)" }}>
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
        style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
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
          style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}
        >
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs hover:opacity-80"
            style={{
              background: !selectedTask ? "var(--background)" : undefined,
              color: "var(--on-surface)",
              borderBottom: "1px solid var(--outline-variant)",
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
                  color: isFix ? "var(--secondary)" : "var(--on-surface)",
                  borderBottom: "1px solid var(--outline-variant)",
                }}
              >
                {isFix && <span>↳</span>}
                <span className="flex-1 truncate">
                  #{task.order} {isFix ? task.title.replace("[fix] ", "") : task.title}
                </span>
                {isFix && (
                  <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: "rgba(124,58,237,0.2)" }}>fix</span>
                )}
                {task.fileCount > 0 && <span className="shrink-0" style={{ color: "var(--outline)" }}>({task.fileCount})</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
