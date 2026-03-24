"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useGlobalLoading } from "@/components/ui/global-loading";

function CollapsibleSection({ title, icon, defaultOpen = false, badge, children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; badge?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 py-3 text-left hover:opacity-80"
      >
        <svg className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} style={{ color: "var(--outline)" }} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        {icon}
        <span className="text-lg font-semibold" style={{ color: "var(--on-surface)" }}>{title}</span>
        {badge && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--outline-variant)", color: "var(--outline)" }}>{badge}</span>}
      </button>
      {open && <div className="pl-6">{children}</div>}
    </section>
  );
}
import { BotIcon, MessageSquareIcon, PackageIcon, SettingsIcon, TargetIcon, InboxIcon, LayoutGridIcon, BrainIcon, GlobeIcon, SearchIcon, CalendarIcon, ZapIcon, FlaskIcon, FileTextIcon, AnthropicLogo, OpenAILogo, ZhipuLogo, ClaudeCodeLogo, CodexLogo } from "@/components/ui/icons";

interface ProviderStatus {
  configured: boolean;
  masked: string;
  baseURL: string;
  mode: string;
}

interface AiConfig {
  anthropic: ProviderStatus;
  openai: ProviderStatus;
  glm: ProviderStatus;
  claude?: { installed: boolean; loggedIn: boolean; email?: string; subscriptionType?: string };
  codex?: { installed: boolean; loggedIn: boolean; method?: string };
}

interface SkillSummary {
  name: string;
  source: string;
  description: string;
  preview: string;
}

const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyPlaceholder: "sk-ant-api03-...",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101", "claude-sonnet-4-20250514", "claude-opus-4-20250514"],
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    keyPlaceholder: "sk-...",
    models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.3-codex", "o3-pro", "o3-mini", "gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "glm",
    label: "GLM (\u667A\u8C31)",
    keyPlaceholder: "glm-api-key...",
    models: ["glm-5", "glm-5-turbo", "glm-4.7", "glm-4.7-flash", "glm-4.6", "glm-4.5", "glm-4-plus", "glm-4-flash"],
  },
] as const;

const PROVIDER_ICONS: Record<string, (props: { size?: number; className?: string }) => React.ReactNode> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  glm: ZhipuLogo,
};

export default function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const t = useTranslations();
  const isZh = locale === "zh";

  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [saved, setSaved] = useState(false);

  // Per-provider edit state
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editModel, setEditModel] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    fetch("/api/ai-config").then((r) => r.json()).then(setAiConfig);
    fetch("/api/settings").then((r) => r.json()).then(setSettings);
    fetch("/api/skills").then((r) => r.json()).then(setSkills);
  }, []);

  const saveProvider = async (providerId: string) => {
    setSavingProvider(true);
    if (editKey || editUrl !== undefined) {
      await fetch("/api/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          apiKey: editKey || undefined,
          baseURL: editUrl || undefined,
        }),
      });
    }
    // Save model setting
    if (editModel) {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [`default_model_${providerId}`]: editModel }),
      });
      setSettings((s) => ({ ...s, [`default_model_${providerId}`]: editModel }));
    }
    const res = await fetch("/api/ai-config");
    setAiConfig(await res.json());
    setEditingProvider(null);
    setEditKey("");
    setEditUrl("");
    setEditModel("");
    setSavingProvider(false);
  };

  const saveSettings = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const skillsBySource = skills.reduce<Record<string, SkillSummary[]>>(
    (acc, s) => { if (!acc[s.source]) acc[s.source] = []; acc[s.source].push(s); return acc; }, {}
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <a href={`/${locale}`} className="text-sm hover:underline inline-flex items-center gap-1" style={{ color: "var(--outline)" }}>
        <span>&larr;</span> {t("common.back")}
      </a>
      <h1 className="text-3xl font-bold mt-3 mb-8" style={{ fontFamily: "var(--font-heading), system-ui" }}>{t("nav.settings")}</h1>

      {/* AI Providers */}
      <CollapsibleSection
        title={isZh ? "AI 服务配置" : "AI Provider Configuration"}
        icon={<BotIcon size={18} />}
        defaultOpen={true}
      >

        {/* Claude Code Login — for ACP engine */}
        <div className="rounded-lg border p-4 mb-3" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm"><AnthropicLogo size={14} className="inline-block align-[-2px]" /> Claude Code</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">ACP</span>
            </div>
            <div className="flex items-center gap-2">
              {aiConfig?.claude?.loggedIn ? (
                <>
                  <span className="text-xs text-[var(--success)] bg-[var(--success-container)] px-2 py-0.5 rounded-full">
                    ✓ {aiConfig.claude.email || (isZh ? "已登录" : "Logged in")}
                  </span>
                  {aiConfig.claude.subscriptionType && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      {aiConfig.claude.subscriptionType}
                    </span>
                  )}
                </>
              ) : aiConfig?.claude?.installed ? (
                <span className="text-xs text-[var(--warning)] bg-[var(--warning-container)] px-2 py-0.5 rounded-full">
                  {isZh ? "未登录" : "Not logged in"}
                </span>
              ) : (
                <span className="text-xs" style={{ color: "var(--outline)" }}>
                  {isZh ? "未安装" : "Not installed"}
                </span>
              )}
            </div>
          </div>
          {aiConfig?.claude?.loggedIn ? (
            <p className="text-xs mt-2" style={{ color: "var(--outline)" }}>
              {isZh
                ? "任务排期中选择「Claude Code (ACP)」引擎即可使用"
                : "Select 'Claude Code (ACP)' engine in task scheduler"}
            </p>
          ) : aiConfig?.claude?.installed ? (
            <div className="mt-2 flex items-center gap-2">
              <code className="text-xs px-2 py-1 rounded font-mono select-all" style={{ background: "var(--background)", color: "var(--on-surface)" }}>claude login</code>
              <Button variant="ghost" size="sm" onClick={() => fetch("/api/ai-config").then(r => r.json()).then(setAiConfig)}>
                {isZh ? "刷新状态" : "Refresh"}
              </Button>
            </div>
          ) : (
            <p className="text-xs mt-2" style={{ color: "var(--outline)" }}>
              {isZh ? "请先安装 Claude Code CLI" : "Install Claude Code CLI first"}
            </p>
          )}
        </div>

        {/* Codex Login — for Codex ACP engine */}
        <div className="rounded-lg border p-4 mb-3" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm"><CodexLogo size={14} className="inline-block align-[-2px]" /> Codex</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-medium">ACP</span>
            </div>
            <div className="flex items-center gap-2">
              {aiConfig?.codex?.loggedIn ? (
                <span className="text-xs text-[var(--success)] bg-[var(--success-container)] px-2 py-0.5 rounded-full">
                  ✓ {aiConfig.codex.method || (isZh ? "已登录" : "Logged in")}
                </span>
              ) : aiConfig?.codex?.installed ? (
                <span className="text-xs text-[var(--warning)] bg-[var(--warning-container)] px-2 py-0.5 rounded-full">
                  {isZh ? "未登录" : "Not logged in"}
                </span>
              ) : (
                <span className="text-xs" style={{ color: "var(--outline)" }}>
                  {isZh ? "未安装" : "Not installed"}
                </span>
              )}
            </div>
          </div>
          {aiConfig?.codex?.loggedIn ? (
            <p className="text-xs mt-2" style={{ color: "var(--outline)" }}>
              {isZh
                ? "任务排期中选择「Codex (ACP)」引擎即可使用"
                : "Select 'Codex (ACP)' engine in task scheduler"}
            </p>
          ) : aiConfig?.codex?.installed ? (
            <div className="mt-2 flex items-center gap-2">
              <code className="text-xs px-2 py-1 rounded font-mono select-all" style={{ background: "var(--background)", color: "var(--on-surface)" }}>codex login</code>
              <Button variant="ghost" size="sm" onClick={() => fetch("/api/ai-config").then(r => r.json()).then(setAiConfig)}>
                {isZh ? "刷新状态" : "Refresh"}
              </Button>
            </div>
          ) : (
            <p className="text-xs mt-2" style={{ color: "var(--outline)" }}>
              {isZh ? "请先安装 Codex CLI" : "Install Codex CLI first"}
            </p>
          )}
        </div>

        <div className="space-y-3">
          {PROVIDERS.map((prov) => {
            const status = aiConfig?.[prov.id as keyof AiConfig] as ProviderStatus | undefined;
            const isEditing = editingProvider === prov.id;

            return (
              <div key={prov.id} className="rounded-lg border p-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{PROVIDER_ICONS[prov.id] ? <>{PROVIDER_ICONS[prov.id]({ size: 14, className: "inline-block align-[-2px]" })} </> : null}{prov.label}</span>
                  <div className="flex items-center gap-2">
                    {status?.configured ? (
                      <>
                        <span className="text-xs text-[var(--success)] bg-[var(--success-container)] px-2 py-0.5 rounded-full">
                          ✓ {status.masked || (status.baseURL ? "Proxy" : "OK")}
                        </span>
                        {settings[`default_model_${prov.id}`] && (
                          <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-mono">
                            {settings[`default_model_${prov.id}`]}
                          </span>
                        )}
                        {status.baseURL && (
                          <span className="text-xs font-mono" style={{ color: "var(--outline)" }}>
                            {status.baseURL.slice(0, 30)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--outline)" }}>
                        {isZh ? "未配置" : "Not configured"}
                      </span>
                    )}
                    {status?.configured && !isEditing && (
                      <>
                        {testResult[prov.id] === true && (
                          <span className="text-xs text-[var(--success)] bg-[var(--success-container)] px-2 py-0.5 rounded-full">
                            {isZh ? "连接正常" : "OK"}
                          </span>
                        )}
                        {testResult[prov.id] === false && (
                          <span className="text-xs text-[var(--error)] bg-[var(--error-container)] px-2 py-0.5 rounded-full">
                            {isZh ? "连接失败" : "Failed"}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={testingProvider === prov.id}
                          onClick={async () => {
                            setTestingProvider(prov.id);
                            setTestResult((prev) => ({ ...prev, [prov.id]: null }));
                            const res = await fetch("/api/ai-config/test", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ provider: prov.id }),
                            });
                            const data = await res.json();
                            setTestResult((prev) => ({ ...prev, [prov.id]: data.success }));
                            setTestingProvider(null);
                          }}
                        >
                          {testingProvider === prov.id
                            ? (isZh ? "测试中..." : "Testing...")
                            : (isZh ? "测试连接" : "Test")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await fetch(`/api/ai-config?provider=${prov.id}`, { method: "DELETE" });
                            const newSettings = { ...settings };
                            delete newSettings[`default_model_${prov.id}`];
                            setSettings(newSettings);
                            await fetch("/api/settings", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ [`default_model_${prov.id}`]: "" }),
                            });
                            const res = await fetch("/api/ai-config");
                            setAiConfig(await res.json());
                          }}
                          className="text-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error-container)]"
                        >
                          {isZh ? "清除" : "Clear"}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (isEditing) {
                          setEditingProvider(null);
                        } else {
                          setEditingProvider(prov.id);
                          setEditKey("");
                          setEditUrl(status?.baseURL || "");
                          setEditModel(settings[`default_model_${prov.id}`] || "");
                        }
                      }}
                    >
                      {isEditing
                        ? t("common.cancel")
                        : status?.configured
                          ? (isZh ? "修改" : "Change")
                          : (isZh ? "配置" : "Configure")}
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: "var(--outline-variant)" }}>
                    <Input
                      label="API Key"
                      value={editKey}
                      onChange={(e) => setEditKey(e.target.value)}
                      placeholder={prov.keyPlaceholder}
                      type="password"
                    />
                    <Input
                      label={isZh ? "Base URL（中转站，可选）" : "Base URL (proxy, optional)"}
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      placeholder={
                        prov.id === "glm"
                          ? "https://open.bigmodel.cn/api/paas/v4"
                          : prov.id === "anthropic"
                            ? "https://api.anthropic.com"
                            : "https://api.openai.com/v1"
                      }
                    />
                    <div>
                      <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>
                        {isZh ? "模型" : "Model"}
                      </label>
                      <div className="flex gap-2">
                        <select
                          className="flex-1 rounded-md border px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
                          style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
                          value={editModel}
                          onChange={(e) => setEditModel(e.target.value)}
                        >
                          <option value="">{isZh ? "默认" : "Default"}</option>
                          {prov.models.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <input
                          className="flex-1 rounded-md border px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
                          style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
                          value={editModel}
                          onChange={(e) => setEditModel(e.target.value)}
                          placeholder={isZh ? "或输入自定义模型名" : "Or enter custom model name"}
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => saveProvider(prov.id)}
                      disabled={savingProvider || (!editKey && !editUrl && !editModel)}
                    >
                      {savingProvider ? t("common.loading") : t("common.save")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* Per-Step AI Configuration */}
      <CollapsibleSection
        title={isZh ? "各步骤 AI 配置" : "Per-Step AI Configuration"}
        icon={<LayoutGridIcon size={18} />}
      >
        <StepModelSectionInner settings={settings} setSettings={setSettings} isZh={isZh} onSave={saveSettings} />
      </CollapsibleSection>

      {/* General Settings */}
      <CollapsibleSection
        title={isZh ? "通用设置" : "General Settings"}
        icon={<SettingsIcon size={18} />}
      >
        <div className="rounded-lg border p-6 space-y-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>
              {isZh ? "默认 AI 提供商" : "Default AI Provider"}
            </label>
            <select
              value={settings.default_provider || "anthropic"}
              onChange={(e) => setSettings((s) => ({ ...s, default_provider: e.target.value }))}
              className="w-full border rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
            >
              <option value="acp">Claude Code (ACP)</option>
              <option value="codex-acp">Codex (ACP)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT)</option>
              <option value="glm">GLM (智谱)</option>
            </select>
          </div>
          <Input
            label={isZh ? "完成后归档天数" : "Archive after days (completed)"}
            type="number"
            value={settings.archive_after_days || "30"}
            onChange={(e) => setSettings((s) => ({ ...s, archive_after_days: e.target.value }))}
          />
          <Input
            label={isZh ? "归档后清理天数" : "Cleanup after days (archived)"}
            type="number"
            value={settings.cleanup_after_days || "90"}
            onChange={(e) => setSettings((s) => ({ ...s, cleanup_after_days: e.target.value }))}
          />
          <div className="flex items-center gap-3">
            <Button onClick={saveSettings}>{t("common.save")}</Button>
            {saved && <span className="text-sm text-[var(--success)]">✓</span>}
          </div>
        </div>
      </CollapsibleSection>

      {/* Memories */}
      <CollapsibleSection title={isZh ? "记忆" : "Memories"} icon={<BrainIcon size={18} />} badge={String(skills.length > 0 ? "" : "")}>
        <MemorySectionInner isZh={isZh} />
      </CollapsibleSection>

      {/* Import Sources */}
      <CollapsibleSection title={isZh ? "导入来源" : "Import Sources"} icon={<InboxIcon size={18} />}>
        <ImportSourcesSectionInner isZh={isZh} />
      </CollapsibleSection>

      {/* Skills */}
      <CollapsibleSection title={isZh ? "技能" : "Skills"} icon={<TargetIcon size={18} />} badge={`${skills.length}`}>
        <SkillsSectionInner
        skills={skills}
        skillsBySource={skillsBySource}
        isZh={isZh}
        hasAi={!!(aiConfig?.claude?.loggedIn || aiConfig?.anthropic?.configured || aiConfig?.openai?.configured || aiConfig?.glm?.configured)}
          onSkillsChange={() => fetch("/api/skills").then((r) => r.json()).then(setSkills)}
        />
      </CollapsibleSection>
    </div>
  );
}

function SkillsSectionInner({
  skills,
  skillsBySource,
  isZh,
  hasAi,
  onSkillsChange,
}: {
  skills: SkillSummary[];
  skillsBySource: Record<string, SkillSummary[]>;
  isZh: boolean;
  hasAi: boolean;
  onSkillsChange: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setResult(null);
    startLoading(isZh ? "AI 正在生成技能..." : "Generating skill...");
    try {
      const res = await fetch("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateContent(content);
        }
        // Check result markers
        if (content.includes("__SKILL_INSTALLED__:")) {
          const name = content.split("__SKILL_INSTALLED__:")[1]?.trim();
          setResult(isZh ? `已安装: ${name}` : `Installed: ${name}`);
          setPrompt("");
          onSkillsChange();
          stopLoading(isZh ? `已安装: ${name}` : `Installed: ${name}`);
        } else if (content.includes("__SKILL_ERROR__:")) {
          const err = content.split("__SKILL_ERROR__:")[1]?.trim();
          setResult(err || (isZh ? "生成失败" : "Generation failed"));
          stopLoading(isZh ? "生成失败" : "Failed");
        } else {
          stopLoading(isZh ? "完成" : "Done");
        }
      } else {
        setResult(isZh ? "生成失败" : "Generation failed");
        stopLoading(isZh ? "生成失败" : "Failed");
      }
    } catch {
      setResult(isZh ? "生成失败" : "Generation failed");
      stopLoading(isZh ? "生成失败" : "Failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (name: string) => {
    await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    onSkillsChange();
  };

  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-4">
        <><TargetIcon size={18} className="inline-block align-[-3px]" /> {isZh ? "技能" : "Skills"}</> ({skills.length})
      </h2>

      {/* Generate skill from prompt */}
      <div className="rounded-lg border p-4 mb-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
        <h3 className="text-sm font-medium mb-2" style={{ color: "var(--on-surface)" }}>
          {isZh ? "通过描述安装技能" : "Install Skill from Prompt"}
        </h3>
        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded-md border px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] resize-none"
            style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!hasAi}
            placeholder={!hasAi
              ? (isZh ? "请先配置 AI 服务" : "Configure an AI provider first")
              : isZh
                ? "描述你需要的技能，例如：Go 语言最佳实践和代码规范..."
                : "Describe the skill you need, e.g.: Go best practices and coding standards..."}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleGenerate())}
          />
          <Button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || !hasAi}
            className="self-end"
          >
            {generating ? (isZh ? "生成中..." : "Generating...") : (isZh ? "安装" : "Install")}
          </Button>
        </div>
        {result && (
          <p className={`text-xs mt-2 ${result.startsWith("Installed") || result.startsWith("已安装") ? "text-[var(--success)]" : "text-[var(--error)]"}`}>
            {result}
          </p>
        )}
      </div>

      {/* Installed skills */}
      {Object.entries(skillsBySource).map(([source, items]) => (
        <div key={source} className="mb-4">
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--outline)" }}>
            {source} ({items.length})
          </h3>
          <div className="rounded-lg border divide-y" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)", "--tw-divide-color": "var(--outline-variant)" } as React.CSSProperties}>
            {items.map((skill) => (
              <div key={skill.name} className="px-4 py-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm font-medium">{skill.name}</span>
                    {skill.description && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--outline)" }}>{skill.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(skill.name)}
                    className="text-xs text-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error-container)] px-2 py-1 rounded shrink-0 ml-2"
                  >
                    {isZh ? "删除" : "Delete"}
                  </button>
                </div>
                {skill.preview && (
                  <pre className="text-[11px] mt-1.5 whitespace-pre-wrap line-clamp-3 font-mono leading-relaxed" style={{ color: "var(--outline)" }}>{skill.preview}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {skills.length === 0 && (
        <p className="text-sm" style={{ color: "var(--outline)" }}>
          {isZh ? "未找到技能（~/.claude/skills/）" : "No skills found in ~/.claude/skills/"}
        </p>
      )}
    </section>
  );
}

interface ImportConfigItem {
  id: string;
  source: string;
  config: Record<string, string>;
  enabled: boolean;
}

const IMPORT_SOURCE_FIELDS: Record<
  string,
  Array<{ key: string; label: string; labelZh: string; placeholder: string; type?: string }>
> = {
  notion: [
    { key: "api_key", label: "API Key", labelZh: "API Key", placeholder: "secret_...", type: "password" },
    { key: "database_id", label: "Database ID (optional)", labelZh: "Database ID（可选）", placeholder: "abc123..." },
  ],
  jira: [
    { key: "base_url", label: "Base URL", labelZh: "Base URL", placeholder: "https://your-domain.atlassian.net" },
    { key: "email", label: "Email", labelZh: "邮箱", placeholder: "user@example.com" },
    { key: "api_token", label: "API Token", labelZh: "API Token", placeholder: "ATATT3x...", type: "password" },
  ],
  confluence: [
    { key: "base_url", label: "Base URL", labelZh: "Base URL", placeholder: "https://your-domain.atlassian.net/wiki" },
    { key: "email", label: "Email", labelZh: "邮箱", placeholder: "user@example.com" },
    { key: "api_token", label: "API Token", labelZh: "API Token", placeholder: "ATATT3x...", type: "password" },
  ],
  feishu: [
    { key: "app_id", label: "App ID", labelZh: "App ID", placeholder: "cli_a1b2c3..." },
    { key: "app_secret", label: "App Secret", labelZh: "App Secret", placeholder: "xxxx", type: "password" },
    { key: "space_id", label: "Space ID (optional)", labelZh: "知识空间 ID（可选）", placeholder: "7xxx..." },
  ],
  github: [
    { key: "token", label: "Personal Access Token (optional if gh CLI logged in)", labelZh: "Personal Access Token（已登录 gh CLI 可留空）", placeholder: "ghp_...", type: "password" },
    { key: "repo", label: "Repository (optional)", labelZh: "仓库（可选）", placeholder: "owner/repo" },
  ],
  gitlab: [
    { key: "base_url", label: "Base URL", labelZh: "Base URL", placeholder: "https://gitlab.com" },
    { key: "token", label: "Personal Access Token", labelZh: "Personal Access Token", placeholder: "glpat-...", type: "password" },
    { key: "project_id", label: "Project ID (optional)", labelZh: "项目 ID（可选）", placeholder: "12345" },
  ],
  mcp: [
    { key: "server_command", label: "Server Command", labelZh: "服务器命令", placeholder: "npx" },
    { key: "server_args", label: "Args (JSON array)", labelZh: "参数（JSON 数组）", placeholder: '["@modelcontextprotocol/server-xxx"]' },
    { key: "server_env", label: "Env (JSON object)", labelZh: "环境变量（JSON 对象）", placeholder: '{"API_KEY": "..."}' },
  ],
};

function ImportSourcesSectionInner({ isZh }: { isZh: boolean }) {
  const [configs, setConfigs] = useState<ImportConfigItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addSource, setAddSource] = useState("notion");
  const [addFields, setAddFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<Record<string, boolean | null>>({});

  const fetchConfigs = () => {
    fetch("/api/import-sources")
      .then((r) => r.json())
      .then(setConfigs);
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleAdd = async () => {
    setSaving(true);
    await fetch("/api/import-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: addSource, config: addFields }),
    });
    setAddOpen(false);
    setAddFields({});
    setSaving(false);
    fetchConfigs();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/import-sources?id=${id}`, { method: "DELETE" });
    fetchConfigs();
  };

  const handleValidate = async (id: string) => {
    setValidating(id);
    setValidationResult((prev) => ({ ...prev, [id]: null }));
    const res = await fetch(`/api/import-sources/${id}/validate`, {
      method: "POST",
    });
    const data = await res.json();
    setValidationResult((prev) => ({ ...prev, [id]: data.valid }));
    setValidating(null);
  };

  const sourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      notion: "Notion",
      jira: "Jira",
      confluence: "Confluence",
      feishu: "Feishu",
      github: "GitHub",
      gitlab: "GitLab",
      mcp: "MCP",
    };
    return labels[source] || source;
  };

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          <><InboxIcon size={18} className="inline-block align-[-3px]" /> {isZh ? "导入来源" : "Import Sources"}</>
        </h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          {isZh ? "添加导入来源" : "Add Import Source"}
        </Button>
      </div>

      {configs.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--outline)" }}>
          {isZh ? "暂无配置的导入来源" : "No import sources configured"}
        </p>
      ) : (
        <div className="space-y-3">
          {configs.map((cfg) => (
            <div key={cfg.id} className="rounded-lg border p-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {sourceLabel(cfg.source)}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(192,193,255,0.12)] text-[var(--primary)] font-medium">
                    {cfg.source}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {validationResult[cfg.id] === true && (
                    <span className="text-xs text-[var(--success)] bg-[var(--success-container)] px-2 py-0.5 rounded-full">
                      {isZh ? "连接成功" : "Connected"}
                    </span>
                  )}
                  {validationResult[cfg.id] === false && (
                    <span className="text-xs text-[var(--error)] bg-[var(--error-container)] px-2 py-0.5 rounded-full">
                      {isZh ? "连接失败" : "Failed"}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleValidate(cfg.id)}
                    disabled={validating === cfg.id}
                  >
                    {validating === cfg.id
                      ? (isZh ? "验证中..." : "Validating...")
                      : (isZh ? "验证" : "Validate")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(cfg.id)}
                    className="text-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error-container)]"
                  >
                    {isZh ? "删除" : "Delete"}
                  </Button>
                </div>
              </div>
              <div className="mt-2 text-xs font-mono" style={{ color: "var(--outline)" }}>
                {Object.entries(cfg.config)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" | ")}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={isZh ? "添加导入来源" : "Add Import Source"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>
              {isZh ? "类型" : "Type"}
            </label>
            <select
              value={addSource}
              onChange={(e) => {
                setAddSource(e.target.value);
                setAddFields({});
              }}
              className="w-full border rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
            >
              {Object.keys(IMPORT_SOURCE_FIELDS).map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </div>

          {IMPORT_SOURCE_FIELDS[addSource]?.map((field) => (
            <Input
              key={field.key}
              label={isZh ? field.labelZh : field.label}
              value={addFields[field.key] || ""}
              onChange={(e) =>
                setAddFields((prev) => ({
                  ...prev,
                  [field.key]: e.target.value,
                }))
              }
              placeholder={field.placeholder}
              type={field.type || "text"}
            />
          ))}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              {isZh ? "取消" : "Cancel"}
            </Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving
                ? (isZh ? "保存中..." : "Saving...")
                : (isZh ? "保存" : "Save")}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

const AI_STEPS = [
  { id: "scheme", labelZh: "方案生成", labelEn: "Scheme Generation", icon: FileTextIcon },
  { id: "review", labelZh: "代码审查", labelEn: "Code Review", icon: SearchIcon },
  { id: "schedule", labelZh: "排期生成", labelEn: "Schedule Generation", icon: CalendarIcon },
  { id: "execute", labelZh: "任务执行", labelEn: "Task Execution", icon: ZapIcon },
  { id: "test", labelZh: "测试生成", labelEn: "Test Generation", icon: FlaskIcon },
  { id: "skills", labelZh: "技能生成", labelEn: "Skill Generation", icon: TargetIcon },
];

const ALL_PROVIDER_OPTIONS = [
  { value: "", labelZh: "使用全局默认", labelEn: "Use Global Default" },
  { value: "acp", labelZh: "Claude Code (ACP)", labelEn: "Claude Code (ACP)" },
  { value: "codex-acp", labelZh: "Codex (ACP)", labelEn: "Codex (ACP)" },
  { value: "anthropic", labelZh: "Anthropic (Claude)", labelEn: "Anthropic (Claude)" },
  { value: "openai", labelZh: "OpenAI (GPT)", labelEn: "OpenAI (GPT)" },
  { value: "glm", labelZh: "GLM (智谱)", labelEn: "GLM (智谱)" },
];

function StepModelSectionInner({
  settings,
  setSettings,
  isZh,
  onSave,
}: {
  settings: Record<string, string>;
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isZh: boolean;
  onSave: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <p className="text-xs mb-4" style={{ color: "var(--outline)" }}>
        {isZh
          ? "为不同步骤设置不同的 AI 提供商和模型。留空则使用全局默认。"
          : "Set different AI providers and models for each step. Empty uses global default."}
      </p>
      <div className="rounded-lg border divide-y" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)", "--tw-divide-color": "var(--outline-variant)" } as React.CSSProperties}>
        {AI_STEPS.map((step) => {
          const provKey = `step_provider_${step.id}`;
          const modelKey = `step_model_${step.id}`;
          const selectedProvider = settings[provKey] || "";
          const isAcpProvider = selectedProvider === "acp" || selectedProvider === "codex-acp";

          return (
            <div key={step.id} className="px-4 py-3">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium w-24 shrink-0">
                  <>{step.icon({ size: 14, className: "inline-block align-[-2px]" })} {isZh ? step.labelZh : step.labelEn}</>
                </span>
                <select
                  value={selectedProvider}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [provKey]: e.target.value }))
                  }
                  className="flex-1 rounded-md border px-2 py-1.5 text-sm"
                  style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
                >
                  {ALL_PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {isZh ? opt.labelZh : opt.labelEn}
                    </option>
                  ))}
                </select>
                <input
                  value={settings[modelKey] || ""}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [modelKey]: e.target.value }))
                  }
                  placeholder={
                    isAcpProvider
                      ? (isZh ? "ACP 模型名，如 claude-sonnet-4-20250514" : "ACP model, e.g. claude-sonnet-4-20250514")
                      : (isZh ? "模型（可选）" : "Model (optional)")
                  }
                  className="flex-1 rounded-md border px-2 py-1.5 text-sm"
                  style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
                />
              </div>
              {isAcpProvider && (
                <p className="text-xs mt-1 ml-28" style={{ color: "var(--outline)" }}>
                  {isZh
                    ? `${selectedProvider === "codex-acp" ? "Codex" : "Claude Code"} ACP 引擎模型，留空使用默认`
                    : `Model for ${selectedProvider === "codex-acp" ? "Codex" : "Claude Code"} ACP engine. Leave empty for default.`}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <Button size="sm" onClick={handleSave}>
          {isZh ? "保存" : "Save"}
        </Button>
        {saved && <span className="text-sm text-[var(--success)]">✓</span>}
      </div>
    </div>
  );
}

interface MemoryItem {
  id: string;
  projectId: string | null;
  type: string;
  title: string;
  content: string;
  source: string;
  createdAt: string;
}

function MemorySectionInner({ isZh }: { isZh: boolean }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", content: "", type: "user" });

  const fetch_ = () => {
    fetch("/api/memories").then(r => r.json()).then(setItems).catch(() => {});
  };
  useEffect(() => { fetch_(); }, []);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (editId) {
      await fetch(`/api/memories/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else {
      await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source: "manual" }),
      });
    }
    setAddOpen(false);
    setEditId(null);
    setForm({ title: "", content: "", type: "user" });
    fetch_();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    fetch_();
  };

  const typeLabel = (t: string) => {
    const map: Record<string, string> = {
      project: isZh ? "项目" : "Project",
      user: isZh ? "用户" : "User",
      feedback: isZh ? "反馈" : "Feedback",
    };
    return map[t] || t;
  };

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          <>{isZh ? "记忆" : "Memories"}</> ({items.length})
        </h2>
        <Button size="sm" onClick={() => { setForm({ title: "", content: "", type: "user" }); setEditId(null); setAddOpen(true); }}>
          {isZh ? "添加记忆" : "Add Memory"}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--outline)" }}>
          {isZh ? "暂无记忆。AI 执行任务后会自动学习，你也可以手动添加。" : "No memories yet. AI learns automatically, or add manually."}
        </p>
      ) : (
        <div className="rounded-lg border divide-y" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          {items.map((m) => (
            <div key={m.id} className="px-4 py-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: "var(--on-surface)" }}>{m.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--outline-variant)", color: "var(--outline)" }}>
                      {typeLabel(m.type)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                      background: m.source === "auto" ? "rgba(59,130,246,0.15)" : "rgba(124,58,237,0.15)",
                      color: m.source === "auto" ? "#93c5fd" : "var(--secondary)",
                    }}>
                      {m.source === "auto" ? (isZh ? "自动" : "Auto") : (isZh ? "手动" : "Manual")}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--outline)" }}>{m.content}</p>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => { setForm({ title: m.title, content: m.content, type: m.type }); setEditId(m.id); setAddOpen(true); }}
                    className="text-xs px-2 py-1 rounded hover:opacity-80"
                    style={{ color: "var(--outline)" }}
                  >
                    {isZh ? "编辑" : "Edit"}
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="text-xs px-2 py-1 rounded text-[var(--error)] hover:opacity-80"
                  >
                    {isZh ? "删除" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <Dialog
          open={addOpen}
          onClose={() => { setAddOpen(false); setEditId(null); }}
          title={editId ? (isZh ? "编辑记忆" : "Edit Memory") : (isZh ? "添加记忆" : "Add Memory")}
        >
          <div className="space-y-3">
            <Input label={isZh ? "标题" : "Title"} value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder={isZh ? "如：技术栈是 Rust + eBPF" : "e.g.: Tech stack is Rust + eBPF"} />
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>{isZh ? "内容" : "Content"}</label>
              <textarea value={form.content} onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))} rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
                placeholder={isZh ? "详细描述..." : "Details..."} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>{isZh ? "类型" : "Type"}</label>
              <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}>
                <option value="user">{isZh ? "用户偏好" : "User Preference"}</option>
                <option value="project">{isZh ? "项目信息" : "Project Info"}</option>
                <option value="feedback">{isZh ? "反馈/教训" : "Feedback/Lesson"}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setAddOpen(false); setEditId(null); }}>{isZh ? "取消" : "Cancel"}</Button>
              <Button onClick={handleSave} disabled={!form.title.trim()}>{isZh ? "保存" : "Save"}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
