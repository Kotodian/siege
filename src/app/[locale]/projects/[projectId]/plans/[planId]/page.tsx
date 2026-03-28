import PlanDetailClient from "./plan-detail-client";

export function generateStaticParams() {
  return [
    { locale: "zh", projectId: "_", planId: "_" },
    { locale: "en", projectId: "_", planId: "_" },
  ];
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string; planId: string }>;
}) {
  const { locale, projectId, planId } = await params;
  return <PlanDetailClient locale={locale} projectId={projectId} planId={planId} />;
}
