"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface InlineCommentProps {
  reviewId: string;
  filePath: string;
  lineNumber: number;
  onClose: () => void;
  onSubmitted: () => void;
}

export function InlineComment({ reviewId, filePath, lineNumber, onClose, onSubmitted }: InlineCommentProps) {
  const t = useTranslations();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/review-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, filePath, lineNumber, content }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.aiResponse) {
          setAiResponse(data.aiResponse);
        }
        onSubmitted();
        setContent("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-12 my-1 p-3 rounded border text-xs" style={{ borderColor: "var(--outline-variant)", background: "var(--surface-container-high)" }}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("review.commentPlaceholder")}
        className="w-full p-2 border rounded text-xs font-sans resize-y min-h-[60px]"
        rows={3}
      />
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" onClick={handleSubmit} disabled={submitting || !content.trim()}>
          {submitting ? t("common.loading") : t("review.submitComment")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
      {aiResponse && (
        <div className="mt-2 p-2 rounded border" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          <span className="font-semibold text-[var(--primary)]">{t("review.aiSuggestion")}:</span>
          <p className="mt-1 whitespace-pre-wrap" style={{ color: "var(--on-surface)" }}>{aiResponse}</p>
        </div>
      )}
    </div>
  );
}
