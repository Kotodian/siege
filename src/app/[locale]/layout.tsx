import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { GlobalLoadingProvider } from "@/components/ui/global-loading";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { FolderIcon, SettingsIcon } from "@/components/ui/icons";

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
      <ConfirmProvider>
      <div className="min-h-screen" style={{ background: "var(--background)", color: "var(--on-surface)" }}>
        <nav className="px-6 py-3 flex items-center justify-between" style={{ background: "var(--surface-container)" }}>
          <div className="flex items-center gap-6">
            <a href={`/${locale}`} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/siege-logo.svg" alt="Siege" className="w-7 h-7" />
              <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading), system-ui" }}>Siege</h1>
            </a>
            <a
              href={`/${locale}`}
              className="text-sm hover:text-[var(--accent)]"
              style={{ color: "var(--outline)" }}
            >
              <><FolderIcon size={14} className="inline-block align-[-2px]" /> {locale === "zh" ? "项目" : "Projects"}</>
            </a>
            <a
              href={`/${locale}/settings`}
              className="text-sm hover:text-[var(--accent)]"
              style={{ color: "var(--outline)" }}
            >
              <><SettingsIcon size={14} className="inline-block align-[-2px]" /> {locale === "zh" ? "设置" : "Settings"}</>
            </a>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/en"
              className={`text-xs ${locale === "en" ? "font-medium" : ""} hover:text-[var(--accent)]`}
              style={{ color: locale === "en" ? "var(--on-surface)" : "var(--outline)" }}
            >
              EN
            </a>
            <span style={{ color: "var(--outline-variant)" }}>|</span>
            <a
              href="/zh"
              className={`text-xs ${locale === "zh" ? "font-medium" : ""} hover:text-[var(--accent)]`}
              style={{ color: locale === "zh" ? "var(--on-surface)" : "var(--outline)" }}
            >
              中文
            </a>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>
      </ConfirmProvider>
      </GlobalLoadingProvider>
    </NextIntlClientProvider>
  );
}
