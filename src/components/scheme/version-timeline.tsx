"use client";

import { useTranslations } from "next-intl";
import { TimeAgo } from "@/components/ui/time-ago";

interface Version {
  id: string;
  version: number;
  title: string;
  createdAt: string;
}

interface VersionTimelineProps {
  versions: Version[];
  selectedVersion: number | null;
  onSelect: (version: number) => void;
}

export function VersionTimeline({
  versions,
  selectedVersion,
  onSelect,
}: VersionTimelineProps) {
  const t = useTranslations("scheme.versions");

  return (
    <div className="space-y-0">
      {/* Current version node */}
      <div className="flex items-start gap-3 pb-3">
        <div className="flex flex-col items-center">
          <div className="w-3 h-3 rounded-full bg-[var(--success)] ring-2 ring-green-900 shrink-0" />
          {versions.length > 0 && (
            <div className="w-0.5 flex-1 mt-1" style={{ background: "var(--outline-variant)" }} />
          )}
        </div>
        <div className="pb-1 -mt-0.5">
          <span className="text-xs font-medium text-[var(--success)]">
            {t("current")}
          </span>
        </div>
      </div>

      {/* Version nodes */}
      {versions.map((v, i) => {
        const isSelected = selectedVersion === v.version;
        const isLast = i === versions.length - 1;

        return (
          <button
            key={v.id}
            onClick={() => onSelect(v.version)}
            className="w-full text-left flex items-start gap-3 py-2 px-1 rounded transition-colors"
            style={{ background: isSelected ? "var(--outline-variant)" : undefined }}
          >
            <div className="flex flex-col items-center">
              <div
                className="w-3 h-3 rounded-full shrink-0 border-2"
                style={isSelected
                  ? { background: "var(--on-surface)", borderColor: "var(--on-surface)" }
                  : { background: "var(--surface-container-high)", borderColor: "var(--outline)" }
                }
              />
              {!isLast && (
                <div className="w-0.5 flex-1 mt-1 min-h-[16px]" style={{ background: "var(--outline-variant)" }} />
              )}
            </div>
            <div className="-mt-0.5 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-mono font-medium"
                  style={{ color: isSelected ? "var(--on-surface)" : "var(--outline)" }}
                >
                  v{v.version}
                </span>
                <span className="text-xs" style={{ color: "var(--outline)" }}>
                  <TimeAgo date={v.createdAt} />
                </span>
              </div>
              <div className="text-xs truncate mt-0.5" style={{ color: "var(--outline)" }}>
                {v.title}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
