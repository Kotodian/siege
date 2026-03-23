"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { PlanTabs } from "@/components/plan/plan-tabs";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { CheckCircleIcon } from "@/components/ui/icons";

interface Plan {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  tag: string | null;
}

const WORKFLOW_STEPS = [
  { key: "scheme", statusBefore: ["draft", "reviewing"], statusDone: ["confirmed", "scheduled", "executing", "code_review", "testing", "completed"] },
  { key: "schedule", statusBefore: ["draft", "reviewing", "confirmed"], statusDone: ["scheduled", "executing", "code_review", "testing", "completed"] },
  { key: "execute", statusBefore: ["draft", "reviewing", "confirmed", "scheduled"], statusDone: ["code_review", "testing", "completed"] },
  { key: "review", statusBefore: ["draft", "reviewing", "confirmed", "scheduled", "executing"], statusDone: ["testing", "completed"] },
  { key: "test", statusBefore: ["draft", "reviewing", "confirmed", "scheduled", "executing", "code_review"], statusDone: ["completed"] },
];

const STEP_LABELS: Record<string, { zh: string; en: string; hint_zh: string; hint_en: string }> = {
  scheme: { zh: "方案", en: "Scheme", hint_zh: "生成并确认技术方案", hint_en: "Generate & confirm scheme" },
  schedule: { zh: "排期", en: "Schedule", hint_zh: "生成任务排期", hint_en: "Generate task schedule" },
  execute: { zh: "执行", en: "Execute", hint_zh: "执行开发任务", hint_en: "Execute dev tasks" },
  review: { zh: "审查", en: "Review", hint_zh: "代码审查", hint_en: "Code review" },
  test: { zh: "测试", en: "Test", hint_zh: "运行测试", hint_en: "Run tests" },
};

// Maps plan status to the active workflow step key
function getActiveStep(status: string): string {
  switch (status) {
    case "draft": case "reviewing": return "scheme";
    case "confirmed": return "schedule";
    case "scheduled": case "executing": return "execute";
    case "code_review": return "review";
    case "testing": return "test";
    case "completed": return "done";
    default: return "scheme";
  }
}

function WorkflowSteps({ status, isZh }: { status: string; isZh: boolean }) {
  const activeStep = getActiveStep(status);

  return (
    <div className="mb-5 flex items-center gap-1 overflow-x-auto py-2">
      {WORKFLOW_STEPS.map((step, i) => {
        const label = STEP_LABELS[step.key];
        const isDone = step.statusDone.includes(status);
        const isActive = activeStep === step.key;
        const isPending = !isDone && !isActive;

        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <div
                className="w-6 h-px mx-1"
                style={{ background: isDone ? "var(--success)" : "var(--outline-variant)" }}
              />
            )}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap"
              style={
                isActive
                  ? { background: "var(--primary)", color: "var(--background)" }
                  : isDone
                    ? { background: "var(--success-container)", color: "var(--success)" }
                    : { background: "var(--surface-container)", color: "var(--outline)", borderColor: "var(--outline-variant)", borderWidth: 1, borderStyle: "solid" }
              }
              title={isZh ? label.hint_zh : label.hint_en}
            >
              {isDone && <span>✓</span>}
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
              <span>{isZh ? label.zh : label.en}</span>
            </div>
          </div>
        );
      })}
      {status === "completed" && (
        <div className="flex items-center">
          <div className="w-6 h-px mx-1" style={{ background: "var(--success)" }} />
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: "var(--success-container)", color: "var(--success)" }}>
            ✓ <span>{isZh ? "完成" : "Done"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlanDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string; planId: string }>;
}) {
  const { locale, projectId, planId } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);

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
          className="text-sm hover:underline"
          style={{ color: "var(--primary)" }}
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
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface-variant)" }}>
                {t("plan.description")}
              </label>
              <textarea
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none min-h-[80px]"
                style={{ borderColor: "var(--outline-variant)", background: "var(--surface-container)", color: "var(--on-surface)" }}
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
                className="text-xs px-2 py-1 rounded hover:opacity-80"
                style={{ color: "var(--outline)" }}
              >
                {t("common.edit")}
              </button>
              <div className="flex-1" />
              {plan.status !== "completed" && plan.status !== "draft" && (
                <Button size="sm" variant="secondary" onClick={() => setCompleteDialogOpen(true)}>
                  {isZh ? "完成" : "Complete"}
                </Button>
              )}
              {plan.status === "completed" && (
                <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--success-container)", color: "var(--success)" }}>
                  {isZh ? "已归档" : "Archived"}
                </span>
              )}
            </div>
            {plan.description && (
              <div className="mt-2">
                <MarkdownRenderer content={plan.description} />
              </div>
            )}
          </>
        )}
      </div>

      <WorkflowSteps status={plan.status} isZh={isZh} />

      <PlanTabs
        planId={plan.id}
        planStatus={plan.status}
        projectId={projectId}
        onPlanStatusChange={fetchPlan}
      />

      {/* Complete confirmation dialog */}
      <Dialog
        open={completeDialogOpen}
        onClose={() => { if (!completing) setCompleteDialogOpen(false); }}
        title={completed
          ? (isZh ? "计划已完成" : "Plan Completed")
          : (isZh ? "完成计划" : "Complete Plan")}
      >
        {completed ? (
          <div className="text-center space-y-4 py-4">
            <span className="mx-auto block w-fit" style={{ color: "var(--success)" }}><CheckCircleIcon size={48} /></span>
            <p className="text-sm" style={{ color: "var(--on-surface)" }}>
              {isZh
                ? "计划已标记为完成并进入归档状态。你可以在项目页面查看归档计划。"
                : "Plan has been marked as completed and archived. You can view archived plans on the project page."}
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={() => { setCompleteDialogOpen(false); setCompleted(false); }}>
                {isZh ? "留在此页" : "Stay Here"}
              </Button>
              <Button onClick={() => router.push(`/${locale}/projects/${projectId}`)}>
                {isZh ? "返回项目" : "Back to Project"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--on-surface)" }}>
              {isZh
                ? "确定将此计划标记为完成？完成后计划将进入归档状态。"
                : "Mark this plan as completed? It will be archived after completion."}
            </p>
            <ul className="text-xs space-y-1" style={{ color: "var(--on-surface-variant)" }}>
              <li>{isZh ? "• 所有排期任务将保持当前状态" : "• All scheduled tasks will keep their current status"}</li>
              <li>{isZh ? "• 审查和测试结果将被保留" : "• Review and test results will be preserved"}</li>
              <li>{isZh ? "• 归档后仍可查看，但不能修改" : "• You can still view but not edit after archiving"}</li>
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCompleteDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={async () => {
                  setCompleting(true);
                  try {
                    await fetch(`/api/plans/${planId}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "completed" }),
                    });
                    await fetchPlan();
                    setCompleted(true);
                  } catch { /* ignore */ }
                  setCompleting(false);
                }}
                disabled={completing}
              >
                {completing ? (isZh ? "处理中..." : "Processing...") : (isZh ? "确认完成" : "Confirm")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
