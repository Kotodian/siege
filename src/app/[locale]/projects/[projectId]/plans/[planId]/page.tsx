"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/ui/status-badge";
import { PlanTabs } from "@/components/plan/plan-tabs";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Plan {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  tag: string | null;
}

export default function PlanDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string; planId: string }>;
}) {
  const { locale, projectId, planId } = use(params);
  const t = useTranslations();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const fetchPlan = async () => {
    const res = await fetch(`/api/plans/${planId}`);
    const data = await res.json();
    setPlan(data);
  };

  useEffect(() => {
    fetchPlan();
  }, [planId]);

  const startEdit = () => {
    if (!plan) return;
    setEditName(plan.name);
    setEditDesc(plan.description || "");
    setEditing(true);
  };

  const saveEdit = async () => {
    await fetch(`/api/plans/${planId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc }),
    });
    setEditing(false);
    await fetchPlan();
  };

  const isZh = t("common.back") === "返回";

  if (!plan) {
    return <p>{t("common.loading")}</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <a
          href={`/${locale}/projects/${projectId}`}
          className="text-sm text-blue-600 hover:underline"
        >
          &larr; {t("common.back")}
        </a>

        {editing ? (
          <div className="mt-2 space-y-3">
            <Input
              label={t("plan.name")}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("plan.description")}
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[80px]"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={saveEdit}>{t("common.save")}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mt-2">
              <h1 className="text-3xl font-bold">{plan.name}</h1>
              <StatusBadge
                status={plan.status}
                label={t(`plan.status.${plan.status}`)}
              />
              <button
                onClick={startEdit}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
              >
                {t("common.edit")}
              </button>
            </div>
            {plan.description && (
              <div className="mt-2">
                <MarkdownRenderer content={plan.description} />
              </div>
            )}
          </>
        )}
      </div>

      <PlanTabs
        planId={plan.id}
        planStatus={plan.status}
        projectId={projectId}
        onPlanStatusChange={fetchPlan}
      />
    </div>
  );
}
