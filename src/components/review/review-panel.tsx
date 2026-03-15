"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";

interface ReviewItem {
  id: string;
  reviewId: string;
  targetType: string;
  targetId: string;
  title: string;
  content: string | null;
  severity: string;
  resolved: boolean;
}

interface Review {
  id: string;
  planId: string;
  type: string;
  status: string;
  content: string | null;
  createdAt: string;
  items: ReviewItem[];
}

interface ReviewPanelProps {
  planId: string;
  type: "scheme" | "implementation";
  planStatus: string;
  onPlanStatusChange: () => void;
}

const severityColors: Record<string, string> = {
  critical: "bg-red-50 border-red-200 text-red-800",
  warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};

export function ReviewPanel({
  planId,
  type,
  planStatus,
  onPlanStatusChange,
}: ReviewPanelProps) {
  const t = useTranslations();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [generating, setGenerating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchReviews = async () => {
    const res = await fetch(`/api/reviews?planId=${planId}&type=${type}`);
    const data = await res.json();
    setReviews(data);
    return data as Review[];
  };

  useEffect(() => {
    fetchReviews();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [planId, type]);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const data = await fetchReviews();
      const latest = data[data.length - 1];
      if (latest && latest.status !== "in_progress") {
        // Done!
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setGenerating(false);
        onPlanStatusChange();
      }
    }, 3000);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await fetch("/api/reviews/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, type, provider: "anthropic" }),
      });
      // API returns 202 immediately, start polling
      startPolling();
    } catch {
      setGenerating(false);
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

  const handleFix = async (item: ReviewItem) => {
    if (!item.targetId || fixingItem) return;
    setFixingItem(item.id);
    try {
      const res = await fetch("/api/schemes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemeId: item.targetId,
          message: `Fix the following issue:\n\n**${item.title}**\n\n${item.content}`,
        }),
      });
      if (res.ok) {
        // Mark as resolved
        await fetch(`/api/review-items/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolved: true }),
        });
        await fetchReviews();
        onPlanStatusChange();
      }
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

  const isZh = t("common.back") === "返回";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">
          {type === "scheme" ? t("review.schemeReview") : t("review.codeReview")}
        </h4>
        {(canReview || isInProgress) && (
          <Button onClick={handleGenerate} disabled={generating} size="sm">
            {generating
              ? t("common.loading")
              : latestReview
                ? t("review.reReview")
                : t("review.runReview")}
          </Button>
        )}
      </div>

      {/* Progress indicator */}
      {generating && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-blue-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium text-blue-700">
              {isZh ? "AI 正在审查方案，请稍候..." : "AI is reviewing, please wait..."}
            </span>
          </div>
          <p className="text-xs text-blue-500 mt-2">
            {isZh
              ? "审查需要 1-2 分钟，完成后自动显示结果。"
              : "Review takes 1-2 minutes. Results will appear automatically."}
          </p>
        </div>
      )}

      {!generating && !latestReview ? (
        <p className="text-gray-500 text-sm text-center py-4">
          {t("review.noReview")}
        </p>
      ) : !generating && latestReview ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StatusBadge
              status={latestReview.status}
              label={t(`review.status.${latestReview.status}`)}
            />
            <span className="text-xs text-gray-400">
              {new Date(latestReview.createdAt).toLocaleString()}
            </span>
          </div>

          {latestReview.content && (
            <div className="rounded-lg border bg-white p-4">
              <MarkdownRenderer content={latestReview.content} />
            </div>
          )}

          {latestReview.items.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">
                {t("review.findings")} ({latestReview.items.length})
              </h5>
              {latestReview.items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 ${
                    item.resolved
                      ? "bg-gray-50 border-gray-200 opacity-60"
                      : severityColors[item.severity] || severityColors.info
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={item.severity} label={item.severity} />
                      <span className="font-medium text-sm">{item.title}</span>
                    </div>
                    <div className="flex gap-1">
                      {!item.resolved && item.targetId && (
                        <button
                          onClick={() => handleFix(item)}
                          disabled={fixingItem !== null}
                          className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                        >
                          {fixingItem === item.id
                            ? isZh ? "修复中..." : "Fixing..."
                            : isZh ? "AI 修复" : "AI Fix"}
                        </button>
                      )}
                      <button
                        onClick={() => handleResolve(item.id, !item.resolved)}
                        className={`text-xs px-2 py-1 rounded ${
                          item.resolved
                            ? "bg-gray-200 text-gray-600"
                            : "bg-white/50 text-gray-700 hover:bg-white"
                        }`}
                      >
                        {item.resolved ? t("review.resolved") : t("review.resolve")}
                      </button>
                    </div>
                  </div>
                  {item.content && (
                    <div className="mt-2 text-sm">
                      <MarkdownRenderer content={item.content} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
