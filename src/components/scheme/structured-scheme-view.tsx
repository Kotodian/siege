"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { StructuredScheme } from "@/lib/scheme-types";
import hljs from "highlight.js";

const severityColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  high: { bg: "#3a1a1a", border: "#7f1d1d", text: "#fca5a5", badge: "🔴" },
  medium: { bg: "#3a2a1a", border: "#78350f", text: "#fcd34d", badge: "🟡" },
  low: { bg: "#1a2a3a", border: "#1e3a5f", text: "#93c5fd", badge: "🟢" },
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

export function StructuredSchemeView({ data, schemeId, findings = [], onFindingsChanged }: StructuredSchemeViewProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [expandedSection, setExpandedSection] = useState<string | null>("architecture");

  const findingsFor = (targetPrefix: string) =>
    findings.filter(f => f.targetId?.startsWith(`${schemeId}:${targetPrefix}`));

  const handleApprove = async (f: Finding) => {
    await fetch(`/api/review-items/${f.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "approved", resolved: false }),
    });
    onFindingsChanged?.();
  };

  const handleReject = async (f: Finding) => {
    await fetch(`/api/review-items/${f.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "rejected", resolved: true }),
    });
    onFindingsChanged?.();
  };

  const FindingBadges = ({ items }: { items: Finding[] }) => {
    const unresolved = items.filter(f => !f.resolved);
    if (unresolved.length === 0) return null;
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "#7f1d1d", color: "#fca5a5" }}>
        {unresolved.length}
      </span>
    );
  };

  const FindingsList = ({ items }: { items: Finding[] }) => {
    if (items.length === 0) return null;
    return (
      <div className="mt-3 space-y-2">
        {items.map(f => {
          const s = severityColors[f.severity] || severityColors.low;
          const isRejected = f.resolution === "rejected";
          return (
            <div key={f.id} className={`rounded-md border px-3 py-2 text-xs ${isRejected ? "opacity-30" : ""}`}
              style={{ background: s.bg, borderColor: s.border, color: s.text }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium min-w-0">
                  <span className="uppercase text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: s.border }}>{f.severity}</span>
                  <span className="truncate">{f.title}</span>
                  {f.resolution && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{
                      background: f.resolution === "approved" ? "rgba(234,179,8,0.2)" : "rgba(107,114,128,0.2)",
                      color: f.resolution === "approved" ? "#fcd34d" : "#9ca3af",
                    }}>{f.resolution === "approved" ? (isZh ? "已认可" : "Approved") : (isZh ? "已驳回" : "Rejected")}</span>
                  )}
                </div>
                {!f.resolution && !f.resolved && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleApprove(f)} className="px-2 py-0.5 rounded text-[10px] font-medium hover:opacity-80"
                      style={{ background: "rgba(34,197,94,0.2)", color: "#86efac" }}>{isZh ? "认可" : "Approve"}</button>
                    <button onClick={() => handleReject(f)} className="px-2 py-0.5 rounded text-[10px] font-medium hover:opacity-80"
                      style={{ background: "rgba(107,114,128,0.2)", color: "#9ca3af" }}>{isZh ? "驳回" : "Reject"}</button>
                  </div>
                )}
              </div>
              {f.content && <div className="mt-1 opacity-90 text-xs">{f.content}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const Section = ({ id, title, badge, children }: { id: string; title: string; badge?: React.ReactNode; children: React.ReactNode }) => {
    const isOpen = expandedSection === id;
    const sectionFindings = findingsFor(id);
    return (
      <div className="border-b last:border-b-0" style={{ borderColor: "var(--card-border)" }}>
        <button onClick={() => setExpandedSection(isOpen ? null : id)}
          className="w-full text-left px-4 py-3 flex items-center justify-between hover:opacity-80"
          style={{ background: isOpen ? "var(--background)" : undefined }}>
          <span className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            {badge}
            <FindingBadges items={sectionFindings} />
          </span>
          <svg className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} style={{ color: "var(--muted)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div className="px-4 pb-4">
            {children}
            <FindingsList items={sectionFindings} />
          </div>
        )}
      </div>
    );
  };

  const totalHours = data.effort?.reduce((sum, e) => sum + (e.hours || 0), 0) || 0;

  return (
    <div className="space-y-0">
      {/* Overview — always visible */}
      <div className="px-4 py-3 text-sm" style={{ color: "var(--foreground)" }}>
        {data.overview}
      </div>

      <div className="border rounded-lg" style={{ borderColor: "var(--card-border)" }}>
        {/* Architecture */}
        <Section id="architecture" title={isZh ? "架构" : "Architecture"}
          badge={<span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--card-border)" }}>{data.architecture?.components?.length || 0} {isZh ? "组件" : "components"}</span>}>
          {data.architecture?.components?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--muted)" }}>{isZh ? "组件" : "Component"}</th>
                    <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--muted)" }}>{isZh ? "职责" : "Responsibility"}</th>
                    <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--muted)" }}>{isZh ? "依赖" : "Dependencies"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.architecture.components.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <td className="px-2 py-1.5 font-mono font-medium" style={{ color: "var(--foreground)" }}>{c.name}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--foreground)" }}>{c.responsibility}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]" style={{ color: "var(--muted)" }}>{c.dependencies?.join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.architecture?.dataFlow?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>{isZh ? "数据流" : "Data Flow"}</div>
              <div className="space-y-1">
                {data.architecture.dataFlow.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ background: "var(--card-border)", color: "var(--foreground)" }}>{i + 1}</span>
                    <span style={{ color: "var(--foreground)" }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.architecture?.diagram && (
            <pre className="mt-3 text-xs p-3 rounded overflow-x-auto" style={{ background: "var(--background)", color: "var(--muted)" }}>
              {data.architecture.diagram}
            </pre>
          )}
        </Section>

        {/* Interfaces */}
        {data.interfaces?.length > 0 && (
          <Section id="interfaces" title={isZh ? "接口定义" : "Interfaces"}
            badge={<span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--card-border)" }}>{data.interfaces.length}</span>}>
            <div className="space-y-3">
              {data.interfaces.map((iface, i) => {
                let highlighted = iface.definition;
                try {
                  const lang = iface.language || "plaintext";
                  highlighted = hljs.highlight(iface.definition, { language: hljs.getLanguage(lang) ? lang : "plaintext" }).value;
                } catch { /* fallback */ }
                return (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-medium text-sm" style={{ color: "var(--foreground)" }}>{iface.name}</span>
                      {iface.language && <span className="text-[10px] px-1 rounded" style={{ background: "var(--card-border)", color: "var(--muted)" }}>{iface.language}</span>}
                    </div>
                    <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{iface.description}</div>
                    <pre className="text-xs p-3 rounded overflow-x-auto" style={{ background: "var(--background)" }}>
                      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                    </pre>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Decisions */}
        {data.decisions?.length > 0 && (
          <Section id="decisions" title={isZh ? "设计决策" : "Decisions"}
            badge={<span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--card-border)" }}>{data.decisions.length}</span>}>
            <div className="space-y-3">
              {data.decisions.map((d, i) => (
                <div key={i} className="rounded-md border p-3" style={{ background: "var(--background)", borderColor: "var(--card-border)" }}>
                  <div className="text-sm font-medium mb-2" style={{ color: "var(--foreground)" }}>{d.question}</div>
                  <div className="space-y-1">
                    {d.options.map((opt, j) => (
                      <div key={j} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${opt === d.chosen ? "font-medium" : ""}`}
                        style={opt === d.chosen ? { background: "rgba(34,197,94,0.1)", color: "#86efac" } : { color: "var(--muted)" }}>
                        {opt === d.chosen ? <span>✓</span> : <span className="w-3" />}
                        {opt}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{d.rationale}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Risks */}
        {data.risks?.length > 0 && (
          <Section id="risks" title={isZh ? "风险" : "Risks"}
            badge={<span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--card-border)" }}>
              {data.risks.filter(r => r.severity === "high").length > 0
                ? `${data.risks.filter(r => r.severity === "high").length} ${isZh ? "高风险" : "high"}`
                : `${data.risks.length}`}
            </span>}>
            <div className="space-y-2">
              {data.risks.map((r, i) => {
                const s = severityColors[r.severity] || severityColors.low;
                return (
                  <div key={i} className="flex items-start gap-3 rounded-md border px-3 py-2 text-xs"
                    style={{ background: s.bg, borderColor: s.border, color: s.text }}>
                    <span className="shrink-0 text-sm">{s.badge}</span>
                    <div>
                      <div className="font-medium">{r.risk}</div>
                      <div className="mt-1 opacity-80">{isZh ? "缓解：" : "Mitigation: "}{r.mitigation}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Effort */}
        {data.effort?.length > 0 && (
          <Section id="effort" title={isZh ? "工作量" : "Effort"}
            badge={<span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--card-border)" }}>{totalHours}h</span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--muted)" }}>{isZh ? "阶段" : "Phase"}</th>
                    <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--muted)" }}>{isZh ? "任务" : "Tasks"}</th>
                    <th className="text-right px-2 py-1.5 font-medium" style={{ color: "var(--muted)" }}>{isZh ? "小时" : "Hours"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.effort.map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <td className="px-2 py-1.5 font-medium" style={{ color: "var(--foreground)" }}>{e.phase}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--muted)" }}>{e.tasks.join(", ")}</td>
                      <td className="px-2 py-1.5 text-right font-mono" style={{ color: "var(--foreground)" }}>{e.hours}h</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-2 py-1.5 font-bold" style={{ color: "var(--foreground)" }}>{isZh ? "合计" : "Total"}</td>
                    <td />
                    <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: "var(--foreground)" }}>{totalHours}h</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
