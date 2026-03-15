"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SchemeCard } from "./scheme-card";
import { CreateSchemeDialog } from "./create-scheme-dialog";
import { GenerateSchemeDialog } from "./generate-scheme-dialog";
import { ReviewPanel } from "@/components/review/review-panel";

interface Scheme {
  id: string;
  planId: string;
  title: string;
  content: string | null;
  sourceType: string;
  updatedAt: string;
  createdAt: string;
}

interface SchemeListProps {
  planId: string;
  planStatus: string;
  onPlanStatusChange: () => void;
}

export function SchemeList({
  planId,
  planStatus,
  onPlanStatusChange,
}: SchemeListProps) {
  const t = useTranslations();
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const readonly = [
    "confirmed",
    "scheduled",
    "executing",
    "testing",
    "completed",
  ].includes(planStatus);

  const fetchSchemes = async () => {
    const res = await fetch(`/api/schemes?planId=${planId}`);
    const data = await res.json();
    setSchemes(data);
  };

  useEffect(() => {
    fetchSchemes();
  }, [planId]);

  const handleCreate = async (data: { title: string; content: string }) => {
    await fetch("/api/schemes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, planId, sourceType: "manual" }),
    });
    fetchSchemes();
    onPlanStatusChange();
  };

  const handleUpdate = async (
    id: string,
    data: { title: string; content: string }
  ) => {
    await fetch(`/api/schemes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    fetchSchemes();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/schemes/${id}`, { method: "DELETE" });
    fetchSchemes();
  };

  const handleConfirm = async () => {
    await fetch(`/api/plans/${planId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm" }),
    });
    onPlanStatusChange();
  };

  const handleRevoke = async () => {
    await fetch(`/api/plans/${planId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke" }),
    });
    onPlanStatusChange();
  };

  const handleGenerate = async (provider: string, skills: string[]) => {
    setGenerating(true);
    setGenerateDialogOpen(false);
    try {
      await fetch("/api/schemes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, provider, skills }),
      });
      await fetchSchemes();
      onPlanStatusChange();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t("scheme.title")}</h3>
        <div className="flex gap-2">
          {!readonly && (
            <>
              <Button
                variant="secondary"
                onClick={() => setGenerateDialogOpen(true)}
                disabled={generating}
              >
                {generating ? t("common.loading") : t("scheme.generate")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDialogOpen(true)}
              >
                {t("scheme.create")}
              </Button>
              {planStatus === "reviewing" && schemes.length > 0 && (
                <Button onClick={handleConfirm}>
                  {t("scheme.confirmSchemes")}
                </Button>
              )}
            </>
          )}
          {planStatus === "confirmed" && (
            <Button variant="secondary" onClick={handleRevoke}>
              {t("scheme.revokeConfirm")}
            </Button>
          )}
        </div>
      </div>

      {readonly && planStatus === "confirmed" && (
        <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-700">
          {t("scheme.confirmed")}
        </div>
      )}

      {schemes.length === 0 ? (
        <p className="text-gray-500 text-center py-8">
          {t("common.noData")}
        </p>
      ) : (
        <div className="space-y-4">
          {schemes.map((scheme) => (
            <SchemeCard
              key={scheme.id}
              scheme={scheme}
              readonly={readonly}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Scheme Review */}
      {schemes.length > 0 && (
        <div className="mt-6 border-t pt-6">
          <ReviewPanel
            planId={planId}
            type="scheme"
            planStatus={planStatus}
            onPlanStatusChange={onPlanStatusChange}
          />
        </div>
      )}

      <CreateSchemeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreate}
      />

      <GenerateSchemeDialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        onGenerate={handleGenerate}
        generating={generating}
      />
    </div>
  );
}
