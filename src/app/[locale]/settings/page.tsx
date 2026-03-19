"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  claude?: { installed: boolean; loggedIn: boolean; email?: string };
}

interface SkillSummary {
  name: string;
  source: string;
  description: string;
}

const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyPlaceholder: "sk-ant-api03-...",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-20250414", "claude-3-5-sonnet-20241022"],
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    keyPlaceholder: "sk-...",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1", "o1-mini", "o3-mini"],
  },
  {
    id: "glm",
    label: "GLM (智谱)",
    keyPlaceholder: "glm-api-key...",
    models: ["glm-4-plus", "glm-4", "glm-4-air", "glm-4-flash"],
  },
] as const;

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
    <div>
      <a href={`/${locale}`} className="text-sm text-blue-600 hover:underline">
        &larr; {t("common.back")}
      </a>
      <h1 className="text-3xl font-bold mt-2 mb-8">{t("nav.settings")}</h1>

      {/* AI Providers */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          {isZh ? "AI 服务配置" : "AI Provider Configuration"}
        </h2>

        {/* Claude Code Login — for ACP engine */}
        <div className="rounded-lg border bg-white p-4 mb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">Claude Code</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">ACP</span>
            </div>
            <div className="flex items-center gap-2">
              {aiConfig?.claude?.loggedIn ? (
                <>
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                    ✓ {aiConfig.claude.email || (isZh ? "已登录" : "Logged in")}
                  </span>
                  {(aiConfig.claude as Record<string, unknown>)?.subscriptionType && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      {String((aiConfig.claude as Record<string, unknown>).subscriptionType)}
                    </span>
                  )}
                </>
              ) : aiConfig?.claude?.installed ? (
                <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                  {isZh ? "未登录" : "Not logged in"}
                </span>
              ) : (
                <span className="text-xs text-gray-400">
                  {isZh ? "未安装" : "Not installed"}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {isZh
              ? "使用 Claude 订阅认证。任务排期中选择「Claude Code (ACP)」引擎即可使用。未登录请运行: claude login"
              : "Uses your Claude subscription. Select 'Claude Code (ACP)' engine in task scheduler. To login: claude login"}
          </p>
        </div>

        <div className="space-y-3">
          {PROVIDERS.map((prov) => {
            const status = aiConfig?.[prov.id as keyof AiConfig] as ProviderStatus | undefined;
            const isEditing = editingProvider === prov.id;

            return (
              <div key={prov.id} className="rounded-lg border bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{prov.label}</span>
                  <div className="flex items-center gap-2">
                    {status?.configured ? (
                      <>
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                          ✓ {status.masked || (status.baseURL ? "Proxy" : "OK")}
                        </span>
                        {settings[`default_model_${prov.id}`] && (
                          <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-mono">
                            {settings[`default_model_${prov.id}`]}
                          </span>
                        )}
                        {status.baseURL && (
                          <span className="text-xs text-gray-400 font-mono">
                            {status.baseURL.slice(0, 30)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {isZh ? "未配置" : "Not configured"}
                      </span>
                    )}
                    {status?.configured && !isEditing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await fetch(`/api/ai-config?provider=${prov.id}`, { method: "DELETE" });
                          // Also clear model setting
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
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        {isZh ? "清除" : "Clear"}
                      </Button>
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
                  <div className="mt-3 space-y-3 border-t pt-3">
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {isZh ? "模型" : "Model"}
                      </label>
                      <div className="flex gap-2">
                        <select
                          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={editModel}
                          onChange={(e) => setEditModel(e.target.value)}
                        >
                          <option value="">{isZh ? "默认" : "Default"}</option>
                          {prov.models.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <input
                          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
      </section>

      {/* General Settings */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          {isZh ? "通用设置" : "General Settings"}
        </h2>
        <div className="rounded-lg border bg-white p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "默认 AI 提供商" : "Default AI Provider"}
            </label>
            <select
              value={settings.default_provider || "anthropic"}
              onChange={(e) => setSettings((s) => ({ ...s, default_provider: e.target.value }))}
              className="w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="acp">Claude Code (ACP)</option>
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
            {saved && <span className="text-sm text-green-600">✓</span>}
          </div>
        </div>
      </section>

      {/* Skills */}
      <SkillsSection
        skills={skills}
        skillsBySource={skillsBySource}
        isZh={isZh}
        hasAi={!!(aiConfig?.anthropic?.configured || aiConfig?.openai?.configured || aiConfig?.glm?.configured)}
        onSkillsChange={() => fetch("/api/skills").then((r) => r.json()).then(setSkills)}
      />
    </div>
  );
}

function SkillsSection({
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
  const [streamContent, setStreamContent] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setResult(null);
    setStreamContent("");
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
          // Check for result markers
          if (content.includes("__SKILL_INSTALLED__:")) {
            const name = content.split("__SKILL_INSTALLED__:")[1]?.trim();
            setResult(isZh ? `已安装: ${name}` : `Installed: ${name}`);
            setPrompt("");
            onSkillsChange();
          } else if (content.includes("__SKILL_ERROR__:")) {
            const err = content.split("__SKILL_ERROR__:")[1]?.trim();
            setResult(err || (isZh ? "生成失败" : "Generation failed"));
          } else {
            setStreamContent(content);
          }
        }
      } else {
        setResult(isZh ? "生成失败" : "Generation failed");
      }
    } catch {
      setResult(isZh ? "生成失败" : "Generation failed");
    } finally {
      setGenerating(false);
      setStreamContent("");
    }
  };

  const handleDelete = async (name: string) => {
    await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    onSkillsChange();
  };

  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-4">
        {isZh ? "技能" : "Skills"} ({skills.length})
      </h2>

      {/* Generate skill from prompt */}
      <div className="rounded-lg border bg-white p-4 mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          {isZh ? "通过描述安装技能" : "Install Skill from Prompt"}
        </h3>
        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
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
        {/* Streaming preview */}
        {generating && streamContent && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded border bg-gray-50 p-3">
            <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono">{streamContent}</pre>
          </div>
        )}
        {result && (
          <p className={`text-xs mt-2 ${result.startsWith("Installed") || result.startsWith("已安装") ? "text-green-600" : "text-red-500"}`}>
            {result}
          </p>
        )}
      </div>

      {/* Installed skills */}
      {Object.entries(skillsBySource).map(([source, items]) => (
        <div key={source} className="mb-4">
          <h3 className="text-sm font-medium text-gray-500 mb-2">
            {source} ({items.length})
          </h3>
          <div className="rounded-lg border bg-white divide-y">
            {items.map((skill) => (
              <div key={skill.name} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm">{skill.name}</span>
                  {skill.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{skill.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(skill.name)}
                  className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded"
                >
                  {isZh ? "删除" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {skills.length === 0 && (
        <p className="text-gray-500 text-sm">
          {isZh ? "未找到技能（~/.claude/skills/）" : "No skills found in ~/.claude/skills/"}
        </p>
      )}
    </section>
  );
}
