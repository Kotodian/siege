"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { computeDiff } from "@/lib/diff";
import { StatusBadge } from "@/components/ui/status-badge";
import { InlineComment } from "./inline-comment";
import hljs from "highlight.js";

interface ReviewItem {
  id: string;
  title: string;
  content: string | null;
  severity: string;
  resolved: boolean;
  filePath: string | null;
  lineNumber: number | null;
}

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

interface DiffViewerProps {
  filePath: string;
  contentBefore: string;
  contentAfter: string;
  findings: ReviewItem[];
  comments: ReviewComment[];
  reviewId: string;
  onCommentAdded: () => void;
  taskTitle?: string;
  taskOrder?: number;
}

const severityStyles: Record<string, { bg: string; border: string; color: string }> = {
  critical: { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.3)", color: "#fca5a5" },
  warning: { bg: "rgba(234,179,8,0.15)", border: "rgba(234,179,8,0.3)", color: "#fde047" },
  info: { bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.3)", color: "#93c5fd" },
};

const extToLang: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript",
  ".rs": "rust", ".go": "go", ".py": "python",
  ".java": "java", ".kt": "kotlin",
  ".c": "c", ".cpp": "cpp", ".h": "cpp",
  ".css": "css", ".scss": "scss",
  ".html": "html", ".vue": "html",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml", ".md": "markdown",
  ".sql": "sql", ".sh": "bash", ".bash": "bash",
  ".xml": "xml", ".swift": "swift",
  ".rb": "ruby", ".php": "php",
  ".lua": "lua", ".zig": "zig",
};

function getLanguage(filePath: string): string | undefined {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return extToLang[ext];
}

/**
 * Highlight full source text, return per-line HTML strings.
 * highlight.js produces HTML that can span across lines (e.g. multi-line strings),
 * so we track open <span> tags to keep each line self-contained.
 */
function highlightLines(text: string, lang: string | undefined): string[] {
  if (!text) return [];

  let html: string;
  try {
    if (lang) {
      html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } else {
      html = hljs.highlightAuto(text).value;
    }
  } catch {
    // Fallback: escape HTML
    html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Split highlighted HTML by newlines, tracking open spans
  const rawLines = html.split("\n");
  const result: string[] = [];
  let openSpans: string[] = []; // stack of opening <span ...> tags

  for (const rawLine of rawLines) {
    // Prepend unclosed spans from previous line
    let line = openSpans.join("") + rawLine;

    // Track span opens/closes in this line to update state
    const opens = rawLine.match(/<span[^>]*>/g) || [];
    const closes = rawLine.match(/<\/span>/g) || [];

    // Update the open spans stack
    for (const tag of opens) openSpans.push(tag);
    for (let i = 0; i < closes.length; i++) openSpans.pop();

    // Close any spans that are still open for this line's HTML to be valid
    line += "</span>".repeat(openSpans.length);

    result.push(line);
  }

  return result;
}

export function DiffViewer({
  filePath,
  contentBefore,
  contentAfter,
  findings,
  comments,
  reviewId,
  onCommentAdded,
  taskTitle,
  taskOrder,
}: DiffViewerProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [commentLineIdx, setCommentLineIdx] = useState<number | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixResults, setFixResults] = useState<Record<string, { aiResponse: string; commentId: string; applied?: boolean }>>({});
  const diffLines = computeDiff(contentBefore, contentAfter);

  const handleAiFix = useCallback(async (finding: ReviewItem) => {
    if (fixingId || !finding.lineNumber) return;
    setFixingId(finding.id);
    try {
      const res = await fetch("/api/review-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId,
          filePath,
          lineNumber: finding.lineNumber,
          content: `[AI Fix] ${finding.title}\n\n${finding.content || ""}`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.aiResponse) {
          setFixResults((prev) => ({
            ...prev,
            [finding.id]: { aiResponse: data.aiResponse, commentId: data.id },
          }));
        }
        onCommentAdded();
      }
    } finally {
      setFixingId(null);
    }
  }, [fixingId, reviewId, filePath, onCommentAdded]);

  const handleApplyFix = useCallback(async (findingId: string) => {
    const result = fixResults[findingId];
    if (!result) return;
    setFixingId(findingId);
    try {
      const res = await fetch(`/api/review-comments/${result.commentId}/apply`, {
        method: "POST",
      });
      if (res.ok) {
        setFixResults((prev) => ({
          ...prev,
          [findingId]: { ...prev[findingId], applied: true },
        }));
        onCommentAdded();
      }
    } finally {
      setFixingId(null);
    }
  }, [fixResults, onCommentAdded]);

  const lang = getLanguage(filePath);

  // Pre-highlight old and new content, get per-line HTML
  const oldHighlighted = useMemo(() => highlightLines(contentBefore, lang), [contentBefore, lang]);
  const newHighlighted = useMemo(() => highlightLines(contentAfter, lang), [contentAfter, lang]);

  const findingsMap = new Map<number, ReviewItem[]>();
  for (const f of findings) {
    if (f.filePath === filePath && f.lineNumber) {
      const existing = findingsMap.get(f.lineNumber) || [];
      existing.push(f);
      findingsMap.set(f.lineNumber, existing);
    }
  }

  const commentsMap = new Map<number, ReviewComment[]>();
  for (const c of comments) {
    if (c.filePath === filePath) {
      const existing = commentsMap.get(c.lineNumber) || [];
      existing.push(c);
      commentsMap.set(c.lineNumber, existing);
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 px-4 py-2 font-mono text-xs z-10 flex items-center gap-2" style={{ background: "var(--background)", borderBottom: "1px solid var(--outline-variant)", color: "var(--outline)" }}>
        <span className="flex-1 truncate">{filePath}</span>
        {taskTitle && (
          <span className="shrink-0 text-[10px] font-sans font-medium px-1.5 py-0.5 rounded" style={{ background: "var(--outline-variant)", color: "var(--on-surface)" }}>
            #{taskOrder} {taskTitle}
          </span>
        )}
      </div>
      <div className="font-mono text-xs">
        {(() => {
          // Collapse unchanged lines — show only 3 lines of context around changes
          const CONTEXT = 3;
          const changedIndices = new Set<number>();
          diffLines.forEach((line, i) => {
            if (line.type !== "same") {
              for (let j = Math.max(0, i - CONTEXT); j <= Math.min(diffLines.length - 1, i + CONTEXT); j++) {
                changedIndices.add(j);
              }
            }
          });
          // Also show lines with findings/comments
          diffLines.forEach((line, i) => {
            const lineNum = line.type === "remove" ? line.oldLineNumber : line.newLineNumber;
            if (lineNum && (findingsMap.has(lineNum) || commentsMap.has(lineNum))) {
              for (let j = Math.max(0, i - CONTEXT); j <= Math.min(diffLines.length - 1, i + CONTEXT); j++) {
                changedIndices.add(j);
              }
            }
          });
          // If no changes at all, show first 20 lines
          if (changedIndices.size === 0) {
            for (let i = 0; i < Math.min(20, diffLines.length); i++) changedIndices.add(i);
          }

          let lastShown = -1;
          return diffLines.map((line, i) => {
            if (!changedIndices.has(i)) {
              // Show a collapse indicator at the boundary
              if (lastShown === i - 1) return null; // skip silently
              if (i > 0 && changedIndices.has(i + 1)) {
                // About to show again — render separator
                const skipped = i - lastShown - 1;
                lastShown = i;
                return (
                  <div key={`sep-${i}`} className="text-center py-1" style={{ background: "var(--surface-container-high)", color: "var(--outline)" }}>
                    ··· {skipped} {skipped === 1 ? "line" : "lines"} ···
                  </div>
                );
              }
              return null;
            }
            // Check if we need separator before this line
            let separator = null;
            if (lastShown >= 0 && lastShown < i - 1) {
              const skipped = i - lastShown - 1;
              separator = (
                <div key={`sep-${i}`} className="text-center py-1" style={{ background: "var(--surface-container-high)", color: "var(--outline)" }}>
                  ··· {skipped} {skipped === 1 ? "line" : "lines"} ···
                </div>
              );
            }
            lastShown = i;
          const lineNum = line.type === "remove" ? line.oldLineNumber : line.newLineNumber;
          const lineFindings = lineNum ? findingsMap.get(lineNum) : undefined;
          const lineComments = lineNum ? commentsMap.get(lineNum) : undefined;
          const isCommentTarget = commentLineIdx === i;

          // Pick the highlighted HTML for this line
          let highlightedHtml: string | undefined;
          if (line.type === "remove" && line.oldLineNumber !== null) {
            highlightedHtml = oldHighlighted[line.oldLineNumber - 1];
          } else if (line.newLineNumber !== null) {
            highlightedHtml = newHighlighted[line.newLineNumber - 1];
          }

          const lineElement = (
            <div key={`line-${i}`}>
              {/* Diff line */}
              <div
                className={`flex ${
                  line.type === "add"
                    ? ""
                    : line.type === "remove"
                      ? ""
                      : "hover:opacity-80"
                }`}
                style={{
                  ...(line.type === "add"
                    ? { background: "rgba(74,222,128,0.1)" }
                    : line.type === "remove"
                      ? { background: "rgba(248,113,113,0.1)" }
                      : {}),
                }}
              >
                {/* Old line number gutter */}
                <button
                  className="w-12 text-right pr-2 select-none hover:opacity-80 shrink-0"
                  style={{ color: "var(--outline)", borderRight: "1px solid var(--outline-variant)" }}
                  onClick={() => setCommentLineIdx(commentLineIdx === i ? null : i)}
                  title={t("review.addComment")}
                >
                  {line.oldLineNumber || ""}
                </button>
                {/* New line number gutter */}
                <button
                  className="w-12 text-right pr-2 select-none hover:opacity-80 shrink-0"
                  style={{ color: "var(--outline)", borderRight: "1px solid var(--outline-variant)" }}
                  onClick={() => setCommentLineIdx(commentLineIdx === i ? null : i)}
                  title={t("review.addComment")}
                >
                  {line.newLineNumber || ""}
                </button>
                {/* +/- indicator */}
                <span className={`w-5 text-center select-none shrink-0 ${
                  line.type === "add" ? "text-[var(--success)]" : line.type === "remove" ? "text-[var(--error)]" : "text-[var(--on-surface-variant)]"
                }`}>
                  {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                </span>
                {/* Content with syntax highlighting */}
                {highlightedHtml !== undefined ? (
                  <span
                    className="hljs px-2 whitespace-pre break-all flex-1"
                    style={{ background: "transparent" }}
                    dangerouslySetInnerHTML={{ __html: highlightedHtml || "&nbsp;" }}
                  />
                ) : (
                  <span className="px-2 whitespace-pre break-all flex-1">
                    {line.text || " "}
                  </span>
                )}
              </div>

              {/* Inline findings */}
              {lineFindings?.map((finding) => {
                const fixResult = fixResults[finding.id];
                return (
                  <div
                    key={finding.id}
                    className={`mx-12 my-1 p-2 rounded border text-xs ${finding.resolved ? "opacity-60" : ""}`}
                    style={finding.resolved
                      ? { background: "var(--background)", borderColor: "var(--outline-variant)", color: "var(--on-surface)" }
                      : (() => { const s = severityStyles[finding.severity] || severityStyles.info; return { background: s.bg, borderColor: s.border, color: s.color }; })()
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={finding.severity} label={finding.severity} />
                        <span className="font-semibold">{finding.title}</span>
                      </div>
                      {!finding.resolved && reviewId && (
                        <div className="flex gap-1">
                          {!fixResult ? (
                            <button
                              onClick={() => handleAiFix(finding)}
                              disabled={fixingId !== null}
                              className="px-2 py-0.5 rounded disabled:opacity-50 font-medium"
                              style={{ background: "rgba(59,130,246,0.2)", color: "#93c5fd" }}
                            >
                              {fixingId === finding.id
                                ? isZh ? "修复中..." : "Fixing..."
                                : isZh ? "AI 修复" : "AI Fix"}
                            </button>
                          ) : !fixResult.applied ? (
                            <button
                              onClick={() => handleApplyFix(finding.id)}
                              disabled={fixingId !== null}
                              className="px-2 py-0.5 rounded disabled:opacity-50 font-medium"
                              style={{ background: "rgba(34,197,94,0.2)", color: "#86efac" }}
                            >
                              {fixingId === finding.id
                                ? isZh ? "应用中..." : "Applying..."
                                : t("review.applyFix")}
                            </button>
                          ) : (
                            <span className="px-2 py-0.5 rounded font-medium" style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}>
                              {t("review.fixApplied")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {finding.content && (
                      <p className="mt-1" style={{ color: "var(--on-surface)" }}>{finding.content}</p>
                    )}
                    {fixResult && !fixResult.applied && (
                      <div className="mt-2 p-2 rounded border" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
                        <span className="font-semibold" style={{ color: "#93c5fd" }}>{t("review.aiSuggestion")}:</span>
                        <pre className="mt-1 whitespace-pre-wrap text-xs" style={{ color: "var(--on-surface)" }}>{fixResult.aiResponse}</pre>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Existing comments */}
              {lineComments?.map((comment) => (
                <div key={comment.id} className="mx-12 my-1 p-2 rounded border text-xs" style={{ borderColor: "var(--outline-variant)", background: "var(--surface-container-high)" }}>
                  <p style={{ color: "var(--on-surface)" }}>{comment.content}</p>
                  {comment.aiResponse && (
                    <div className="mt-1 p-1.5 rounded border" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
                      <span className="font-semibold" style={{ color: "var(--secondary)" }}>{t("review.aiSuggestion")}:</span>
                      <p className="mt-0.5 whitespace-pre-wrap" style={{ color: "var(--on-surface)" }}>{comment.aiResponse}</p>
                    </div>
                  )}
                </div>
              ))}

              {/* Inline comment input */}
              {isCommentTarget && lineNum && (
                <InlineComment
                  reviewId={reviewId}
                  filePath={filePath}
                  lineNumber={lineNum}
                  onClose={() => setCommentLineIdx(null)}
                  onSubmitted={onCommentAdded}
                />
              )}
            </div>
          );
          return separator ? <div key={`wrap-${i}`}>{separator}{lineElement}</div> : lineElement;
        }).filter(Boolean);
        })()}
      </div>
    </div>
  );
}
