"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { TimeAgo } from "@/components/ui/time-ago";
import { statusIcons, TrashIcon, ClipboardIcon, type IconProps } from "@/components/ui/icons";

interface PlanCardProps {
  plan: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    status: string;
    tag: string | null;
    updatedAt: string;
  };
  locale: string;
  onDelete: (id: string) => void;
}

const StatusIcon = ({ status }: { status: string }) => {
  const Ic = statusIcons[status] || ((p: IconProps) => <ClipboardIcon {...p} />);
  return <Ic size={16} className="inline-block align-[-2px]" />;
};

export function PlanCard({ plan, locale, onDelete }: PlanCardProps) {
  const t = useTranslations();
  const router = useRouter();

  return (
    <div
      className="rounded-lg border p-5 hover:shadow-md transition-shadow cursor-pointer"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}
      onClick={() =>
        router.push(`/${locale}/projects/${plan.projectId}/plans/${plan.id}`)
      }
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold"><StatusIcon status={plan.status} /> {plan.name}</h3>
          {plan.tag && (
            <StatusBadge
              status={plan.tag}
              label={t(`plan.tags.${plan.tag}`)}
            />
          )}
          <StatusBadge
            status={plan.status}
            label={t(`plan.status.${plan.status}`)}
          />
        </div>
        <div className="flex items-center gap-3">
          <TimeAgo date={plan.updatedAt} locale={locale} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(t("plan.deleteConfirm"))) {
                onDelete(plan.id);
              }
            }}
            className="hover:text-red-500 text-sm"
            style={{ color: "var(--muted)" }}
          >
            <TrashIcon size={14} className="inline-block align-[-2px]" /> {t("common.delete")}
          </button>
        </div>
      </div>
      {plan.description && (
        <p className="text-sm mt-1 line-clamp-2" style={{ color: "var(--muted)" }}>
          {plan.description}
        </p>
      )}
    </div>
  );
}
