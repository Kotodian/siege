"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { useGlobalLoading } from "@/components/ui/global-loading";

interface Section {
  title: string;
  level: number;
  content: string;
  heading: string; // original heading line e.g. "## Overview"
}

function splitIntoSections(content: string): { preamble: string; sections: Section[] } {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let preamble = "";
  let current: { title: string; level: number; heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      if (current) {
        sections.push({
          title: current.title,
          level: current.level,
          heading: current.heading,
          content: current.lines.join("\n").trim(),
        });
      }
      current = {
        title: match[2].replace(/[*_`~]/g, "").trim(),
        level: match[1].length,
        heading: line,
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble += line + "\n";
    }
  }
  if (current) {
    sections.push({
      title: current.title,
      level: current.level,
      heading: current.heading,
      content: current.lines.join("\n").trim(),
    });
  }

  return { preamble: preamble.trim(), sections };
}

interface Finding {
  id: string;
  title: string;
  content: string | null;
  severity: string;
  resolved: boolean;
}

interface SchemeSectionsProps {
  content: string;
  schemeId?: string;
  readonly?: boolean;
  findings?: Finding[];
  onContentUpdated?: (newContent: string) => void;
}

const severityStyles: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: "#3a1a1a", border: "#7f1d1d", text: "#fca5a5" },
  warning: { bg: "#3a2a1a", border: "#78350f", text: "#fcd34d" },
  info: { bg: "#1a2a3a", border: "#1e3a5f", text: "#93c5fd" },
};

export function SchemeSections({
  content,
  schemeId,
  readonly,
  findings = [],
  onContentUpdated,
}: SchemeSectionsProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  const { preamble, sections } = useMemo(() => splitIntoSections(content), [content]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState("");

  const toggle = (i: number) => {
    setExpandedIndex(expandedIndex === i ? null : i);
    if (expandedIndex !== i) {
      setEditingIndex(null);
      setSuggestion("");
    }
  };

  const handleSectionSuggest = async (sectionIndex: number) => {
    if (!suggestion.trim() || !schemeId) return;

    const section = sections[sectionIndex];
    const instruction = suggestion.trim();
    setSuggestion("");
    setEditingIndex(null);

    startLoading(isZh ? "AI 修改段落中..." : "AI modifying section...");

    try {
      const res = await fetch("/api/schemes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemeId,
          message: `请只修改方案中「${section.title}」这个段落的内容。修改指令：${instruction}\n\n当前该段落的内容：\n${section.heading}\n${section.content}`,
        }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let aiContent = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          aiContent += decoder.decode(value, { stream: true });
          updateContent(aiContent);
        }

        // Refetch the updated scheme
        await new Promise((r) => setTimeout(r, 1000));
        const schemeRes = await fetch(`/api/schemes/${schemeId}`);
        if (schemeRes.ok) {
          const updated = await schemeRes.json();
          if (updated.content && onContentUpdated) {
            onContentUpdated(updated.content);
          }
        }
        stopLoading(isZh ? "段落修改完成" : "Section modified");
      } else {
        stopLoading(isZh ? "修改失败" : "Failed");
      }
    } catch {
      stopLoading(isZh ? "修改失败" : "Failed");
    }
  };

  return (
    <div className="space-y-0">
      {preamble && (
        <div className="pb-3 mb-2">
          <MarkdownRenderer content={preamble} />
        </div>
      )}
      <div className="border rounded-lg divide-y" style={{ borderColor: "var(--card-border)", "--tw-divide-color": "var(--card-border)" } as React.CSSProperties}>
        {sections.map((section, i) => {
          const isOpen = expandedIndex === i;
          const isEditing = editingIndex === i;
          // Match findings to section by keyword overlap
          const sectionFindings = findings.filter((f) => {
            const text = `${f.title} ${f.content || ""}`.toLowerCase();
            const words = section.title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            return words.some(w => text.includes(w));
          });
          const unresolvedCount = sectionFindings.filter(f => !f.resolved).length;
          return (
            <div key={i}>
              <button
                onClick={() => toggle(i)}
                className="w-full text-left px-4 py-3 flex items-center justify-between transition-colors"
                style={{ background: isOpen ? "var(--background)" : undefined }}
              >
                <span className="flex items-center gap-2">
                  <span
                    className="font-medium text-sm"
                    style={{ paddingLeft: `${(section.level - 1) * 12}px` }}
                  >
                    {section.title}
                  </span>
                  {unresolvedCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "#7f1d1d", color: "#fca5a5" }}>
                      {unresolvedCount}
                    </span>
                  )}
                </span>
                <svg
                  className={`w-4 h-4 shrink-0 transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  style={{ color: "var(--muted)" }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <div className="px-4 pb-4">
                  <MarkdownRenderer content={section.content} />

                  {/* Review findings for this section */}
                  {sectionFindings.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {sectionFindings.map((f) => {
                        const s = severityStyles[f.severity] || severityStyles.info;
                        return (
                          <div
                            key={f.id}
                            className={`rounded-md border px-3 py-2 text-xs ${f.resolved ? "opacity-40" : ""}`}
                            style={{ background: s.bg, borderColor: s.border, color: s.text }}
                          >
                            <div className="flex items-center gap-2 font-medium">
                              <span className="uppercase text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: s.border }}>
                                {f.severity}
                              </span>
                              {f.title}
                              {f.resolved && <span style={{ color: "var(--muted)" }}>(resolved)</span>}
                            </div>
                            {f.content && (
                              <div className="mt-1 opacity-90">
                                <MarkdownRenderer content={f.content} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Section-level AI suggestion */}
                  {!readonly && schemeId && (
                    <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--card-border)" }}>
                      {isEditing ? (
                        <div className="flex gap-2">
                          <input
                            value={suggestion}
                            onChange={(e) => setSuggestion(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSectionSuggest(i)}
                            placeholder={
                              isZh
                                ? `修改「${section.title}」的建议...`
                                : `Suggestion for "${section.title}"...`
                            }
                            autoFocus
                            className="flex-1 rounded-md border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                          />
                          <Button
                            size="sm"
                            onClick={() => handleSectionSuggest(i)}
                            disabled={!suggestion.trim()}
                          >
                            {isZh ? "修改" : "Apply"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { setEditingIndex(null); setSuggestion(""); }}
                          >
                            {t("common.cancel")}
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingIndex(i)}
                          className="text-xs hover:underline"
                          style={{ color: "var(--muted)" }}
                        >
                          {isZh ? "AI 修改此段落" : "AI Edit This Section"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
