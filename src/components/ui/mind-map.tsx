"use client";

import { useState } from "react";
import type { StructuredScheme } from "@/lib/scheme-types";

interface MindMapProps {
  data: StructuredScheme;
  locale?: string;
  onNavigate?: (slideId: string) => void;
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  high:   { bg: "rgba(255,180,171,0.15)", border: "rgba(255,180,171,0.4)", text: "#ffb4ab" },
  medium: { bg: "rgba(253,224,71,0.12)", border: "rgba(253,224,71,0.3)", text: "#fde047" },
  low:    { bg: "rgba(192,193,255,0.12)", border: "rgba(192,193,255,0.3)", text: "#c0c1ff" },
};

interface BranchDef {
  key: string;
  slideId: string;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  items: Array<{ label: string; sub?: string; severity?: string }>;
}

export function MindMap({ data, locale = "en", onNavigate }: MindMapProps) {
  const isZh = locale === "zh";
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);

  const branches: BranchDef[] = [];

  if (data.architecture?.components?.length) {
    branches.push({
      key: "architecture", slideId: "architecture",
      label: isZh ? "架构组件" : "Architecture",
      color: "#c0c1ff", bgColor: "rgba(192,193,255,0.08)", borderColor: "rgba(192,193,255,0.2)",
      items: data.architecture.components.map(c => ({ label: c.name, sub: c.responsibility })),
    });
  }
  if (data.interfaces?.length) {
    branches.push({
      key: "interfaces", slideId: "interfaces",
      label: isZh ? "接口定义" : "Interfaces",
      color: "#ffb783", bgColor: "rgba(255,183,131,0.08)", borderColor: "rgba(255,183,131,0.2)",
      items: data.interfaces.map(i => ({ label: i.name, sub: `${i.language} — ${i.description}` })),
    });
  }
  if (data.decisions?.length) {
    branches.push({
      key: "decisions", slideId: "decisions",
      label: isZh ? "设计决策" : "Decisions",
      color: "#ddb7ff", bgColor: "rgba(221,183,255,0.08)", borderColor: "rgba(221,183,255,0.2)",
      items: data.decisions.map(d => ({ label: d.chosen, sub: d.question })),
    });
  }
  if (data.risks?.length) {
    branches.push({
      key: "risks", slideId: "risks",
      label: isZh ? "风险评估" : "Risks",
      color: "#fde047", bgColor: "rgba(253,224,71,0.08)", borderColor: "rgba(253,224,71,0.2)",
      items: data.risks.map(r => ({ label: r.risk, sub: r.mitigation, severity: r.severity })),
    });
  }

  if (branches.length === 0) return null;

  return (
    <div>
      {/* Root: Overview */}
      <div
        className="rounded-xl p-4 mb-4 cursor-pointer transition-all hover:opacity-90"
        style={{
          background: "linear-gradient(135deg, rgba(128,131,255,0.12), rgba(192,193,255,0.06))",
          border: "1.5px solid rgba(128,131,255,0.35)",
          boxShadow: "0 0 16px rgba(128,131,255,0.08)",
        }}
        onClick={() => onNavigate?.("overview")}
      >
        <div className="text-sm font-bold mb-1" style={{ color: "#c0c1ff" }}>
          {isZh ? "方案概述" : "Overview"}
        </div>
        <div className="text-xs leading-relaxed" style={{ color: "var(--on-surface-variant)" }}>
          {data.overview}
        </div>
      </div>

      {/* Branches */}
      <div className="space-y-2">
        {branches.map((branch) => {
          const isExpanded = expandedBranch === branch.key;
          return (
            <div key={branch.key}>
              {/* Branch header */}
              <button
                className="w-full rounded-lg px-4 py-3 flex items-center justify-between transition-all hover:opacity-90"
                style={{
                  background: branch.bgColor,
                  border: `1px solid ${branch.borderColor}`,
                  borderLeft: `4px solid ${branch.color}`,
                }}
                onClick={() => setExpandedBranch(prev => prev === branch.key ? null : branch.key)}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-[10px] transition-transform inline-block"
                    style={{ color: branch.color, transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                  >
                    ▶
                  </span>
                  <span className="text-sm font-semibold" style={{ color: branch.color }}>
                    {branch.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold min-w-[20px] h-5 rounded-full flex items-center justify-center"
                    style={{ background: branch.color, color: "#0e0e0e" }}
                  >
                    {branch.items.length}
                  </span>
                  <span
                    className="text-[10px] cursor-pointer hover:underline"
                    style={{ color: branch.color }}
                    onClick={(e) => { e.stopPropagation(); onNavigate?.(branch.slideId); }}
                  >
                    {isZh ? "详情 →" : "Details →"}
                  </span>
                </div>
              </button>

              {/* Leaf items */}
              {isExpanded && (
                <div className="ml-6 mt-1 space-y-1 border-l-2 pl-3 pb-1" style={{ borderColor: `${branch.color}30` }}>
                  {branch.items.map((item, li) => {
                    const sev = item.severity ? SEVERITY_STYLES[item.severity] : null;
                    return (
                      <div
                        key={li}
                        className="rounded-md px-3 py-2 cursor-pointer transition-all hover:translate-x-1"
                        style={{
                          background: sev ? sev.bg : "var(--surface-container)",
                          borderLeft: `3px solid ${sev ? sev.text : branch.color}`,
                        }}
                        onClick={() => onNavigate?.(branch.slideId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium" style={{ color: sev ? sev.text : "var(--on-surface)" }}>
                            {item.label}
                          </span>
                          {item.severity && (
                            <span
                              className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold shrink-0"
                              style={{ background: sev?.border, color: sev?.text }}
                            >
                              {item.severity}
                            </span>
                          )}
                        </div>
                        {item.sub && (
                          <div className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--on-surface-variant)" }}>
                            {item.sub}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
