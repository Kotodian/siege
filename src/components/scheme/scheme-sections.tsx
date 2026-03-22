"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { useGlobalLoading } from "@/components/ui/global-loading";
import { LightbulbIcon, XIcon, HourglassIcon, HelpCircleIcon, PencilIcon } from "@/components/ui/icons";

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

function joinSections(preamble: string, sections: Section[]): string {
  let result = preamble;
  for (const s of sections) {
    result += s.heading + "\n" + s.content;
    if (!result.endsWith("\n")) result += "\n";
  }
  return result.trim();
}

interface Finding {
  id: string;
  targetId: string;
  title: string;
  content: string | null;
  severity: string;
  resolved: boolean;
  resolution?: string | null; // null=pending, "approved"=valid, "rejected"=dismissed
}

interface SchemeSectionsProps {
  content: string;
  schemeId?: string;
  readonly?: boolean;
  findings?: Finding[];
  onContentUpdated?: (newContent: string) => void;
  onFindingsChanged?: () => void;
}

const severityStyles: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: "#3a1a1a", border: "#7f1d1d", text: "#fca5a5" },
  warning: { bg: "#3a2a1a", border: "#78350f", text: "#fcd34d" },
  info: { bg: "#1a2a3a", border: "#1e3a5f", text: "#93c5fd" },
};

const resolutionStyles: Record<string, { label: string; labelZh: string; bg: string; color: string }> = {
  approved: { label: "Approved", labelZh: "已认可", bg: "rgba(234,179,8,0.2)", color: "#fcd34d" },
  rejected: { label: "Rejected", labelZh: "已驳回", bg: "rgba(107,114,128,0.2)", color: "#9ca3af" },
};

function FindingCard({
  finding: f,
  readonly,
  schemeId,
  isZh,
  fixingFinding,
  fixNote,
  onFixNote,
  onStartFix,
  onSubmitFix,
  onCancelFix,
  onResolutionChange,
}: {
  finding: Finding;
  readonly: boolean;
  schemeId?: string;
  isZh: boolean;
  fixingFinding: { finding: Finding } | null;
  fixNote: string;
  onFixNote: (v: string) => void;
  onStartFix: () => void;
  onSubmitFix: () => void;
  onCancelFix: () => void;
  onResolutionChange?: () => void;
}) {
  const s = severityStyles[f.severity] || severityStyles.info;
  const rs = f.resolution ? resolutionStyles[f.resolution] : null;
  const isRejected = f.resolution === "rejected";
  const isApproved = f.resolution === "approved";
  const isPending = !f.resolution;

  const handleResolution = async (resolution: "approved" | "rejected") => {
    await fetch(`/api/review-items/${f.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution,
        resolved: resolution === "rejected",
      }),
    });
    onResolutionChange?.();
  };

  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${isRejected ? "opacity-30" : ""}`}
      style={{ background: s.bg, borderColor: s.border, color: s.text }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium min-w-0">
          <span className="uppercase text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: s.border }}>
            {f.severity}
          </span>
          <span className="truncate">{f.title}</span>
          {rs && (
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: rs.bg, color: rs.color }}>
              {isZh ? rs.labelZh : rs.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isPending && !readonly && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleResolution("approved"); }}
                className="px-2 py-0.5 rounded text-[10px] font-medium hover:opacity-80"
                style={{ background: "rgba(34,197,94,0.2)", color: "#86efac" }}
                title={isZh ? "认可：这是一个有效问题" : "Approve: this is a valid issue"}
              >
                {isZh ? "认可" : "Approve"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleResolution("rejected"); }}
                className="px-2 py-0.5 rounded text-[10px] font-medium hover:opacity-80"
                style={{ background: "rgba(107,114,128,0.2)", color: "#9ca3af" }}
                title={isZh ? "驳回：不认为这是问题" : "Reject: not a real issue"}
              >
                {isZh ? "驳回" : "Reject"}
              </button>
            </>
          )}
          {isApproved && !readonly && schemeId && (
            <button
              onClick={(e) => { e.stopPropagation(); onStartFix(); }}
              className="px-2 py-0.5 rounded text-[10px] font-medium hover:opacity-80"
              style={{ background: s.border, color: s.text }}
            >
              {isZh ? "AI 修复" : "AI Fix"}
            </button>
          )}
        </div>
      </div>
      {f.content && (
        <div className="mt-1 opacity-90">
          <MarkdownRenderer content={f.content} />
        </div>
      )}
      {fixingFinding?.finding.id === f.id && (
        <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
          <input
            value={fixNote}
            onChange={(e) => onFixNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmitFix()}
            placeholder={isZh ? "补充说明（可选，直接回车修复）" : "Additional notes (optional, Enter to fix)"}
            autoFocus
            className="flex-1 rounded border px-2 py-1 text-[11px]"
            style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
          />
          <button
            onClick={onSubmitFix}
            className="shrink-0 px-2 py-1 rounded text-[10px] font-medium hover:opacity-80"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {isZh ? "修复" : "Fix"}
          </button>
          <button
            onClick={onCancelFix}
            className="shrink-0 px-2 py-1 rounded text-[10px] hover:opacity-80"
            style={{ color: "var(--muted)" }}
          >
            {isZh ? "取消" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}

export function SchemeSections({
  content,
  schemeId,
  readonly,
  findings = [],
  onContentUpdated,
  onFindingsChanged,
}: SchemeSectionsProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  const { preamble, sections } = useMemo(() => splitIntoSections(content), [content]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [fixingFinding, setFixingFinding] = useState<{ finding: Finding; section: Section; sectionIndex: number } | null>(null);
  const [fixNote, setFixNote] = useState("");
  const [explaining, setExplaining] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<Record<number, string>>({});

  const toggle = (i: number) => {
    setExpandedIndex(expandedIndex === i ? null : i);
    if (expandedIndex !== i) {
      setEditingIndex(null);
      setSuggestion("");
    }
  };

  const applySectionReplace = async (sectionIndex: number, newSectionContent: string) => {
    // Replace the section content and save to DB
    const updatedSections = sections.map((s, i) =>
      i === sectionIndex ? { ...s, content: newSectionContent } : s
    );
    const newFullContent = joinSections(preamble, updatedSections);

    // Save to DB
    if (schemeId) {
      await fetch(`/api/schemes/${schemeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newFullContent }),
      });
    }
    if (onContentUpdated) onContentUpdated(newFullContent);
  };

  const streamSectionEdit = async (prompt: string, sectionIndex: number): Promise<boolean> => {
    if (!schemeId) return false;
    const res = await fetch("/api/schemes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemeId, message: prompt, sectionOnly: true }),
    });
    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let aiContent = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      aiContent += decoder.decode(value, { stream: true });
      updateContent(aiContent);
    }

    if (aiContent.trim()) {
      await applySectionReplace(sectionIndex, aiContent.trim());
      return true;
    }
    return false;
  };

  const submitFindingFix = async () => {
    if (!fixingFinding) return;
    const { finding, section, sectionIndex } = fixingFinding;
    const note = fixNote.trim();
    setFixingFinding(null);
    setFixNote("");

    startLoading(isZh ? "AI 正在修复..." : "AI fixing...");
    let prompt = `请根据以下审查意见修复方案中「${section.title}」段落：\n\n**${finding.title}**\n${finding.content || ""}`;
    if (note) {
      prompt += `\n\n用户补充说明：${note}`;
    }
    prompt += `\n\n当前该段落内容：\n${section.heading}\n${section.content}`;

    const ok = await streamSectionEdit(prompt, sectionIndex);
    if (ok) {
      await fetch(`/api/review-items/${finding.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      });
      if (onFindingsChanged) onFindingsChanged();
    }
    stopLoading(ok ? (isZh ? "修复完成" : "Fixed") : (isZh ? "修复失败" : "Fix failed"));
  };

  const handleExplain = async (sectionIndex: number) => {
    const section = sections[sectionIndex];
    setExplaining(sectionIndex);
    setExplanation((prev) => ({ ...prev, [sectionIndex]: isZh ? "AI 正在解释..." : "AI explaining..." }));
    try {
      const res = await fetch("/api/schemes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemeId: schemeId || "explain",
          message: `请用通俗易懂的语言解释以下技术方案段落的含义、目的和关键点。不要修改方案，只做解释。\n\n${section.heading}\n${section.content}`,
          sectionOnly: true,
        }),
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setExplanation((prev) => ({ ...prev, [sectionIndex]: text }));
        }
      }
    } catch {
      setExplanation((prev) => ({ ...prev, [sectionIndex]: isZh ? "解释失败" : "Explain failed" }));
    } finally {
      setExplaining(null);
    }
  };

  const handleSectionSuggest = async (sectionIndex: number) => {
    if (!suggestion.trim() || !schemeId) return;

    const section = sections[sectionIndex];
    const instruction = suggestion.trim();
    setSuggestion("");
    setEditingIndex(null);

    startLoading(isZh ? "AI 修改段落中..." : "AI modifying section...");
    const prompt = `请只修改方案中「${section.title}」这个段落的内容。修改指令：${instruction}\n\n当前该段落的内容：\n${section.heading}\n${section.content}`;
    const ok = await streamSectionEdit(prompt, sectionIndex);
    stopLoading(ok ? (isZh ? "段落修改完成" : "Section modified") : (isZh ? "修改失败" : "Failed"));
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
          // Match findings to section by target_id hint, keyword overlap, or content search
          const sectionFindings = findings.filter((f) => {
            // 1. Match by target_id section hint (e.g. "schemeId:event-loop")
            const hint = f.targetId?.split(":")[1]?.toLowerCase() || "";
            if (hint) {
              const sectionLower = `${section.title} ${section.content}`.toLowerCase();
              if (sectionLower.includes(hint) || sectionLower.includes(hint.replace(/-/g, " "))) return true;
            }
            // 2. Match by keyword overlap (works for same-language titles)
            const text = `${f.title} ${f.content || ""}`.toLowerCase();
            const words = section.title.toLowerCase().split(/[\s\u3000]+/).filter(w => w.length > 2);
            if (words.some(w => text.includes(w))) return true;
            // 3. Search finding keywords in section content
            const findingWords = f.title.toLowerCase().split(/[\s\u3000、，]+/).filter(w => w.length > 2);
            const contentLower = section.content.toLowerCase();
            const matchCount = findingWords.filter(w => contentLower.includes(w)).length;
            if (matchCount >= 2) return true;
            return false;
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
                      {sectionFindings.map((f) => (
                        <FindingCard
                          key={f.id}
                          finding={f}
                          readonly={!!readonly}
                          schemeId={schemeId}
                          isZh={isZh}
                          fixingFinding={fixingFinding}
                          fixNote={fixNote}
                          onFixNote={setFixNote}
                          onStartFix={() => { setFixingFinding({ finding: f, section, sectionIndex: i }); setFixNote(""); }}
                          onSubmitFix={submitFindingFix}
                          onCancelFix={() => setFixingFinding(null)}
                          onResolutionChange={onFindingsChanged}
                        />
                      ))}
                    </div>
                  )}

                  {/* Explanation */}
                  {explanation[i] && (
                    <div className="mt-3 p-3 rounded-md text-xs" style={{ background: "var(--background)", color: "var(--foreground)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium" style={{ color: "var(--muted)" }}>
                          <><LightbulbIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "AI 解释" : "AI Explanation"}</>
                        </span>
                        <button onClick={() => setExplanation((prev) => { const n = { ...prev }; delete n[i]; return n; })}
                          className="text-[10px]" style={{ color: "var(--muted)" }}><XIcon size={10} /></button>
                      </div>
                      <MarkdownRenderer content={explanation[i]} />
                    </div>
                  )}

                  {/* Section actions */}
                  <div className="mt-3 pt-3 border-t flex items-center gap-3" style={{ borderColor: "var(--card-border)" }}>
                    <button
                      onClick={() => explanation[i] ? setExplanation((prev) => { const n = { ...prev }; delete n[i]; return n; }) : handleExplain(i)}
                      disabled={explaining === i}
                      className="text-xs hover:underline"
                      style={{ color: "var(--muted)" }}
                    >
                      {explaining === i
                        ? <><HourglassIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "解释中..." : "Explaining..."}</>
                        : <><HelpCircleIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "解释" : "Explain"}</>}
                    </button>
                    {!readonly && schemeId && (
                      <>
                        {isEditing ? (
                          <div className="flex gap-2 flex-1">
                            <input
                              value={suggestion}
                              onChange={(e) => setSuggestion(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSectionSuggest(i)}
                              placeholder={isZh ? `修改「${section.title}」的建议...` : `Suggestion for "${section.title}"...`}
                              autoFocus
                              className="flex-1 rounded-md border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
                            />
                            <Button size="sm" onClick={() => handleSectionSuggest(i)} disabled={!suggestion.trim()}>
                              {isZh ? "修改" : "Apply"}
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => { setEditingIndex(null); setSuggestion(""); }}>
                              {t("common.cancel")}
                            </Button>
                          </div>
                        ) : (
                          <button onClick={() => setEditingIndex(i)} className="text-xs hover:underline" style={{ color: "var(--muted)" }}>
                            <><PencilIcon size={12} className="inline-block align-[-1px]" /> {isZh ? "AI 修改" : "AI Edit"}</>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unmatched findings — show at the bottom if they didn't match any section */}
      {(() => {
        const matchedIds = new Set<string>();
        for (const section of sections) {
          for (const f of findings) {
            const hint = f.targetId?.split(":")[1]?.toLowerCase() || "";
            const sectionLower = `${section.title} ${section.content}`.toLowerCase();
            if (hint && (sectionLower.includes(hint) || sectionLower.includes(hint.replace(/-/g, " ")))) { matchedIds.add(f.id); continue; }
            const text = `${f.title} ${f.content || ""}`.toLowerCase();
            const words = section.title.toLowerCase().split(/[\s\u3000]+/).filter(w => w.length > 2);
            if (words.some(w => text.includes(w))) { matchedIds.add(f.id); continue; }
            const findingWords = f.title.toLowerCase().split(/[\s\u3000、，]+/).filter(w => w.length > 2);
            const contentLower = section.content.toLowerCase();
            if (findingWords.filter(w => contentLower.includes(w)).length >= 2) { matchedIds.add(f.id); continue; }
          }
        }
        const unmatched = findings.filter(f => !matchedIds.has(f.id));
        if (unmatched.length === 0) return null;
        return (
          <div className="mt-3 space-y-2">
            <h5 className="text-xs font-medium" style={{ color: "var(--muted)" }}>
              {isZh ? "审查发现" : "Review Findings"}
            </h5>
            {unmatched.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                readonly={!!readonly}
                schemeId={schemeId}
                isZh={isZh}
                fixingFinding={fixingFinding}
                fixNote={fixNote}
                onFixNote={setFixNote}
                onStartFix={() => { setFixingFinding({ finding: f, section: sections[0], sectionIndex: 0 }); setFixNote(""); }}
                onSubmitFix={submitFindingFix}
                onCancelFix={() => setFixingFinding(null)}
                onResolutionChange={onFindingsChanged}
              />
            ))}
          </div>
        );
      })()}
    </div>
  );
}
