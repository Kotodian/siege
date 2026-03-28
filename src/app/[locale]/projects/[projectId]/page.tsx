import ProjectDetailClient from "./project-detail-client";

export function generateStaticParams() {
  return [
    { locale: "zh", projectId: "_" },
    { locale: "en", projectId: "_" },
  ];
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  return <ProjectDetailClient locale={locale} projectId={projectId} />;
}
