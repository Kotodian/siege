"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { VersionTimeline } from "./version-timeline";
import { VersionDiffPanel } from "./version-diff-panel";

interface Version {
  id: string;
  schemeId: string;
  version: number;
  title: string;
  content: string | null;
  createdAt: string;
}

interface SchemeVersionsProps {
  schemeId: string;
  currentContent: string;
  open: boolean;
  onClose: () => void;
  onRestore: (content: string) => void;
}

export function SchemeVersions({
  schemeId,
  currentContent,
  open,
  onClose,
  onRestore,
}: SchemeVersionsProps) {
  const t = useTranslations("scheme.versions");
  const tc = useTranslations("common");
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      fetch(`/api/schemes/${schemeId}/versions`)
        .then((r) => r.json())
        .then((data: Version[]) => {
          setVersions(data);
          if (data.length > 0) {
            setSelectedVersion(data[0].version);
          }
        })
        .catch(() => {});
    }
  }, [open, schemeId]);

  const selected = versions.find((v) => v.version === selectedVersion);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("title")}
      maxWidth="max-w-4xl"
    >
      {versions.length === 0 ? (
        <p className="text-sm text-center py-12" style={{ color: "var(--outline)" }}>
          {t("noVersions")}
        </p>
      ) : (
        <div className="flex gap-0 -mx-6 -mb-6 min-h-[420px]">
          {/* Left: Timeline + Restore */}
          <div className="w-56 shrink-0 border-r rounded-bl-lg flex flex-col" style={{ background: "var(--background)", borderColor: "var(--outline-variant)" }}>
            <div className="flex-1 overflow-y-auto p-3">
              <VersionTimeline
                versions={versions}
                selectedVersion={selectedVersion}
                onSelect={setSelectedVersion}
              />
            </div>
            {selected && (
              <div className="p-3 border-t space-y-2" style={{ borderColor: "var(--outline-variant)" }}>
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => {
                    if (selected.content) {
                      onRestore(selected.content);
                      onClose();
                    }
                  }}
                >
                  {t("restoreTo", { version: selected.version })}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  size="sm"
                  onClick={onClose}
                >
                  {tc("cancel")}
                </Button>
              </div>
            )}
          </div>

          {/* Right: Diff panel */}
          <div className="flex-1 p-4 overflow-hidden">
            {selected ? (
              <VersionDiffPanel
                oldContent={selected.content || ""}
                newContent={currentContent}
                oldLabel={`v${selected.version}`}
                newLabel={t("current")}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm" style={{ color: "var(--outline)" }}>
                {t("diffWith")}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
