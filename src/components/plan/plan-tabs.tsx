"use client";

import { useTranslations } from "next-intl";
import { Tabs } from "@/components/ui/tabs";
import { SchemeList } from "@/components/scheme/scheme-list";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { TestView } from "@/components/test/test-view";
import { ReviewPanel } from "@/components/review/review-panel";

interface PlanTabsProps {
  planId: string;
  planStatus: string;
  onPlanStatusChange: () => void;
}

export function PlanTabs({
  planId,
  planStatus,
  onPlanStatusChange,
}: PlanTabsProps) {
  const t = useTranslations();

  const tabs = [
    {
      id: "schemes",
      label: t("plan.tabs.schemes"),
      content: (
        <SchemeList
          planId={planId}
          planStatus={planStatus}
          onPlanStatusChange={onPlanStatusChange}
        />
      ),
    },
    {
      id: "schedule",
      label: t("plan.tabs.schedule"),
      content: (
        <ScheduleView
          planId={planId}
          planStatus={planStatus}
          onPlanStatusChange={onPlanStatusChange}
        />
      ),
      disabled: ![
        "confirmed",
        "scheduled",
        "executing",
        "code_review",
        "testing",
        "completed",
      ].includes(planStatus),
    },
    {
      id: "code_review",
      label: "Code Review",
      content: (
        <ReviewPanel
          planId={planId}
          type="implementation"
          planStatus={planStatus}
          onPlanStatusChange={onPlanStatusChange}
        />
      ),
      disabled: ![
        "executing",
        "code_review",
        "testing",
        "completed",
      ].includes(planStatus),
    },
    {
      id: "tests",
      label: t("plan.tabs.tests"),
      content: (
        <TestView
          planId={planId}
          planStatus={planStatus}
          onPlanStatusChange={onPlanStatusChange}
        />
      ),
      disabled: !["testing", "completed"].includes(planStatus),
    },
    {
      id: "logs",
      label: t("plan.tabs.logs"),
      content: (
        <p className="text-gray-500 py-8 text-center">
          View execution logs in Schedule tab
        </p>
      ),
      disabled: ![
        "executing",
        "code_review",
        "testing",
        "completed",
      ].includes(planStatus),
    },
  ];

  return <Tabs tabs={tabs} defaultTab="schemes" />;
}
