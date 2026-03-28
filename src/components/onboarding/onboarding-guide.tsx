"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { RepoPicker } from "@/components/repo-picker/repo-picker";
import { AnalyzePrompt } from "@/components/project/analyze-prompt";
import { IconPicker } from "@/components/ui/icon-picker";
import { openExternal } from "@/lib/open-external";
import { ClipboardIcon, SearchIcon, BarChartIcon, ZapIcon, CodeIcon, CheckCircleIcon, AlertTriangleIcon, TailscaleLogo } from "@/components/ui/icons";
import { apiFetch } from "@/lib/api";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

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

const STEPS = ["welcome", "github", "tailscale", "ai", "concept", "create"] as const;
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

  // Tailscale state
  const [tsStatus, setTsStatus] = useState<{ running: boolean; peers: any[]; self?: any; error?: string } | null>(null);
  const [checkingTs, setCheckingTs] = useState(false);
  const [tsLoggingIn, setTsLoggingIn] = useState(false);

  const isZh = locale === "zh";

  // Auto-detect all configs on mount
  useEffect(() => {
    // Check GitHub
    apiFetch("/api/github/auth")
      .then((r) => r.json())
      .then((d) => setGithubStatus(d))
      .catch(() => {});
    // Check AI
    apiFetch("/api/ai-config")
      .then((r) => r.json())
      .then((d) => {
        setAiStatus(d);
        setClaudeStatus(d.claude || null);
      })
      .catch(() => {});
    // Check Tailscale
    apiFetch("/api/tailscale/status")
      .then((r) => r.json())
      .then((d) => setTsStatus(d))
      .catch(() => setTsStatus({ running: false, peers: [] }));
  }, []);

  // GitHub login flow state
  const [githubLoginCode, setGithubLoginCode] = useState<string | null>(null);
  const [githubLoginError, setGithubLoginError] = useState<string | null>(null);
  const [githubLoggingIn, setGithubLoggingIn] = useState(false);
  const [githubTokenInput, setGithubTokenInput] = useState("");
  const [showTokenInput, setShowTokenInput] = useState(false);

  const checkGithubAuth = async () => {
    setCheckingGithub(true);
    try {
      const res = await apiFetch("/api/github/auth");
      setGithubStatus(await res.json());
    } catch {
      setGithubStatus({ authenticated: false, ghInstalled: false, username: "" });
    }
    setCheckingGithub(false);
  };

  // Start GitHub login — show token input or handle device flow
  const startGithubLogin = async () => {
    setGithubLoggingIn(true);
    setGithubLoginError(null);
    setGithubLoginCode(null);
    try {
      const res = await apiFetch("/api/github/auth", { method: "POST" });
      const data = await res.json();
      if (data.status === "already_authenticated" || data.status === "authenticated") {
        setGithubStatus({ authenticated: true, ghInstalled: true, username: data.username });
        setGithubLoggingIn(false);
        setShowTokenInput(false);
        return;
      }
      if (data.status === "need_token") {
        // Show token input field
        setShowTokenInput(true);
        setGithubLoggingIn(false);
        if (data.helpUrl) openExternal(data.helpUrl);
        return;
      }
      if (data.code) {
        setGithubLoginCode(data.code);
        openExternal(data.verificationUrl);
        const poll = setInterval(async () => {
          try {
            const r = await apiFetch("/api/github/auth");
            const s = await r.json();
            if (s.authenticated) {
              clearInterval(poll);
              setGithubStatus(s);
              setGithubLoggingIn(false);
              setGithubLoginCode(null);
            }
          } catch { /* keep polling */ }
        }, 2000);
        setTimeout(() => {
          clearInterval(poll);
          setGithubLoggingIn(false);
          setGithubLoginError(isZh ? "授权超时，请重试" : "Authorization timed out");
        }, 300000);
      } else {
        setGithubLoggingIn(false);
        setGithubLoginError(data.error || (isZh ? "登录失败" : "Login failed"));
      }
    } catch {
      setGithubLoggingIn(false);
      setGithubLoginError(isZh ? "请求失败" : "Request failed");
    }
  };

  // Submit GitHub token
  const submitGithubToken = async () => {
    if (!githubTokenInput.trim()) return;
    setGithubLoggingIn(true);
    setGithubLoginError(null);
    try {
      const res = await apiFetch("/api/github/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: githubTokenInput.trim() }),
      });
      const data = await res.json();
      if (data.status === "authenticated" || data.status === "already_authenticated") {
        setGithubStatus({ authenticated: true, ghInstalled: true, username: data.username });
        setShowTokenInput(false);
        setGithubTokenInput("");
      } else {
        setGithubLoginError(data.error || (isZh ? "Token 无效" : "Invalid token"));
      }
    } catch {
      setGithubLoginError(isZh ? "请求失败" : "Request failed");
    }
    setGithubLoggingIn(false);
  };

  const checkAiConfig = async () => {
    setCheckingAi(true);
    try {
      const res = await apiFetch("/api/ai-config");
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
      await apiFetch("/api/ai-config", {
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

  const codexStatus = (aiStatus as any)?.codex;
  const anyAiConfigured =
    aiStatus?.anthropic.configured ||
    aiStatus?.openai.configured ||
    aiStatus?.glm?.configured ||
    claudeStatus?.loggedIn ||
    claudeStatus?.installed ||
    codexStatus?.installed;

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="max-w-2xl w-full">

        {/* Step 1: Welcome */}
        {step === "welcome" && (
          <div className="text-center space-y-6">
            <h1 className="text-4xl font-bold">
              {isZh ? "欢迎使用 Siege" : "Welcome to Siege"}
            </h1>
            <p className="text-lg text-[var(--outline)]">
              {isZh
                ? "AI 驱动的智能体开发工具，从方案设计到代码实现的完整工作流。"
                : "AI-powered agent development tool. From design to implementation, all in one place."}
            </p>

            {/* Show detected status */}
            {(githubStatus || aiStatus) && (
              <div className="flex justify-center gap-4 text-xs">
                {githubStatus?.authenticated && (
                  <span className="text-[var(--success)] bg-[var(--success)]/15 px-2 py-1 rounded-full inline-flex items-center gap-1">
                    <GitHubIcon className="w-3 h-3" /> {githubStatus.username}
                  </span>
                )}
                {aiStatus?.anthropic.configured && (
                  <span className="text-[var(--success)] bg-[var(--success)]/15 px-2 py-1 rounded-full">
                    ✓ Anthropic
                  </span>
                )}
                {claudeStatus?.loggedIn && !aiStatus?.anthropic.configured && (
                  <span className="text-[var(--success)] bg-[var(--success)]/15 px-2 py-1 rounded-full">
                    ✓ Claude Login
                  </span>
                )}
                {aiStatus?.openai.configured && (
                  <span className="text-[var(--success)] bg-[var(--success)]/15 px-2 py-1 rounded-full">
                    ✓ OpenAI
                  </span>
                )}
                {aiStatus?.glm?.configured && (
                  <span className="text-[var(--success)] bg-[var(--success)]/15 px-2 py-1 rounded-full">
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
              <h2 className="text-2xl font-bold inline-flex items-center gap-2 justify-center w-full">
                <GitHubIcon className="w-7 h-7" />
                {isZh ? "关联 GitHub" : "Connect GitHub"}
              </h2>
              <p className="text-[var(--outline)] mt-1">
                {isZh
                  ? "关联后可以直接从 GitHub 仓库列表选择项目并克隆。不关联可以从本地目录选择。"
                  : "Connect to select and clone repos from GitHub. You can also use local directories."}
              </p>
            </div>

            <div className="rounded-lg border bg-[var(--surface-container-high)] p-6">
              {checkingGithub ? (
                <div className="text-center py-8 text-[var(--outline)]">
                  {isZh ? "检查中..." : "Checking..."}
                </div>
              ) : githubStatus?.authenticated ? (
                <div className="text-center space-y-3 py-4">
                  <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-[var(--success)]/15 flex items-center justify-center">
                      <GitHubIcon className="w-7 h-7 text-[var(--success)]" />
                    </div>
                  </div>
                  <p className="text-[var(--on-surface)] font-medium">
                    {isZh ? `已连接：${githubStatus.username}` : `Connected: ${githubStatus.username}`}
                  </p>
                </div>
              ) : showTokenInput ? (
                <div className="space-y-4 py-4">
                  <p className="text-sm text-center text-[var(--outline)]">
                    {isZh
                      ? "请输入 GitHub Personal Access Token（需要 repo 权限）"
                      : "Enter a GitHub Personal Access Token (needs repo scope)"}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={githubTokenInput}
                      onChange={(e) => setGithubTokenInput(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      className="flex-1 rounded-md px-3 py-2 text-sm font-mono"
                      style={{ background: "var(--surface-container)", color: "var(--on-surface)", border: "1px solid var(--outline-variant)" }}
                      onKeyDown={(e) => e.key === "Enter" && submitGithubToken()}
                    />
                    <Button onClick={submitGithubToken} disabled={githubLoggingIn || !githubTokenInput.trim()}>
                      {githubLoggingIn ? (isZh ? "验证中..." : "Verifying...") : (isZh ? "确认" : "Confirm")}
                    </Button>
                  </div>
                  {githubLoginError && (
                    <p className="text-sm text-[var(--error)] text-center">{githubLoginError}</p>
                  )}
                  <p className="text-xs text-center">
                    <button
                      className="text-[var(--primary)] hover:underline"
                      onClick={() => openExternal("https://github.com/settings/tokens/new?scopes=repo,read:org&description=Siege")}
                    >
                      {isZh ? "点此创建 Token →" : "Create a token here →"}
                    </button>
                  </p>
                </div>
              ) : githubLoggingIn && githubLoginCode ? (
                <div className="text-center space-y-4 py-4">
                  <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-[var(--outline-variant)] flex items-center justify-center animate-pulse">
                      <GitHubIcon className="w-7 h-7 text-[var(--on-surface)]" />
                    </div>
                  </div>
                  <p className="text-[var(--outline)]">
                    {isZh
                      ? "已在浏览器中打开 GitHub 授权页面，请输入以下验证码："
                      : "GitHub authorization page opened. Enter this code:"}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-2xl font-bold font-mono tracking-widest bg-[var(--outline-variant)] rounded-lg px-6 py-3">
                      {githubLoginCode}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(githubLoginCode)}
                    >
                      {isZh ? "复制" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--outline)]">
                    {isZh ? "等待授权完成..." : "Waiting for authorization..."}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openExternal("https://github.com/login/device")}
                  >
                    {isZh ? "重新打开授权页面" : "Re-open authorization page"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-6">
                  {githubLoginError && (
                    <p className="text-sm text-[var(--error)]">{githubLoginError}</p>
                  )}
                  <Button
                    size="lg"
                    onClick={startGithubLogin}
                    disabled={githubLoggingIn}
                    className="inline-flex items-center gap-2"
                  >
                    <GitHubIcon className="w-5 h-5" />
                    {githubLoggingIn
                      ? (isZh ? "正在启动..." : "Starting...")
                      : (isZh ? "登录 GitHub" : "Login with GitHub")}
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    onClick={() => setStep("tailscale")}
                  >
                    {isZh ? "跳过，只用本地目录" : "Skip, use local directories only"}
                  </Button>
                </div>
              )}
            </div>

            {githubStatus?.authenticated && (
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("welcome")}>{t("common.back")}</Button>
                <Button size="lg" onClick={() => setStep("tailscale")}>
                  {isZh ? "继续" : "Continue"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step: Tailscale */}
        {step === "tailscale" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold inline-flex items-center gap-2 justify-center w-full">
                <TailscaleLogo size={28} /> Tailscale
              </h2>
              <p className="text-[var(--outline)] mt-1">
                {isZh
                  ? "连接 Tailscale 后可以在远程机器上执行 AI 任务。不需要可以跳过。"
                  : "Connect Tailscale to execute AI tasks on remote machines. Skip if not needed."}
              </p>
            </div>

            <div className="rounded-lg border bg-[var(--surface-container-high)] p-6">
              {checkingTs ? (
                <div className="text-center py-8 text-[var(--outline)]">
                  {isZh ? "检查中..." : "Checking..."}
                </div>
              ) : tsStatus?.running ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 justify-center">
                    <div className="w-3 h-3 rounded-full" style={{ background: "var(--success)" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--success)" }}>
                      {isZh ? "Tailscale 已连接" : "Tailscale Connected"}
                    </span>
                    {tsStatus.self?.hostname && (
                      <span className="text-xs" style={{ color: "var(--outline)" }}>
                        ({tsStatus.self.hostname})
                      </span>
                    )}
                  </div>
                  {tsStatus.peers.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      <p className="text-xs font-medium mb-1" style={{ color: "var(--outline)" }}>
                        {isZh ? `网络节点 (${tsStatus.peers.length})` : `Nodes (${tsStatus.peers.length})`}
                      </p>
                      {tsStatus.peers.map((peer: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded text-xs" style={{ background: "var(--surface-container)" }}>
                          <div className="w-2 h-2 rounded-full" style={{ background: peer.online ? "var(--success)" : "var(--outline-variant)" }} />
                          <span style={{ color: "var(--on-surface)" }}>{peer.hostname}</span>
                          <span style={{ color: "var(--outline)" }}>{peer.tailscale_ips?.[0] || peer.tailscaleIps?.[0] || ""}</span>
                          <span style={{ color: "var(--outline)" }}>{peer.os}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center space-y-4 py-4">
                  <div className="flex justify-center"><TailscaleLogo size={40} /></div>
                  <p className="text-sm" style={{ color: "var(--outline)" }}>
                    {tsStatus?.error || (isZh ? "Tailscale 未连接" : "Tailscale not connected")}
                  </p>
                  <Button
                    onClick={async () => {
                      setTsLoggingIn(true);
                      try {
                        const res = await apiFetch("/api/tailscale/login", { method: "POST" });
                        const data = await res.json();
                        if (data.authUrl) {
                          openExternal(data.authUrl);
                          const poll = setInterval(async () => {
                            const r = await apiFetch("/api/tailscale/status");
                            const s = await r.json();
                            if (s.running) {
                              clearInterval(poll);
                              setTsStatus(s);
                              setTsLoggingIn(false);
                            }
                          }, 3000);
                          setTimeout(() => { clearInterval(poll); setTsLoggingIn(false); }, 120000);
                        } else if (data.status === "already_authenticated") {
                          const r = await apiFetch("/api/tailscale/status");
                          setTsStatus(await r.json());
                          setTsLoggingIn(false);
                        }
                      } catch { setTsLoggingIn(false); }
                    }}
                    disabled={tsLoggingIn}
                  >
                    {tsLoggingIn ? (isZh ? "等待授权..." : "Waiting...") : (isZh ? "登录 Tailscale" : "Login to Tailscale")}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4">
              <Button variant="ghost" onClick={() => setStep("github")}>{t("common.back")}</Button>
              <Button size="lg" onClick={() => { setStep("ai"); checkAiConfig(); }}>
                {tsStatus?.running ? (isZh ? "继续" : "Continue") : (isZh ? "跳过" : "Skip")}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: AI Configuration */}
        {step === "ai" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold">
                {isZh ? "配置 AI 服务" : "Configure AI Service"}
              </h2>
              <p className="text-[var(--outline)] mt-1">
                {isZh
                  ? "至少配置一个 AI 提供商，支持直连 API 或中转站代理。"
                  : "Configure at least one AI provider. Supports direct API or proxy relay."}
              </p>
            </div>

            <div className="space-y-4">
              {checkingAi ? (
                <div className="text-center py-8 text-[var(--outline)]">
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
                    <div className="rounded-lg border bg-[var(--surface-container-high)] p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">Claude Code Login</span>
                        {claudeStatus.loggedIn ? (
                          <span className="text-xs text-[var(--success)] bg-[var(--success)]/15 px-2 py-0.5 rounded-full">
                            ✓ {claudeStatus.email || (isZh ? "已登录" : "Logged in")}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--outline)] bg-[var(--outline-variant)] px-2 py-0.5 rounded-full">
                            {isZh ? "未登录" : "Not logged in"}
                          </span>
                        )}
                      </div>
                      {!claudeStatus.loggedIn && (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs text-[var(--outline)]">
                            {isZh
                              ? "通过 Claude Code 登录可免 API Key 使用 Anthropic 模型："
                              : "Login via Claude Code to use Anthropic without API key:"}
                          </p>
                          <code className="block bg-[var(--outline-variant)] rounded px-3 py-1.5 text-xs font-mono">
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

                  {!anyAiConfigured && (
                    <p className="text-xs text-amber-600 text-center">
                      {isZh
                        ? <><AlertTriangleIcon size={12} className="inline-block align-[-1px]" /> 至少配置一个提供商才能使用 AI 功能</>
                        : <><AlertTriangleIcon size={12} className="inline-block align-[-1px]" /> At least one provider is required for AI features</>}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Default provider selection */}
            {anyAiConfigured && (
              <div className="rounded-lg border p-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
                <label className="block text-sm font-medium mb-2" style={{ color: "var(--on-surface)" }}>
                  {isZh ? "默认 AI 引擎" : "Default AI Engine"}
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    ...((claudeStatus?.loggedIn || claudeStatus?.installed) ? [{ id: "acp", label: "Claude Code (ACP)", desc: isZh ? "推荐，本地 CLI 模式" : "Recommended, local CLI mode" }] : []),
                    ...(codexStatus?.installed ? [{ id: "codex-acp", label: "Codex (ACP)", desc: isZh ? "OpenAI Codex CLI" : "OpenAI Codex CLI" }] : []),
                    ...(aiStatus?.anthropic?.configured ? [{ id: "anthropic", label: "Anthropic API", desc: isZh ? "需要 API Key" : "Requires API key" }] : []),
                    ...(aiStatus?.openai?.configured ? [{ id: "openai", label: "OpenAI API", desc: isZh ? "需要 API Key" : "Requires API key" }] : []),
                    ...(aiStatus?.glm?.configured ? [{ id: "glm", label: "GLM API", desc: isZh ? "需要 API Key" : "Requires API key" }] : []),
                  ].map((p, i) => (
                    <button
                      key={p.id}
                      onClick={async (e) => {
                        // Visual feedback
                        document.querySelectorAll("[data-provider-btn]").forEach(b => {
                          (b as HTMLElement).style.borderColor = "var(--outline-variant)";
                          (b as HTMLElement).style.background = "transparent";
                        });
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--success)";
                        (e.currentTarget as HTMLElement).style.background = "rgba(34,197,94,0.1)";
                        await apiFetch("/api/settings", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ default_provider: p.id }),
                        });
                      }}
                      data-provider-btn
                      className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border text-left hover:opacity-80"
                      style={{
                        borderColor: i === 0 ? "var(--success)" : "var(--outline-variant)",
                        background: i === 0 ? "rgba(34,197,94,0.1)" : "transparent",
                        color: "var(--on-surface)",
                      }}
                    >
                      <span className="text-sm font-medium block">{p.label}</span>
                      <span className="text-[10px]" style={{ color: "var(--outline)" }}>{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("tailscale")}>{t("common.back")}</Button>
              <Button size="lg" onClick={() => setStep("create")} disabled={aiStatus !== null && !anyAiConfigured}>
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
                { icon: ClipboardIcon, title: isZh ? "1. 创建计划" : "1. Create Plan", desc: isZh ? "描述你的需求，AI 自动生成标题。在文件夹中组织多个计划。" : "Describe your needs, AI generates the title. Organize plans in folders." },
                { icon: SearchIcon, title: isZh ? "2. 生成方案" : "2. Generate Scheme", desc: isZh ? "AI 搜索互联网和本地代码，生成技术方案。你可以编辑和审查。" : "AI searches the web and local code to generate technical schemes. Edit and review." },
                { icon: BarChartIcon, title: isZh ? "3. 生成排期" : "3. Generate Schedule", desc: isZh ? "确认方案后，AI 拆解为可执行任务，甘特图可视化排期。" : "After confirming schemes, AI breaks them into executable tasks with Gantt chart." },
                { icon: ZapIcon, title: isZh ? "4. 执行" : "4. Execute", desc: isZh ? "AI 自动执行任务，实时查看进度。" : "AI executes tasks automatically with real-time progress." },
                { icon: CodeIcon, title: isZh ? "5. 代码审查" : "5. Code Review", desc: isZh ? "AI 审查实现代码的质量、安全性和可维护性。" : "AI reviews code quality, security, and maintainability." },
                { icon: CheckCircleIcon, title: isZh ? "6. 测试" : "6. Test", desc: isZh ? "AI 生成测试用例并运行，确保实现正确。" : "AI generates and runs tests to verify the implementation." },
              ].map((item) => (
                <div key={item.title} className="flex gap-4 items-start rounded-lg border bg-[var(--surface-container-high)] p-4">
                  <span className="shrink-0">{item.icon({ size: 24 })}</span>
                  <div>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-sm text-[var(--outline)]">{item.desc}</p>
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
              <p className="text-[var(--outline)] mt-1">
                {isZh
                  ? "项目关联一个代码仓库，所有计划和执行都基于此。"
                  : "A project is linked to a code repository. All plans and executions are based on it."}
              </p>
            </div>
            <div className="rounded-lg border bg-[var(--surface-container-high)] p-6 space-y-4">
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
                <label className="block text-sm font-medium text-[var(--on-surface)] mb-1">
                  {t("project.description")}
                </label>
                <MarkdownEditor value={description} onChange={setDescription} height={120} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--on-surface)] mb-1">
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
                <label className="block text-sm font-medium text-[var(--on-surface)] mb-1">
                  {t("project.targetRepoPath")}
                </label>
                {targetRepoPath ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-[var(--background)]">
                      <span className="text-sm font-mono flex-1 truncate">{targetRepoPath}</span>
                      <Button variant="ghost" size="sm" onClick={() => {
                        const oldAutoName = targetRepoPath.split("/").pop() || "";
                        if (name === oldAutoName) setName("");
                        setTargetRepoPath("");
                      }}>
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
                      const newName = path.split("/").pop() || "";
                      if (!name || name === targetRepoPath.split("/").pop()) {
                        setName(newName);
                      }
                    }}
                  />
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("ai")}>{t("common.back")}</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onComplete({ name: "", icon: "📁", description: "", guidelines: "", targetRepoPath: "" })}>
                  {isZh ? "跳过" : "Skip"}
                </Button>
                <Button size="lg" onClick={handleCreate} disabled={!name || !targetRepoPath}>
                  {t("common.create")}
                </Button>
              </div>
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
      <div className="rounded-lg border bg-[var(--surface-container-high)] p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">{name}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--outline)]">
              {status.mode === "proxy"
                ? isZh ? "中转站" : "Proxy"
                : "API Key"}
            </span>
            <span className="text-xs text-[var(--success)] bg-[var(--success)]/15 px-2 py-0.5 rounded-full">
              ✓ {status.masked || (status.baseURL ? status.baseURL.slice(0, 30) : "")}
            </span>
          </div>
        </div>
        {status.baseURL && (
          <p className="text-xs text-[var(--outline)] mt-1 font-mono truncate">
            {status.baseURL}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-[var(--surface-container-high)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{name}</span>
        <div className="flex gap-1 bg-[var(--outline-variant)] rounded-md p-0.5">
          <button
            onClick={() => setMode("login")}
            className={`px-2 py-1 text-xs rounded ${
              mode === "login" ? "bg-[var(--surface-container-high)] shadow-sm font-medium" : "text-[var(--outline)]"
            }`}
          >
            {isZh ? "登录获取" : "Login"}
          </button>
          <button
            onClick={() => setMode("apikey")}
            className={`px-2 py-1 text-xs rounded ${
              mode === "apikey" ? "bg-[var(--surface-container-high)] shadow-sm font-medium" : "text-[var(--outline)]"
            }`}
          >
            API Key
          </button>
          <button
            onClick={() => setMode("proxy")}
            className={`px-2 py-1 text-xs rounded ${
              mode === "proxy" ? "bg-[var(--surface-container-high)] shadow-sm font-medium" : "text-[var(--outline)]"
            }`}
          >
            {isZh ? "中转站" : "Proxy"}
          </button>
        </div>
      </div>

      {mode === "login" && !loginOpened && (
        <div className="text-center space-y-3 py-2">
          <p className="text-xs text-[var(--outline)]">
            {isZh
              ? "点击下方按钮跳转到平台获取 API Key，复制后粘贴到输入框。"
              : "Click below to open the platform, copy your API Key, then paste it here."}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              openExternal(loginUrl);
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
            <p className="text-xs text-[var(--primary)] text-center">
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
