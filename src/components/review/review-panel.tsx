"use client";

import { useState, useEffect } from "react";
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

  const fetchReviews = async () => {
    const res = await fetch(
      `/api/reviews?planId=${planId}&type=${type}`
    );
    const data = await res.json();
    setReviews(data);
  };

  useEffect(() => {
    fetchReviews();
  }, [planId, type]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await fetch("/api/reviews/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, type, provider: "anthropic" }),
      });
      await fetchReviews();
      onPlanStatusChange();
    } finally {
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

  const canReview =
    type === "scheme"
      ? planStatus === "reviewing"
      : planStatus === "executing" || planStatus === "code_review";

  const latestReview = reviews[reviews.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">
          {type === "scheme" ? "Scheme Review" : "Code Review"}
        </h4>
        {canReview && (
          <Button onClick={handleGenerate} disabled={generating} size="sm">
            {generating
              ? t("common.loading")
              : latestReview
                ? "Re-review"
                : "Run Review"}
          </Button>
        )}
      </div>

      {!latestReview ? (
        <p className="text-gray-500 text-sm text-center py-4">
          No review yet
        </p>
      ) : (
        <div className="space-y-3">
          {/* Review status */}
          <div className="flex items-center gap-2">
            <StatusBadge
              status={latestReview.status}
              label={latestReview.status.replace("_", " ")}
            />
            <span className="text-xs text-gray-400">
              {new Date(latestReview.createdAt).toLocaleString()}
            </span>
          </div>

          {/* Summary */}
          {latestReview.content && (
            <div className="rounded-lg border bg-white p-4">
              <MarkdownRenderer content={latestReview.content} />
            </div>
          )}

          {/* Findings */}
          {latestReview.items.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">
                Findings ({latestReview.items.length})
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
                      <StatusBadge
                        status={item.severity}
                        label={item.severity}
                      />
                      <span className="font-medium text-sm">
                        {item.title}
                      </span>
                    </div>
                    <button
                      onClick={() =>
                        handleResolve(item.id, !item.resolved)
                      }
                      className={`text-xs px-2 py-1 rounded ${
                        item.resolved
                          ? "bg-gray-200 text-gray-600"
                          : "bg-white/50 text-gray-700 hover:bg-white"
                      }`}
                    >
                      {item.resolved ? "Resolved" : "Resolve"}
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
          )}
        </div>
      )}
    </div>
  );
}
