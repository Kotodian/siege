import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { GlobalLoadingProvider } from "@/components/ui/global-loading";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "en" | "zh")) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <GlobalLoadingProvider>
      <div className="min-h-screen bg-gray-50">
        <nav className="border-b bg-white px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a href={`/${locale}`} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/siege-logo.svg" alt="Siege" className="w-7 h-7" />
              <h1 className="text-xl font-bold">Siege</h1>
            </a>
            <a
              href={`/${locale}`}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              {locale === "zh" ? "项目" : "Projects"}
            </a>
            <a
              href={`/${locale}/settings`}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              {locale === "zh" ? "设置" : "Settings"}
            </a>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/en"
              className={`text-xs ${locale === "en" ? "text-gray-900 font-medium" : "text-gray-500"} hover:text-gray-900`}
            >
              EN
            </a>
            <span className="text-gray-300">|</span>
            <a
              href="/zh"
              className={`text-xs ${locale === "zh" ? "text-gray-900 font-medium" : "text-gray-500"} hover:text-gray-900`}
            >
              中文
            </a>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>
      </GlobalLoadingProvider>
    </NextIntlClientProvider>
  );
}
