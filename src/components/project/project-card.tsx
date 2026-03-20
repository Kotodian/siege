"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { TimeAgo } from "@/components/ui/time-ago";
import { addRecentProject } from "@/lib/recent-projects";

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
    targetRepoPath: string;
    updatedAt: string;
  };
  locale: string;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, locale, onDelete }: ProjectCardProps) {
  const t = useTranslations();
  const router = useRouter();

  return (
    <div
      className="rounded-lg border p-5 hover:shadow-md transition-shadow cursor-pointer"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}
      onClick={() => {
        addRecentProject(project.id);
        router.push(`/${locale}/projects/${project.id}`);
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{project.icon || "📁"}</span>
          <h3 className="font-semibold text-lg">{project.name}</h3>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("project.deleteConfirm"))) {
              onDelete(project.id);
            }
          }}
          className="hover:text-red-500 text-sm"
          style={{ color: "var(--muted)" }}
        >
          {t("common.delete")}
        </button>
      </div>
      {project.description && (
        <p className="text-sm mt-1 line-clamp-2" style={{ color: "var(--muted)" }}>
          {project.description}
        </p>
      )}
      <div className="flex items-center justify-between mt-3">
        <p className="text-xs font-mono truncate" style={{ color: "var(--muted)" }}>
          {project.targetRepoPath}
        </p>
        <TimeAgo date={project.updatedAt} locale={locale} />
      </div>
    </div>
  );
}
