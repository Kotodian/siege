"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { computeDiff } from "@/lib/diff";

interface VersionDiffPanelProps {
  oldContent: string;
  newContent: string;
  oldLabel: string;
  newLabel: string;
}

export function VersionDiffPanel({
  oldContent,
  newContent,
  oldLabel,
  newLabel,
}: VersionDiffPanelProps) {
  const t = useTranslations("scheme.versions");

  const diffLines = useMemo(
    () => computeDiff(oldContent, newContent),
    [oldContent, newContent]
  );

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === "add") additions++;
      if (line.type === "remove") deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  const isIdentical = stats.additions === 0 && stats.deletions === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3" style={{ borderBottom: "1px solid var(--outline-variant)" }}>
        <div className="text-xs" style={{ color: "var(--outline)" }}>
          <span className="font-mono font-medium" style={{ color: "var(--on-surface)" }}>
            {oldLabel}
          </span>
          {" → "}
          <span className="font-mono font-medium" style={{ color: "var(--on-surface)" }}>
            {newLabel}
          </span>
        </div>
        {!isIdentical && (
          <div className="flex items-center gap-3 text-xs font-mono">
            <span style={{ color: "#4ade80" }}>
              {t("additions", { count: stats.additions })}
            </span>
            <span style={{ color: "#f87171" }}>
              {t("deletions", { count: stats.deletions })}
            </span>
          </div>
        )}
      </div>

      {/* Diff content */}
      {isIdentical ? (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--outline)" }}>
          {t("noDiff")}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto border rounded font-mono text-xs leading-relaxed"
          style={{ background: "var(--background)", borderColor: "var(--outline-variant)" }}>
          {diffLines.map((line, i) => (
            <div
              key={i}
              className="flex"
              style={{
                background: line.type === "add"
                  ? "rgba(74, 222, 128, 0.1)"
                  : line.type === "remove"
                    ? "rgba(248, 113, 113, 0.1)"
                    : undefined,
              }}
            >
              <span className="w-10 shrink-0 text-right pr-2 py-px select-none"
                style={{ color: "var(--outline)", borderRight: "1px solid var(--outline-variant)" }}>
                {line.oldLineNumber ?? ""}
              </span>
              <span className="w-10 shrink-0 text-right pr-2 py-px select-none"
                style={{ color: "var(--outline)", borderRight: "1px solid var(--outline-variant)" }}>
                {line.newLineNumber ?? ""}
              </span>
              <span
                className="w-5 shrink-0 text-center py-px select-none"
                style={{
                  color: line.type === "add" ? "#4ade80"
                    : line.type === "remove" ? "#f87171"
                    : "var(--outline-variant)",
                }}
              >
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span
                className="flex-1 py-px pr-3 whitespace-pre-wrap break-all"
                style={{
                  color: line.type === "add" ? "#4ade80"
                    : line.type === "remove" ? "#f87171"
                    : "var(--on-surface)",
                  textDecoration: line.type === "remove" ? "line-through" : undefined,
                }}
              >
                {line.text || " "}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
