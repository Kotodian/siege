"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import {
  CheckCircleIcon,
  FileTextIcon,
  CalendarIcon,
  GlassesIcon,
  FlaskIcon,
  PackageIcon,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

// Tab content components
import { SchemeList } from "@/components/scheme/scheme-list";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { TestView } from "@/components/test/test-view";
import { ReviewPanel } from "@/components/review/review-panel";
import { PublishView } from "@/components/plan/publish-view";
import { apiFetch } from "@/lib/api";

interface Plan {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  tag: string | null;
}

// ── Sidebar navigation items ──

interface NavItem {
  id: string;
  labelZh: string;
  labelEn: string;
  icon: (props: IconProps) => React.ReactNode;
  enabledStatuses: string[];
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "schemes",
    labelZh: "方案",
    labelEn: "Scheme",
    icon: FileTextIcon,
    enabledStatuses: ["draft", "reviewing", "confirmed", "scheduled", "executing", "code_review", "testing", "completed"],
  },
  {
    id: "schedule",
    labelZh: "排期",
    labelEn: "Schedule",
    icon: CalendarIcon,
    enabledStatuses: ["confirmed", "scheduled", "executing", "code_review", "testing", "completed"],
  },
  {
    id: "code_review",
    labelZh: "审查",
    labelEn: "Review",
    icon: GlassesIcon,
    enabledStatuses: ["executing", "code_review", "testing", "completed"],
  },
  {
    id: "tests",
    labelZh: "测试",
    labelEn: "Tests",
    icon: FlaskIcon,
    enabledStatuses: ["executing", "code_review", "testing", "completed"],
  },
  {
    id: "publish",
    labelZh: "发布",
    labelEn: "Publish",
    icon: PackageIcon,
    enabledStatuses: ["executing", "code_review", "testing", "completed"],
  },
];

// Maps plan status to the "done" threshold for each nav item
const DONE_STATUSES: Record<string, string[]> = {
  schemes: ["confirmed", "scheduled", "executing", "code_review", "testing", "completed"],
  schedule: ["scheduled", "executing", "code_review", "testing", "completed"],
  code_review: ["testing", "completed"],
  tests: ["completed"],
  publish: ["completed"],
};

function getActiveNavId(status: string): string {
  switch (status) {
    case "draft":
    case "reviewing":
      return "schemes";
    case "confirmed":
      return "schedule";
    case "scheduled":
    case "executing":
      return "schedule";
    case "code_review":
      return "code_review";
    case "testing":
      return "tests";
    case "completed":
      return "schemes";
    default:
      return "schemes";
  }
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
  const [activeNav, setActiveNav] = useState<string>("schemes");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);

  const isZh = t("common.back") === "返回";

  const fetchPlan = async () => {
    const res = await apiFetch(`/api/plans/${planId}`);
    const data = await res.json();
    setPlan(data);
  };

  useEffect(() => {
    fetchPlan();
  }, [planId]);

  // Set active nav based on plan status when plan loads
  useEffect(() => {
    if (plan) {
      setActiveNav(getActiveNavId(plan.status));
    }
  }, [plan?.status]);

  const startEdit = () => {
    if (!plan) return;
    setEditName(plan.name);
    setEditDesc(plan.description || "");
    setEditing(true);
  };

  const saveEdit = async () => {
    await apiFetch(`/api/plans/${planId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc }),
    });
    setEditing(false);
    await fetchPlan();
  };

  if (!plan) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <p style={{ color: "var(--outline)" }}>{t("common.loading")}</p>
      </div>
    );
  }

  // Render tab content based on active nav
  const renderContent = () => {
    switch (activeNav) {
      case "schemes":
        return (
          <SchemeList
            planId={plan.id}
            planStatus={plan.status}
            onPlanStatusChange={fetchPlan}
          />
        );
      case "schedule":
        return (
          <ScheduleView
            planId={plan.id}
            planStatus={plan.status}
            projectId={projectId}
            onPlanStatusChange={fetchPlan}
          />
        );
      case "code_review":
        return (
          <ReviewPanel
            planId={plan.id}
            type="implementation"
            planStatus={plan.status}
            onPlanStatusChange={fetchPlan}
          />
        );
      case "tests":
        return (
          <TestView
            planId={plan.id}
            planStatus={plan.status}
            onPlanStatusChange={fetchPlan}
          />
        );
      case "publish":
        return <PublishView planId={plan.id} projectId={projectId} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-[calc(100vh-48px)]" style={{ maxWidth: "min(90vw, 1800px)", margin: "0 auto" }}>
      {/* ── Left Sidebar ── */}
      <aside
        className="w-[220px] shrink-0 flex flex-col overflow-y-auto"
        style={{ background: "var(--surface-container-low)" }}
      >
        {/* Plan Info Card */}
        <div className="p-4 pb-2">
          <a
            href={`/${locale}/projects/${projectId}`}
            className="text-xs inline-flex items-center gap-1 mb-3 transition-colors"
            style={{ color: "var(--outline)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--outline)")}
          >
            <span>&larr;</span> {isZh ? "返回项目" : "Back to project"}
          </a>

          {editing ? (
            <div className="space-y-2">
              <Input
                label={t("plan.name")}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <textarea
                className="w-full rounded-md px-2.5 py-1.5 text-xs focus:outline-none min-h-[60px] resize-none"
                style={{ background: "var(--surface-container)", color: "var(--on-surface)" }}
                placeholder={isZh ? "描述" : "Description"}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </Button>
                <Button size="sm" onClick={saveEdit}>{t("common.save")}</Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-2">
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: "var(--primary-container)" }}
                >
                  <FileTextIcon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    className="text-sm font-semibold leading-tight truncate"
                    style={{ fontFamily: "var(--font-heading), system-ui" }}
                    title={plan.name}
                  >
                    {plan.name}
                  </h2>
                  <div className="mt-1">
                    <StatusBadge
                      status={plan.status}
                      label={t(`plan.status.${plan.status}`)}
                    />
                  </div>
                </div>
              </div>
              {plan.description && (
                <div className="mt-2 text-xs line-clamp-3" style={{ color: "var(--on-surface-variant)" }}>
                  <MarkdownRenderer content={plan.description} />
                </div>
              )}
              <button
                onClick={startEdit}
                className="text-[11px] mt-2 transition-colors"
                style={{ color: "var(--outline)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--outline)")}
              >
                {t("common.edit")}
              </button>
            </div>
          )}
        </div>

        {/* Divider via background shift */}
        <div className="mx-4 my-2 h-px" style={{ background: "var(--outline-variant)", opacity: 0.2 }} />

        {/* Navigation Items */}
        <nav className="flex-1 px-2 py-1">
          {NAV_ITEMS.map((item) => {
            const isEnabled = item.enabledStatuses.includes(plan.status);
            const isActive = activeNav === item.id;
            const isDone = DONE_STATUSES[item.id]?.includes(plan.status) ?? false;
            const ItemIcon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => isEnabled && setActiveNav(item.id)}
                disabled={!isEnabled}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-all mb-0.5
                  ${!isEnabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
                style={
                  isActive
                    ? { background: "var(--surface-container-high)", color: "var(--primary)" }
                    : isDone
                      ? { color: "var(--success)" }
                      : { color: "var(--on-surface-variant)" }
                }
                onMouseEnter={(e) => {
                  if (isEnabled && !isActive) {
                    e.currentTarget.style.background = "var(--surface-container)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <ItemIcon size={16} />
                <span>{isZh ? item.labelZh : item.labelEn}</span>
                {isDone && <span className="ml-auto text-[10px]">✓</span>}
                {isActive && !isDone && (
                  <span
                    className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: "var(--primary)" }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="p-3 mt-auto space-y-2">
          {plan.status !== "completed" && plan.status !== "draft" && (
            <button
              onClick={() => setCompleteDialogOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors"
              style={{
                background: "var(--surface-container-high)",
                color: "var(--on-surface-variant)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--success-container)";
                e.currentTarget.style.color = "var(--success)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--surface-container-high)";
                e.currentTarget.style.color = "var(--on-surface-variant)";
              }}
            >
              <CheckCircleIcon size={14} />
              {isZh ? "完成计划" : "Complete Plan"}
            </button>
          )}
          {plan.status === "completed" && (
            <div
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium"
              style={{ background: "var(--success-container)", color: "var(--success)" }}
            >
              <CheckCircleIcon size={14} />
              {isZh ? "已归档" : "Archived"}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-y-auto" style={{ background: "var(--background)" }}>
        <div className="px-10 py-6">
          {renderContent()}
        </div>
      </div>

      {/* ── Complete Confirmation Dialog ── */}
      <Dialog
        open={completeDialogOpen}
        onClose={() => { if (!completing) setCompleteDialogOpen(false); }}
        title={completed
          ? (isZh ? "计划已完成" : "Plan Completed")
          : (isZh ? "完成计划" : "Complete Plan")}
      >
        {completed ? (
          <div className="text-center space-y-4 py-4">
            <span className="mx-auto block w-fit" style={{ color: "var(--success)" }}>
              <CheckCircleIcon size={48} />
            </span>
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
                    await apiFetch(`/api/plans/${planId}`, {
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
