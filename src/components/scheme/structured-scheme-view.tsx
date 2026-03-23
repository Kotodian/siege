"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { StructuredScheme } from "@/lib/scheme-types";
import hljs from "highlight.js";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";

const severityColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  high: { bg: "#3a1a1a", border: "#7f1d1d", text: "#fca5a5", dot: "#ef4444" },
  medium: { bg: "#3a2a1a", border: "#78350f", text: "#fcd34d", dot: "#eab308" },
  low: { bg: "#1a2a3a", border: "#1e3a5f", text: "#93c5fd", dot: "#3b82f6" },
};

interface Finding {
  id: string;
  targetId: string;
  title: string;
  content: string | null;
  severity: string;
  resolved: boolean;
  resolution?: string | null;
}

interface StructuredSchemeViewProps {
  data: StructuredScheme;
  schemeId: string;
  findings?: Finding[];
  onFindingsChanged?: () => void;
}

function FindingChip({ f, isZh, onApprove, onReject }: {
  f: Finding; isZh: boolean;
  onApprove: () => void; onReject: () => void;
}) {
  const s = severityColors[f.severity] || severityColors.low;
  if (f.resolution === "rejected") return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[11px]"
      style={{ background: s.bg, borderLeft: `3px solid ${s.border}`, color: s.text }}>
      <span className="truncate">{f.title}</span>
      {!f.resolution && !f.resolved && (
        <div className="flex gap-1 shrink-0">
          <button onClick={onApprove} className="px-1.5 py-0.5 rounded hover:opacity-80" style={{ background: "rgba(34,197,94,0.2)", color: "#86efac" }}>✓</button>
          <button onClick={onReject} className="px-1.5 py-0.5 rounded hover:opacity-80" style={{ background: "rgba(107,114,128,0.2)", color: "#9ca3af" }}>✗</button>
        </div>
      )}
      {f.resolution === "approved" && (
        <span className="text-[10px] px-1 rounded shrink-0" style={{ background: "rgba(234,179,8,0.2)", color: "#fcd34d" }}>{isZh ? "已认可" : "Approved"}</span>
      )}
    </div>
  );
}

export function StructuredSchemeView({ data, schemeId, findings = [], onFindingsChanged }: StructuredSchemeViewProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [currentSlide, setCurrentSlide] = useState(0);

  const findingsFor = (prefix: string) => findings.filter(f => f.targetId?.startsWith(`${schemeId}:${prefix}`));

  const handleResolution = async (fId: string, resolution: "approved" | "rejected") => {
    await fetch(`/api/review-items/${fId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution, resolved: resolution === "rejected" }),
    });
    onFindingsChanged?.();
  };

  // Build slides
  const slides: Array<{ id: string; title: string; icon: string; content: React.ReactNode }> = [];

  // Slide 0: Overview
  slides.push({
    id: "overview",
    title: isZh ? "概述" : "Overview",
    icon: "📋",
    content: (
      <div className="flex items-center justify-center h-full">
        <p className="text-lg leading-relaxed max-w-xl text-center" style={{ color: "var(--foreground)" }}>{data.overview}</p>
      </div>
    ),
  });

  // Slide 1: Architecture - Components
  if (data.architecture?.components?.length) {
    slides.push({
      id: "architecture",
      title: isZh ? "架构组件" : "Components",
      icon: "🏗",
      content: (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(data.architecture.components.length, 3)}, 1fr)` }}>
          {data.architecture.components.map((c, i) => (
            <div key={i} className="rounded-lg border p-4" style={{ background: "var(--background)", borderColor: "var(--card-border)" }}>
              <div className="font-mono font-bold text-sm mb-2" style={{ color: "var(--foreground)" }}>{c.name}</div>
              <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>{c.responsibility}</div>
              {c.dependencies?.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {c.dependencies.map((d, j) => (
                    <span key={j} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--card-border)", color: "var(--foreground)" }}>{d}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ),
    });
  }

  // Slide: Architecture Diagram
  if (data.architecture?.diagram) {
    slides.push({
      id: "diagram",
      title: isZh ? "架构图" : "Architecture Diagram",
      icon: "📐",
      content: (
        <div className="flex items-center justify-center h-full">
          <MermaidDiagram chart={data.architecture.diagram} />
        </div>
      ),
    });
  }

  // Slide: Data Flow
  if (data.architecture?.dataFlow?.length) {
    slides.push({
      id: "dataflow",
      title: isZh ? "数据流" : "Data Flow",
      icon: "🔄",
      content: (
        <div className="flex flex-col items-center gap-0">
          {data.architecture.dataFlow.map((step, i) => (
            <div key={i} className="flex items-center gap-3 w-full max-w-lg">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}>{i + 1}</div>
                {i < data.architecture.dataFlow.length - 1 && (
                  <div className="w-px h-6" style={{ background: "var(--card-border)" }} />
                )}
              </div>
              <div className="flex-1 rounded-lg border px-4 py-2.5 text-sm" style={{ background: "var(--background)", borderColor: "var(--card-border)", color: "var(--foreground)" }}>
                {step}
              </div>
            </div>
          ))}
        </div>
      ),
    });
  }

  // Slide 3: Interfaces (one per slide if many, or grouped)
  if (data.interfaces?.length) {
    slides.push({
      id: "interfaces",
      title: isZh ? "接口定义" : "Interfaces",
      icon: "⚡",
      content: (
        <div className="space-y-4 overflow-y-auto max-h-[400px]">
          {data.interfaces.map((iface, i) => {
            let highlighted = iface.definition;
            try {
              const lang = iface.language || "plaintext";
              highlighted = hljs.highlight(iface.definition, { language: hljs.getLanguage(lang) ? lang : "plaintext" }).value;
            } catch { /* fallback */ }
            return (
              <div key={i} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--card-border)" }}>
                <div className="flex items-center gap-2 px-4 py-2" style={{ background: "var(--background)" }}>
                  <span className="font-mono font-bold text-sm" style={{ color: "var(--foreground)" }}>{iface.name}</span>
                  {iface.language && <span className="text-[10px] px-1.5 rounded" style={{ background: "var(--card-border)", color: "var(--muted)" }}>{iface.language}</span>}
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{iface.description}</span>
                </div>
                <pre className="text-xs p-4 overflow-x-auto" style={{ background: "#0d1117", margin: 0 }}>
                  <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                </pre>
              </div>
            );
          })}
        </div>
      ),
    });
  }

  // Slide 4: Decisions
  if (data.decisions?.length) {
    slides.push({
      id: "decisions",
      title: isZh ? "设计决策" : "Decisions",
      icon: "⚖",
      content: (
        <div className="space-y-4">
          {data.decisions.map((d, i) => (
            <div key={i} className="rounded-lg border p-4" style={{ background: "var(--background)", borderColor: "var(--card-border)" }}>
              <div className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>{d.question}</div>
              <div className="flex gap-2 flex-wrap mb-2">
                {d.options.map((opt, j) => (
                  <span key={j} className={`text-xs px-3 py-1.5 rounded-full border ${opt === d.chosen ? "font-bold" : ""}`}
                    style={opt === d.chosen
                      ? { background: "rgba(34,197,94,0.15)", borderColor: "rgba(34,197,94,0.3)", color: "#86efac" }
                      : { background: "transparent", borderColor: "var(--card-border)", color: "var(--muted)" }
                    }>
                    {opt === d.chosen && "✓ "}{opt}
                  </span>
                ))}
              </div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>{d.rationale}</div>
            </div>
          ))}
        </div>
      ),
    });
  }

  // Slide 5: Risks
  if (data.risks?.length) {
    slides.push({
      id: "risks",
      title: isZh ? "风险评估" : "Risks",
      icon: "⚠",
      content: (
        <div className="space-y-3">
          {data.risks.map((r, i) => {
            const s = severityColors[r.severity] || severityColors.low;
            return (
              <div key={i} className="flex items-start gap-3 rounded-lg border px-4 py-3"
                style={{ background: s.bg, borderColor: s.border }}>
                <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ background: s.dot }} />
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ color: s.text }}>{r.risk}</div>
                  <div className="text-xs mt-1" style={{ color: s.text, opacity: 0.7 }}>{r.mitigation}</div>
                </div>
                <span className="text-[10px] uppercase px-2 py-0.5 rounded shrink-0" style={{ background: s.border, color: s.text }}>{r.severity}</span>
              </div>
            );
          })}
        </div>
      ),
    });
  }

  const slide = slides[currentSlide] || slides[0];
  const slideFindings = findingsFor(slide.id);

  return (
    <div>
      {/* Slide navigation dots */}
      <div className="flex items-center justify-center gap-1.5 mb-4">
        {slides.map((s, i) => (
          <button key={s.id} onClick={() => setCurrentSlide(i)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
            style={i === currentSlide
              ? { background: "var(--foreground)", color: "var(--background)" }
              : { background: "var(--card)", color: "var(--muted)", border: "1px solid var(--card-border)" }
            }
            title={s.title}>
            <span>{s.icon}</span>
            <span className={i === currentSlide ? "" : "hidden sm:inline"}>{s.title}</span>
          </button>
        ))}
      </div>

      {/* Slide content */}
      <div className="rounded-xl border p-6 min-h-[300px]" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        {slide.content}
      </div>

      {/* Findings for current slide */}
      {slideFindings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {slideFindings.map(f => (
            <FindingChip key={f.id} f={f} isZh={isZh}
              onApprove={() => handleResolution(f.id, "approved")}
              onReject={() => handleResolution(f.id, "rejected")} />
          ))}
        </div>
      )}

      {/* Left/Right navigation */}
      <div className="flex items-center justify-between mt-3">
        <button onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))} disabled={currentSlide === 0}
          className="text-xs px-3 py-1.5 rounded-md disabled:opacity-30"
          style={{ color: "var(--muted)", background: "var(--card)", border: "1px solid var(--card-border)" }}>
          ← {isZh ? "上一页" : "Prev"}
        </button>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{currentSlide + 1} / {slides.length}</span>
        <button onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))} disabled={currentSlide === slides.length - 1}
          className="text-xs px-3 py-1.5 rounded-md disabled:opacity-30"
          style={{ color: "var(--muted)", background: "var(--card)", border: "1px solid var(--card-border)" }}>
          {isZh ? "下一页" : "Next"} →
        </button>
      </div>
    </div>
  );
}
