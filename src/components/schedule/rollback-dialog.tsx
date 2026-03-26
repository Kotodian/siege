"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangleIcon } from "@/components/ui/icons";

interface FileInfo {
  filePath: string;
  action: "restore" | "delete" | "recreate";
  hasConflict: boolean;
}

interface DependentTask {
  taskId: string;
  title: string;
  order: number;
  overlappingFiles: string[];
}

interface PreflightResult {
  item: { id: string; title: string; order: number };
  files: FileInfo[];
  dependentTasks: DependentTask[];
  conflicts: Array<{ filePath: string }>;
}

interface RollbackDialogProps {
  open: boolean;
  itemId: string;
  itemTitle: string;
  itemOrder: number;
  onClose: () => void;
  onRollbackComplete: () => void;
}

export function RollbackDialog({ open, itemId, itemTitle, itemOrder, onClose, onRollbackComplete }: RollbackDialogProps) {
  const t = useTranslations("rollback");
  const tc = useTranslations("common");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && itemId) {
      setLoading(true);
      setError("");
      setPreflight(null);
      fetch("/api/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, dryRun: true }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) {
            setError(data.error || "Failed");
          } else {
            setPreflight(data);
          }
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [open, itemId]);

  const handleConfirm = async () => {
    setRolling(true);
    setError("");
    try {
      const res = await fetch("/api/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Rollback failed");
      } else {
        onRollbackComplete();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRolling(false);
    }
  };

  const actionLabel = (action: string) => {
    if (action === "delete") return t("delete");
    if (action === "recreate") return t("recreate");
    return t("restore");
  };

  const hasWarnings = preflight && (preflight.dependentTasks.length > 0 || preflight.conflicts.length > 0);

  return (
    <Dialog open={open} onClose={onClose} title={t("title")} maxWidth="max-w-2xl">
      <p className="text-sm mb-4" style={{ color: "var(--on-surface-variant)" }}>
        {t("description", { order: itemOrder, title: itemTitle })}
      </p>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 rounded-full" style={{ borderColor: "var(--outline-variant)", borderTopColor: "var(--primary)" }} />
        </div>
      )}

      {error && (
        <div className="p-3 rounded mb-4 text-sm" style={{ background: "var(--error-container)", color: "var(--error)" }}>
          {error}
        </div>
      )}

      {preflight && !loading && (
        <>
          {/* File list */}
          <div className="mb-4">
            <h4 className="text-sm font-medium mb-2">{t("files")} ({preflight.files.length})</h4>
            <div className="rounded overflow-hidden text-xs" style={{ background: "var(--surface-container)" }}>
              {preflight.files.map((f) => (
                <div
                  key={f.filePath}
                  className="flex items-center justify-between px-3 py-2 border-b last:border-b-0"
                  style={{ borderColor: "var(--outline-variant)" }}
                >
                  <code className="truncate flex-1 mr-2" style={{ color: "var(--on-surface)" }}>{f.filePath}</code>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.hasConflict && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "rgba(253,224,71,0.15)", color: "var(--warning)" }}>
                        {t("conflict")}
                      </span>
                    )}
                    <span className="text-[10px]" style={{ color: "var(--outline)" }}>{actionLabel(f.action)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Conflict warning */}
          {preflight.conflicts.length > 0 && (
            <div className="flex gap-2 p-3 rounded mb-3 text-sm" style={{ background: "rgba(253,224,71,0.08)", color: "var(--warning)" }}>
              <AlertTriangleIcon size={16} className="shrink-0 mt-0.5" />
              <span>{t("conflictWarning")}</span>
            </div>
          )}

          {/* Dependency warning */}
          {preflight.dependentTasks.length > 0 && (
            <div className="p-3 rounded mb-3 text-sm" style={{ background: "var(--error-container)", color: "var(--error)" }}>
              <div className="flex gap-2 mb-2">
                <AlertTriangleIcon size={16} className="shrink-0 mt-0.5" />
                <span>{t("dependencyWarning")}</span>
              </div>
              <ul className="ml-6 list-disc text-xs space-y-1">
                {preflight.dependentTasks.map((dt) => (
                  <li key={dt.taskId}>
                    #{dt.order} {dt.title} — {dt.overlappingFiles.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="ghost" onClick={onClose}>{tc("cancel")}</Button>
            <Button
              variant={hasWarnings ? "danger" : "primary"}
              onClick={handleConfirm}
              disabled={rolling}
            >
              {rolling ? t("loading") : t("confirm")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
