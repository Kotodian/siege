import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { GlobalLoadingProvider } from "@/components/ui/global-loading";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

import zhMessages from "@/messages/zh.json";
import enMessages from "@/messages/en.json";

const messagesMap: Record<string, typeof zhMessages> = { zh: zhMessages, en: enMessages };

export function generateStaticParams() {
  return [{ locale: "zh" }, { locale: "en" }];
}

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

  const messages = messagesMap[locale] ?? messagesMap.zh;

  return (
    <NextIntlClientProvider messages={messages}>
      <GlobalLoadingProvider>
      <ConfirmProvider>
      <div className="min-h-screen flex flex-col" style={{ background: "var(--background)", color: "var(--on-surface)" }}>
        {/* ── Top Navbar (Monolith Studio style) ── */}
        <nav
          className="siege-topbar h-12 flex items-center justify-between px-5 shrink-0"
          style={{ background: "var(--surface-container-lowest)" }}
        >
          {/* Left: Logo + App Name + Nav Tabs */}
          <div className="flex items-center gap-0">
            <a href={`/${locale}`} className="flex items-center gap-2.5 pr-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/siege-logo.svg" alt="Siege" className="w-6 h-6" />
              <span
                className="text-sm font-semibold tracking-wide"
                style={{ fontFamily: "var(--font-heading), system-ui", color: "var(--on-surface)" }}
              >
                Siege
              </span>
            </a>

            <div className="flex items-center">
              <a
                href={`/${locale}`}
                className="siege-nav-tab px-3.5 py-1.5 text-[13px] font-medium rounded transition-colors"
                style={{ color: "var(--on-surface-variant)" }}
              >
                {locale === "zh" ? "项目" : "Projects"}
              </a>
              <a
                href={`/${locale}/settings`}
                className="siege-nav-tab px-3.5 py-1.5 text-[13px] font-medium rounded transition-colors"
                style={{ color: "var(--on-surface-variant)" }}
              >
                {locale === "zh" ? "设置" : "Settings"}
              </a>
            </div>
          </div>

          {/* Right: Language Toggle */}
          <div className="flex items-center gap-1.5">
            <a
              href="/en"
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{
                color: locale === "en" ? "var(--on-surface)" : "var(--outline)",
                background: locale === "en" ? "var(--surface-container)" : "transparent",
              }}
            >
              EN
            </a>
            <a
              href="/zh"
              className="px-2 py-1 text-xs rounded transition-colors"
              style={{
                color: locale === "zh" ? "var(--on-surface)" : "var(--outline)",
                background: locale === "zh" ? "var(--surface-container)" : "transparent",
              }}
            >
              中文
            </a>
          </div>
        </nav>

        {/* ── Main Content ── */}
        <main className="flex-1">{children}</main>
      </div>
      </ConfirmProvider>
      </GlobalLoadingProvider>
    </NextIntlClientProvider>
  );
}
