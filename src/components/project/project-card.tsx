"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { TimeAgo } from "@/components/ui/time-ago";
import { TailscaleLogo } from "@/components/ui/icons";
import { addRecentProject } from "@/lib/recent-projects";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
    targetRepoPath: string;
    updatedAt: string;
    remoteEnabled?: boolean;
    remoteHost?: string | null;
  };
  locale: string;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, locale, onDelete }: ProjectCardProps) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirm();
  const isZh = t("common.back") === "返回";

  return (
    <div
      className="rounded-lg p-5 transition-all cursor-pointer"
      style={{ background: "var(--surface-container-low)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-container-high)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-container-low)")}
      onClick={() => {
        addRecentProject(project.id);
        router.push(`/${locale}/projects/${project.id}`);
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{project.icon || "📁"}</span>
          <h3 className="font-semibold text-lg">{project.name}</h3>
          {project.remoteEnabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(192,193,255,0.12)", color: "var(--primary)" }}>
              <TailscaleLogo size={12} className="inline-block align-[-1px]" /> {project.remoteHost}
            </span>
          )}
        </div>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const ok = await confirm(isZh ? "删除项目" : "Delete Project", t("project.deleteConfirm")); if (ok) {
              onDelete(project.id);
            }
          }}
          className="text-sm transition-colors"
          style={{ color: "var(--outline)" }}
          onMouseEnter={(e) => e.currentTarget.style.color = "var(--error)"}
          onMouseLeave={(e) => e.currentTarget.style.color = "var(--outline)"}
        >
          {t("common.delete")}
        </button>
      </div>
      {project.description && (
        <p className="text-sm mt-1 line-clamp-2" style={{ color: "var(--on-surface-variant)" }}>
          {project.description}
        </p>
      )}
      <div className="flex items-center justify-between mt-3">
        <p className="text-xs font-mono truncate" style={{ color: "var(--outline)" }}>
          {project.targetRepoPath}
        </p>
        <TimeAgo date={project.updatedAt} locale={locale} />
      </div>
    </div>
  );
}
