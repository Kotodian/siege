"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "./project-card";
import { CreateProjectDialog } from "./create-project-dialog";
import { OnboardingGuide } from "@/components/onboarding/onboarding-guide";

interface Project {
  id: string;
  name: string;
  description: string | null;
  targetRepoPath: string;
  updatedAt: string;
}

interface ProjectListProps {
  locale: string;
}

export function ProjectList({ locale }: ProjectListProps) {
  const t = useTranslations();
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchProjects = async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data);
    setLoaded(true);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (data: {
    name: string;
    description: string;
    guidelines: string;
    targetRepoPath: string;
  }) => {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    fetchProjects();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    fetchProjects();
  };

  if (!loaded) {
    return <p className="text-center py-12 text-gray-400">{t("common.loading")}</p>;
  }

  // Show onboarding guide on first visit (no projects)
  if (projects.length === 0) {
    return (
      <OnboardingGuide
        locale={locale}
        onComplete={async (data) => {
          await handleCreate(data);
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">{t("project.title")}</h2>
        <Button onClick={() => setDialogOpen(true)}>
          {t("project.create")}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            locale={locale}
            onDelete={handleDelete}
          />
        ))}
      </div>

      <CreateProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
