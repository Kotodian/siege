import { PlanList } from "@/components/plan/plan-list";
import { ProjectDescription } from "@/components/project/project-description";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  const db = getDb();
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    notFound();
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
