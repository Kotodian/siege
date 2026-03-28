"use client";

import { useState, useEffect } from "react";
import { PlanList } from "@/components/plan/plan-list";
import { ProjectDescription } from "@/components/project/project-description";
import { apiFetch } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  description: string | null;
  targetRepoPath: string | null;
}

export default function ProjectDetailClient({
  locale,
  projectId,
}: {
  locale: string;
  projectId: string;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/projects/${projectId}`)
      .then((res) => res.json())
      .then((data) => setProject(data))
      .catch(() => setProject(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <p style={{ color: "var(--outline)" }}>{locale === "zh" ? "加载中..." : "Loading..."}</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <p style={{ color: "var(--error)" }}>{locale === "zh" ? "项目不存在" : "Project not found"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <a
          href={`/${locale}`}
          className="text-sm hover:underline inline-flex items-center gap-1"
          style={{ color: "var(--outline)" }}
        >
          <span>&larr;</span> {locale === "zh" ? "项目" : "Projects"}
        </a>
        <h1
          className="text-3xl font-bold mt-3"
          style={{ fontFamily: "var(--font-heading), system-ui" }}
        >
          {project.name}
        </h1>
        {project.description && (
          <ProjectDescription content={project.description} />
        )}
        <p className="text-xs font-mono mt-1" style={{ color: "var(--outline)" }}>
          {project.targetRepoPath}
        </p>
      </div>

      <PlanList projectId={projectId} locale={locale} />
    </div>
  );
}
