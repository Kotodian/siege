import SettingsClient from "./settings-client";

export function generateStaticParams() {
  return [{ locale: "zh" }, { locale: "en" }];
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <SettingsClient locale={locale} />;
}
