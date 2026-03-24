import { ProjectList } from "@/components/project/project-list";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <ProjectList locale={locale} />
    </div>
  );
}
