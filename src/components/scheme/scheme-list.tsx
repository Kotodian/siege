"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SchemeCard } from "./scheme-card";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { CreateSchemeDialog } from "./create-scheme-dialog";
import { GenerateSchemeDialog } from "./generate-scheme-dialog";
import { SchemeQuestionDialog } from "./scheme-question-dialog";
import { ReviewPanel } from "@/components/review/review-panel";
import { useGlobalLoading } from "@/components/ui/global-loading";
import { sseParseEvent } from "@/lib/ai/sse";

interface Scheme {
  id: string;
  planId: string;
  title: string;
  content: string | null;
  structuredContent: string | null;
  sourceType: string;
  updatedAt: string;
  createdAt: string;
}

interface SchemeListProps {
  planId: string;
  planStatus: string;
  onPlanStatusChange: () => void;
}

export function SchemeList({
  planId,
  planStatus,
  onPlanStatusChange,
}: SchemeListProps) {
  const t = useTranslations();
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [reviewFindings, setReviewFindings] = useState<Array<{
    id: string; targetId: string; title: string; content: string | null;
    severity: string; resolved: boolean; resolution?: string | null;
  }>>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  const readonly = [
    "confirmed",
    "scheduled",
    "executing",
    "testing",
    "completed",
  ].includes(planStatus);

  const fetchSchemes = async () => {
    const res = await fetch(`/api/schemes?planId=${planId}`);
    const data = await res.json();
    setSchemes(data);
  };

  const fetchReviewFindings = async () => {
    const res = await fetch(`/api/reviews?planId=${planId}&type=scheme`);
    if (!res.ok) return;
    const reviews = await res.json();
    const latest = reviews[reviews.length - 1];
    if (latest?.items) {
      setReviewFindings(latest.items);
    }
  };

  useEffect(() => {
    fetchSchemes();
    fetchReviewFindings();
  }, [planId]);

  const handleCreate = async (data: { title: string; content: string }) => {
    await fetch("/api/schemes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, planId, sourceType: "manual" }),
    });
    fetchSchemes();
    onPlanStatusChange();
  };

  const handleUpdate = async (
    id: string,
    data: { title: string; content: string }
  ) => {
    await fetch(`/api/schemes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    fetchSchemes();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/schemes/${id}`, { method: "DELETE" });
    fetchSchemes();
  };

  const handleConfirm = async () => {
    await fetch(`/api/plans/${planId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm" }),
    });
    onPlanStatusChange();
  };

  const handleRevoke = async () => {
    await fetch(`/api/plans/${planId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke" }),
    });
    onPlanStatusChange();
  };

  const isZh = t("common.back") === "返回";

  // Interactive mode state
  const [currentQuestion, setCurrentQuestion] = useState<{
    id: string; text: string; options: string[]; default?: string;
  } | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [questionNumber, setQuestionNumber] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);

  const handleAnswer = useCallback(async (questionId: string, answer: string) => {
    if (!generationId) return;
    setCurrentQuestion(null);
    const res = await fetch("/api/schemes/generate/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generationId, questionId, answer }),
    });
    if (!res.ok) {
      // Session lost — abort interactive, will fallback to standard
      console.warn("[scheme] answer failed, session likely expired");
    }
  }, [generationId]);

  const handleGenerate = async (provider: string, skills: string[], model?: string, interactive?: boolean, idea?: string) => {
    setGenerating(true);
    setGenerateDialogOpen(false);
    setStreamingContent("");
    startLoading(isZh ? "AI 正在生成方案..." : "AI generating scheme...");

    const currentCount = schemes.length;

    try {
      const res = await fetch("/api/schemes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, provider, skills, model, interactive, idea, locale: isZh ? "zh" : "en" }),
      });

      if (!res.ok || !res.body) {
        stopLoading(isZh ? `生成失败 (${res.status}, "error")` : `Failed (${res.status})`);
        return;
      }

      if (interactive) {
        // SSE stream parsing
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        let fellBack = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE events (split by \n\n)
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || ""; // Keep incomplete part in buffer

          for (const part of parts) {
            if (!part.trim()) continue;
            const parsed = sseParseEvent(part);
            if (!parsed) continue;

            if (parsed.event === "text") {
              content += parsed.data;
              setStreamingContent(content);
              updateContent(content);
            } else if (parsed.event === "init") {
              const init = JSON.parse(parsed.data);
              setGenerationId(init.generationId);
              setTotalQuestions(init.questionCount);
              setQuestionNumber(0);
            } else if (parsed.event === "question") {
              const q = JSON.parse(parsed.data);
              setQuestionNumber((n) => n + 1);
              setCurrentQuestion(q);
              // Stream pauses here — waiting for user answer via handleAnswer
            } else if (parsed.event === "answer_received") {
              // Question answered, stream continues
            } else if (parsed.event === "fallback") {
              // Fall back to standard generation
              fellBack = true;
            } else if (parsed.event === "done") {
              break;
            }
          }
        }

        if (fellBack) {
          // Re-run without interactive mode
          stopLoading();
          await handleGenerate(provider, skills, model, false, idea);
          return;
        }
      } else {
        // Standard plain-text streaming
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          setStreamingContent(content);
          updateContent(content);
        }

        if (content.includes("Error:") && content.trim().split("\n").length < 5) {
          stopLoading(isZh ? `生成失败: ${content.trim()}` : `Failed: ${content.trim()}`, "error");
          return;
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
      await fetchSchemes();
      onPlanStatusChange();
      const newSchemes = await fetch(`/api/schemes?planId=${planId}`).then(r => r.json());
      // Check if schemes were created OR updated (count may stay the same if updated)
      if (newSchemes.length > 0) {
        stopLoading(isZh ? "方案生成完成" : "Scheme generated");
      } else {
        stopLoading(isZh ? "方案生成失败，请检查 AI 配置" : "Scheme generation failed, check AI config", "error");
      }
    } catch (err) {
      stopLoading(isZh ? `生成失败: ${err instanceof Error ? err.message : "未知错误"}` : `Failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setGenerating(false);
      setStreamingContent("");
      setGenerationId(null);
      setCurrentQuestion(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t("scheme.title")}</h3>
        <div className="flex gap-2">
          {!readonly && (
            <>
              <Button
                variant="secondary"
                onClick={() => setGenerateDialogOpen(true)}
                disabled={generating}
              >
                {generating ? t("common.loading") : t("scheme.generate")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDialogOpen(true)}
              >
                {t("scheme.create")}
              </Button>
              {planStatus === "reviewing" && schemes.length > 0 && (() => {
                const unresolvedCount = reviewFindings.filter(f => !f.resolved).length;
                return (
                  <Button
                    onClick={handleConfirm}
                    disabled={unresolvedCount > 0}
                    title={unresolvedCount > 0 ? (isZh ? `还有 ${unresolvedCount} 条审查发现未处理` : `${unresolvedCount} unresolved findings`) : ""}
                  >
                    {t("scheme.confirmSchemes")}
                    {unresolvedCount > 0 && <span className="ml-1 text-xs opacity-70">({unresolvedCount})</span>}
                  </Button>
                );
              })()}
            </>
          )}
          {planStatus === "confirmed" && (
            <Button variant="secondary" onClick={handleRevoke}>
              {t("scheme.revokeConfirm")}
            </Button>
          )}
        </div>
      </div>

      {readonly && planStatus === "confirmed" && (
        <div className="mb-4 rounded-md bg-[rgba(192,193,255,0.12)] border border-[var(--primary)] px-4 py-2 text-sm text-[var(--primary)]">
          {t("scheme.confirmed")}
        </div>
      )}

      {/* Streaming preview while generating */}
      {generating && (
        <div className="mb-4 rounded-lg border border-[var(--primary)] bg-[rgba(192,193,255,0.12)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="animate-spin h-4 w-4 text-[var(--primary)]" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium text-[var(--primary)]">
              {t("scheme.generate")}...
            </span>
          </div>
          {streamingContent && (
            <div className="bg-[var(--surface-container-highest)] rounded p-3 max-h-60 overflow-y-auto">
              <MarkdownRenderer content={streamingContent} />
            </div>
          )}
        </div>
      )}

      {schemes.length === 0 && !generating ? (
        <p className="text-[var(--on-surface-variant)] text-center py-8">
          {t("common.noData")}
        </p>
      ) : (
        <div className="space-y-4">
          {schemes.map((scheme) => (
            <SchemeCard
              key={scheme.id}
              scheme={scheme}
              readonly={readonly}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              findings={reviewFindings}
              onFindingsChanged={fetchReviewFindings}
            />
          ))}
        </div>
      )}

      {/* Scheme Review */}
      {schemes.length > 0 && (
        <div className="mt-6 border-t pt-6">
          <ReviewPanel
            planId={planId}
            type="scheme"
            planStatus={planStatus}
            onPlanStatusChange={() => { onPlanStatusChange(); fetchReviewFindings(); }}
          />
        </div>
      )}

      <CreateSchemeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreate}
      />

      <GenerateSchemeDialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        onGenerate={handleGenerate}
        generating={generating}
      />

      <SchemeQuestionDialog
        open={!!currentQuestion}
        question={currentQuestion}
        questionNumber={questionNumber}
        totalQuestions={totalQuestions}
        onAnswer={handleAnswer}
      />
    </div>
  );
}
