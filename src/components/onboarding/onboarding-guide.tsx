"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { RepoPicker } from "@/components/repo-picker/repo-picker";
import { AnalyzePrompt } from "@/components/project/analyze-prompt";
import { IconPicker } from "@/components/ui/icon-picker";

interface OnboardingGuideProps {
  locale: string;
  onComplete: (project: {
    name: string;
    icon: string;
    description: string;
    guidelines: string;
    targetRepoPath: string;
  }) => void;
}

const STEPS = ["welcome", "github", "ai", "concept", "create"] as const;
type Step = (typeof STEPS)[number];

interface GithubStatus {
  authenticated: boolean;
  ghInstalled: boolean;
  username: string;
}

interface ProviderStatus {
  configured: boolean;
  masked: string;
  baseURL: string;
  mode: "apikey" | "proxy" | "none";
}

interface AiStatus {
  anthropic: ProviderStatus;
  openai: ProviderStatus;
  glm: ProviderStatus;
}

export function OnboardingGuide({ locale, onComplete }: OnboardingGuideProps) {
  const t = useTranslations();
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📁");
  const [description, setDescription] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [targetRepoPath, setTargetRepoPath] = useState("");

  // GitHub state
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [checkingGithub, setCheckingGithub] = useState(false);

  // AI state
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [checkingAi, setCheckingAi] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  // Per-provider form state
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicUrl, setAnthropicUrl] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [glmKey, setGlmKey] = useState("");
  const [glmUrl, setGlmUrl] = useState("");
  const [claudeStatus, setClaudeStatus] = useState<{ installed: boolean; loggedIn: boolean; email?: string } | null>(null);
  const [openaiUrl, setOpenaiUrl] = useState("");

  const isZh = locale === "zh";

  // Auto-detect all configs on mount
  useEffect(() => {
    // Check GitHub
    fetch("/api/github/auth")
      .then((r) => r.json())
      .then((d) => setGithubStatus(d))
      .catch(() => {});
    // Check AI
    fetch("/api/ai-config")
      .then((r) => r.json())
      .then((d) => {
        setAiStatus(d);
        setClaudeStatus(d.claude || null);
      })
      .catch(() => {});
  }, []);

  const checkGithubAuth = async () => {
    setCheckingGithub(true);
    try {
      const res = await fetch("/api/github/auth");
      setGithubStatus(await res.json());
    } catch {
      setGithubStatus({ authenticated: false, ghInstalled: false, username: "" });
    }
    setCheckingGithub(false);
  };

  const checkAiConfig = async () => {
    setCheckingAi(true);
    try {
      const res = await fetch("/api/ai-config");
      const data = await res.json();
      setAiStatus(data);
      setClaudeStatus(data.claude || null);
    } catch {
      setAiStatus(null);
    }
    setCheckingAi(false);
  };

  const saveProvider = async (provider: "anthropic" | "openai" | "glm") => {
    const keyMap = { anthropic: anthropicKey, openai: openaiKey, glm: glmKey };
    const urlMap = { anthropic: anthropicUrl, openai: openaiUrl, glm: glmUrl };
    const apiKey = keyMap[provider];
    const baseURL = urlMap[provider];
    if (!apiKey && !baseURL) return;

    setSavingProvider(provider);
    try {
      await fetch("/api/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: apiKey || undefined,
          baseURL: baseURL || undefined,
        }),
      });
      if (provider === "anthropic") { setAnthropicKey(""); setAnthropicUrl(""); }
      else if (provider === "openai") { setOpenaiKey(""); setOpenaiUrl(""); }
      else { setGlmKey(""); setGlmUrl(""); }
      await checkAiConfig();
    } finally {
      setSavingProvider(null);
    }
  };

  const handleCreate = () => {
    if (!name || !targetRepoPath) return;
    onComplete({ name, icon, description, guidelines, targetRepoPath });
  };

  const anyAiConfigured =
    aiStatus?.anthropic.configured ||
    aiStatus?.openai.configured ||
    aiStatus?.glm?.configured ||
    claudeStatus?.loggedIn;

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="max-w-2xl w-full">

        {/* Step 1: Welcome */}
        {step === "welcome" && (
          <div className="text-center space-y-6">
            <h1 className="text-4xl font-bold">
              {isZh ? "欢迎使用 Siege" : "Welcome to Siege"}
            </h1>
            <p className="text-lg text-gray-600">
              {isZh
                ? "AI 驱动的智能体开发工具，从方案设计到代码实现的完整工作流。"
                : "AI-powered agent development tool. From design to implementation, all in one place."}
            </p>

            {/* Show detected status */}
            {(githubStatus || aiStatus) && (
              <div className="flex justify-center gap-4 text-xs">
                {githubStatus?.authenticated && (
                  <span className="text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    ✓ GitHub: {githubStatus.username}
                  </span>
                )}
                {aiStatus?.anthropic.configured && (
                  <span className="text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    ✓ Anthropic
                  </span>
                )}
                {claudeStatus?.loggedIn && !aiStatus?.anthropic.configured && (
                  <span className="text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    ✓ Claude Login
                  </span>
                )}
                {aiStatus?.openai.configured && (
                  <span className="text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    ✓ OpenAI
                  </span>
                )}
                {aiStatus?.glm?.configured && (
                  <span className="text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    ✓ GLM
                  </span>
                )}
              </div>
            )}

            <div className="flex justify-center gap-3 pt-4">
              <Button
                size="lg"
                onClick={() => setStep("github")}
              >
                {isZh ? "开始设置" : "Get Started"}
              </Button>
              {anyAiConfigured && (
                <Button size="lg" variant="ghost" onClick={() => setStep("create")}>
                  {isZh ? "直接创建项目" : "Create project now"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: GitHub — ask first, then check */}
        {step === "github" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold">
                {isZh ? "是否关联 GitHub？" : "Connect GitHub?"}
              </h2>
              <p className="text-gray-500 mt-1">
                {isZh
                  ? "关联后可以直接从 GitHub 仓库列表选择项目并克隆。不关联可以从本地目录选择。"
                  : "Connect to select and clone repos from GitHub. You can also use local directories."}
              </p>
            </div>

            {githubStatus === null ? (
              // Initial: ask user if they want to connect
              <div className="flex flex-col items-center gap-4 py-6">
                <Button
                  size="lg"
                  onClick={() => checkGithubAuth()}
                >
                  {isZh ? "是，检测 GitHub 连接" : "Yes, check GitHub connection"}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => { setStep("ai"); checkAiConfig(); }}
                >
                  {isZh ? "跳过，只用本地目录" : "Skip, use local directories only"}
                </Button>
              </div>
            ) : (
              // After checking
              <div className="rounded-lg border bg-white p-6">
                {checkingGithub ? (
                  <div className="text-center py-8 text-gray-400">
                    {isZh ? "检查中..." : "Checking..."}
                  </div>
                ) : !githubStatus.ghInstalled ? (
                  <div className="text-center space-y-4 py-4">
                    <div className="text-4xl">⚠️</div>
                    <p className="text-gray-600">
                      {isZh
                        ? "未检测到 GitHub CLI (gh)。安装后可以连接。"
                        : "GitHub CLI (gh) not detected."}
                    </p>
                    <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm">
                      https://cli.github.com
                    </a>
                    <div className="pt-2">
                      <Button variant="secondary" onClick={checkGithubAuth}>
                        {isZh ? "重新检测" : "Re-check"}
                      </Button>
                    </div>
                  </div>
                ) : githubStatus.authenticated ? (
                  <div className="text-center space-y-3 py-4">
                    <div className="text-4xl">✓</div>
                    <p className="text-gray-800 font-medium">
                      {isZh ? `已连接：${githubStatus.username}` : `Connected: ${githubStatus.username}`}
                    </p>
                  </div>
                ) : (
                  <div className="text-center space-y-4 py-4">
                    <div className="text-4xl">🔗</div>
                    <p className="text-gray-600">
                      {isZh ? "GitHub CLI 已安装，但未登录。在终端运行：" : "gh installed but not logged in. Run:"}
                    </p>
                    <code className="block bg-gray-100 rounded-md px-4 py-2 text-sm font-mono">
                      gh auth login
                    </code>
                    <Button variant="secondary" onClick={checkGithubAuth}>
                      {isZh ? "登录后重新检测" : "Re-check after login"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {githubStatus !== null && (
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("welcome")}>{t("common.back")}</Button>
                <Button size="lg" onClick={() => { setStep("ai"); checkAiConfig(); }}>
                  {isZh ? "继续" : "Continue"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: AI Configuration */}
        {step === "ai" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold">
                {isZh ? "配置 AI 服务" : "Configure AI Service"}
              </h2>
              <p className="text-gray-500 mt-1">
                {isZh
                  ? "至少配置一个 AI 提供商，支持直连 API 或中转站代理。"
                  : "Configure at least one AI provider. Supports direct API or proxy relay."}
              </p>
            </div>

            <div className="space-y-4">
              {checkingAi ? (
                <div className="text-center py-8 text-gray-400">
                  {isZh ? "检查中..." : "Checking..."}
                </div>
              ) : (
                <>
                  {/* Anthropic */}
                  <ProviderConfigCard
                    name="Anthropic (Claude)"
                    status={aiStatus?.anthropic}
                    apiKey={anthropicKey}
                    baseURL={anthropicUrl}
                    onApiKeyChange={setAnthropicKey}
                    onBaseURLChange={setAnthropicUrl}
                    onSave={() => saveProvider("anthropic")}
                    saving={savingProvider === "anthropic"}
                    isZh={isZh}
                    keyPlaceholder="sk-ant-api03-..."
                    urlPlaceholder="https://api.anthropic.com"
                  />

                  {/* Claude Login */}
                  {claudeStatus?.installed && (
                    <div className="rounded-lg border bg-white p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">Claude Code Login</span>
                        {claudeStatus.loggedIn ? (
                          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                            ✓ {claudeStatus.email || (isZh ? "已登录" : "Logged in")}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            {isZh ? "未登录" : "Not logged in"}
                          </span>
                        )}
                      </div>
                      {!claudeStatus.loggedIn && (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs text-gray-500">
                            {isZh
                              ? "通过 Claude Code 登录可免 API Key 使用 Anthropic 模型："
                              : "Login via Claude Code to use Anthropic without API key:"}
                          </p>
                          <code className="block bg-gray-100 rounded px-3 py-1.5 text-xs font-mono">
                            claude login
                          </code>
                          <Button variant="secondary" size="sm" onClick={checkAiConfig}>
                            {isZh ? "重新检测" : "Re-check"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* OpenAI */}
                  <ProviderConfigCard
                    name="OpenAI (GPT)"
                    status={aiStatus?.openai}
                    apiKey={openaiKey}
                    baseURL={openaiUrl}
                    onApiKeyChange={setOpenaiKey}
                    onBaseURLChange={setOpenaiUrl}
                    onSave={() => saveProvider("openai")}
                    saving={savingProvider === "openai"}
                    isZh={isZh}
                    keyPlaceholder="sk-..."
                    urlPlaceholder="https://api.openai.com/v1"
                  />

                  {/* GLM (ZhiPu) */}
                  <ProviderConfigCard
                    name="GLM (智谱)"
                    status={aiStatus?.glm}
                    apiKey={glmKey}
                    baseURL={glmUrl}
                    onApiKeyChange={setGlmKey}
                    onBaseURLChange={setGlmUrl}
                    onSave={() => saveProvider("glm")}
                    saving={savingProvider === "glm"}
                    isZh={isZh}
                    keyPlaceholder="glm-api-key..."
                    urlPlaceholder="https://open.bigmodel.cn/api/paas/v4"
                  />

                  {!anyAiConfigured && !claudeStatus?.loggedIn && (
                    <p className="text-xs text-amber-600 text-center">
                      {isZh
                        ? "⚠️ 至少配置一个提供商才能使用 AI 功能"
                        : "⚠️ At least one provider is required for AI features"}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("github")}>{t("common.back")}</Button>
              <Button size="lg" onClick={() => setStep("concept")} disabled={aiStatus !== null && !anyAiConfigured}>
                {isZh ? "继续" : "Continue"}
              </Button>
            </div>
            {!anyAiConfigured && !checkingAi && aiStatus !== null && (
              <p className="text-xs text-amber-600 text-center">
                {isZh
                  ? "请至少配置一个 AI 提供商后再继续"
                  : "Please configure at least one AI provider to continue"}
              </p>
            )}
          </div>
        )}

        {/* Step 4: Core Workflow */}
        {step === "concept" && (
          <div className="space-y-8">
            <h2 className="text-2xl font-bold text-center">
              {isZh ? "核心工作流" : "Core Workflow"}
            </h2>
            <div className="grid grid-cols-1 gap-4">
              {[
                { icon: "📋", title: isZh ? "1. 创建计划" : "1. Create Plan", desc: isZh ? "描述你的需求，AI 自动生成标题。在文件夹中组织多个计划。" : "Describe your needs, AI generates the title. Organize plans in folders." },
                { icon: "🔍", title: isZh ? "2. 生成方案" : "2. Generate Scheme", desc: isZh ? "AI 搜索互联网和本地代码，生成技术方案。你可以编辑和审查。" : "AI searches the web and local code to generate technical schemes. Edit and review." },
                { icon: "📊", title: isZh ? "3. 生成排期" : "3. Generate Schedule", desc: isZh ? "确认方案后，AI 拆解为可执行任务，甘特图可视化排期。" : "After confirming schemes, AI breaks them into executable tasks with Gantt chart." },
                { icon: "⚡", title: isZh ? "4. 执行" : "4. Execute", desc: isZh ? "通过 Claude Code 或 Codex 自动执行，实时查看进度。" : "Execute via Claude Code or Codex CLI with real-time progress." },
                { icon: "🔎", title: isZh ? "5. 代码审查" : "5. Code Review", desc: isZh ? "AI 审查实现代码的质量、安全性和可维护性。" : "AI reviews code quality, security, and maintainability." },
                { icon: "✅", title: isZh ? "6. 测试" : "6. Test", desc: isZh ? "AI 生成测试用例并运行，确保实现正确。" : "AI generates and runs tests to verify the implementation." },
              ].map((item) => (
                <div key={item.title} className="flex gap-4 items-start rounded-lg border bg-white p-4">
                  <span className="text-2xl">{item.icon}</span>
                  <div>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-sm text-gray-600">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep("ai")}>{t("common.back")}</Button>
              <Button size="lg" onClick={() => setStep("create")}>
                {isZh ? "创建第一个项目" : "Create Your First Project"}
              </Button>
            </div>
          </div>
        )}

        {/* Step 5: Create first project */}
        {step === "create" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold">
                {isZh ? "创建第一个项目" : "Create Your First Project"}
              </h2>
              <p className="text-gray-500 mt-1">
                {isZh
                  ? "项目关联一个代码仓库，所有计划和执行都基于此。"
                  : "A project is linked to a code repository. All plans and executions are based on it."}
              </p>
            </div>
            <div className="rounded-lg border bg-white p-6 space-y-4">
              <div className="flex items-end gap-3">
                <IconPicker value={icon} onChange={setIcon} />
                <div className="flex-1">
                  <Input
                    label={t("project.name")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={isZh ? "例如：My Awesome App" : "e.g., My Awesome App"}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("project.description")}
                </label>
                <MarkdownEditor value={description} onChange={setDescription} height={120} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? "架构与开发规范（可选）" : "Architecture & Guidelines (optional)"}
                </label>
                <MarkdownEditor
                  value={guidelines}
                  onChange={setGuidelines}
                  height={100}
                  placeholder={isZh
                    ? "例如：使用 TDD、RESTful API 设计、ESLint 代码风格..."
                    : "e.g., Use TDD, RESTful API design, ESLint for code style..."}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("project.targetRepoPath")}
                </label>
                {targetRepoPath ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-gray-50">
                      <span className="text-sm font-mono flex-1 truncate">{targetRepoPath}</span>
                      <Button variant="ghost" size="sm" onClick={() => setTargetRepoPath("")}>
                        {isZh ? "重选" : "Change"}
                      </Button>
                    </div>
                    {!description && (
                      <AnalyzePrompt
                        repoPath={targetRepoPath}
                        isZh={isZh}
                        onResult={(desc) => setDescription(desc)}
                      />
                    )}
                  </div>
                ) : (
                  <RepoPicker
                    locale={locale}
                    githubAuthed={githubStatus?.authenticated || false}
                    onSelect={(path) => {
                      setTargetRepoPath(path);
                      if (!name) setName(path.split("/").pop() || "");
                    }}
                  />
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("concept")}>{t("common.back")}</Button>
              <Button size="lg" onClick={handleCreate} disabled={!name || !targetRepoPath}>
                {t("common.create")}
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

const PROVIDER_LOGIN_URLS: Record<string, string> = {
  "Anthropic (Claude)": "https://console.anthropic.com/settings/keys",
  "OpenAI (GPT)": "https://platform.openai.com/api-keys",
  "GLM (智谱)": "https://open.bigmodel.cn/usercenter/apikeys",
};

/* Sub-component for per-provider config */
function ProviderConfigCard({
  name,
  status,
  apiKey,
  baseURL,
  onApiKeyChange,
  onBaseURLChange,
  onSave,
  saving,
  isZh,
  keyPlaceholder,
  urlPlaceholder,
}: {
  name: string;
  status?: ProviderStatus;
  apiKey: string;
  baseURL: string;
  onApiKeyChange: (v: string) => void;
  onBaseURLChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  isZh: boolean;
  keyPlaceholder: string;
  urlPlaceholder: string;
}) {
  const [mode, setMode] = useState<"login" | "apikey" | "proxy">(
    status?.mode === "proxy" ? "proxy" : "login"
  );
  const [loginOpened, setLoginOpened] = useState(false);
  const loginUrl = PROVIDER_LOGIN_URLS[name] || "";

  if (status?.configured) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">{name}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {status.mode === "proxy"
                ? isZh ? "中转站" : "Proxy"
                : "API Key"}
            </span>
            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              ✓ {status.masked || (status.baseURL ? status.baseURL.slice(0, 30) : "")}
            </span>
          </div>
        </div>
        {status.baseURL && (
          <p className="text-xs text-gray-400 mt-1 font-mono truncate">
            {status.baseURL}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{name}</span>
        <div className="flex gap-1 bg-gray-100 rounded-md p-0.5">
          <button
            onClick={() => setMode("login")}
            className={`px-2 py-1 text-xs rounded ${
              mode === "login" ? "bg-white shadow-sm font-medium" : "text-gray-500"
            }`}
          >
            {isZh ? "登录获取" : "Login"}
          </button>
          <button
            onClick={() => setMode("apikey")}
            className={`px-2 py-1 text-xs rounded ${
              mode === "apikey" ? "bg-white shadow-sm font-medium" : "text-gray-500"
            }`}
          >
            API Key
          </button>
          <button
            onClick={() => setMode("proxy")}
            className={`px-2 py-1 text-xs rounded ${
              mode === "proxy" ? "bg-white shadow-sm font-medium" : "text-gray-500"
            }`}
          >
            {isZh ? "中转站" : "Proxy"}
          </button>
        </div>
      </div>

      {mode === "login" && !loginOpened && (
        <div className="text-center space-y-3 py-2">
          <p className="text-xs text-gray-500">
            {isZh
              ? "点击下方按钮跳转到平台获取 API Key，复制后粘贴到输入框。"
              : "Click below to open the platform, copy your API Key, then paste it here."}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              window.open(loginUrl, "_blank");
              setLoginOpened(true);
            }}
          >
            {isZh ? `前往 ${name} 获取 Key` : `Go to ${name} for Key`}
          </Button>
        </div>
      )}

      {(mode !== "login" || loginOpened) && (
        <>
          {mode === "login" && loginOpened && (
            <p className="text-xs text-blue-600 text-center">
              {isZh
                ? "已在新标签页打开平台，复制 API Key 后粘贴到下方："
                : "Platform opened in new tab. Paste your API Key below:"}
            </p>
          )}

          <Input
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={keyPlaceholder}
            type="password"
            label="API Key"
          />

          {mode === "proxy" && (
            <Input
              value={baseURL}
              onChange={(e) => onBaseURLChange(e.target.value)}
              placeholder={urlPlaceholder}
              label="Base URL"
            />
          )}

          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || (!apiKey && !baseURL)}
            className="w-full"
          >
            {saving
              ? isZh ? "保存中..." : "Saving..."
              : isZh ? "保存" : "Save"}
          </Button>
        </>
      )}
    </div>
  );
}
