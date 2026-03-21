"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GitBranchIcon, CheckIcon, AlertTriangleIcon, SparklesIcon } from "@/components/ui/icons";
import { useGlobalLoading } from "@/components/ui/global-loading";
import { ProviderModelSelect, useDefaultProvider } from "@/components/ui/provider-model-select";

interface GitStatus {
  isGit: boolean;
  currentBranch?: string;
  branches?: string[];
  changedFiles?: number;
  unpushedCommits?: number;
}

interface PRInfo {
  hasPR: boolean;
  pr?: { number: number; title: string; url: string; state: string; baseRefName: string; headRefName?: string };
}

interface PublishViewProps {
  planId: string;
  projectId: string;
}

const DEPLOY_PRESETS = [
  { label: "Git Push + PR", cmd: "Push all changes to remote and create a pull request if not exists." },
  { label: "Docker Build & Push", cmd: "Build Docker image and push to container registry." },
  { label: "npm publish", cmd: "Run tests, build, and publish the npm package." },
  { label: "cargo publish", cmd: "Run cargo test, then cargo publish to crates.io." },
];

export function PublishView({ planId, projectId }: PublishViewProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [prInfo, setPrInfo] = useState<PRInfo | null>(null);
  const [repoPath, setRepoPath] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prBase, setPrBase] = useState("");
  const [creatingPR, setCreatingPR] = useState(false);
  const [deployCmd, setDeployCmd] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployProvider, setDeployProvider] = useState("");
  const [deployModel, setDeployModel] = useState("");
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  const defaultProvider = useDefaultProvider();

  useState(() => { if (defaultProvider) setDeployProvider(defaultProvider); });

  const handleDeploy = async () => {
    if (!deployCmd.trim() || deploying) return;
    setDeploying(true);
    startLoading(isZh ? "AI 正在执行部署..." : "AI deploying...");
    try {
      const res = await fetch("/api/execute/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath,
          instruction: deployCmd.trim(),
          provider: deployProvider || undefined,
          model: deployModel || undefined,
        }),
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
        await fetchStatus();
        stopLoading(isZh ? "部署完成" : "Deploy complete");
      } else {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        stopLoading(isZh ? `部署失败: ${data.error}` : `Deploy failed: ${data.error}`);
      }
    } catch (e) {
      stopLoading(isZh ? `部署失败: ${e}` : `Deploy failed: ${e}`);
    } finally {
      setDeploying(false);
    }
  };

  const fetchStatus = async () => {
    const projRes = await fetch(`/api/projects/${projectId}`);
    const proj = await projRes.json();
    if (!proj.targetRepoPath) {
      setGitStatus({ isGit: false });
      return;
    }
    setRepoPath(proj.targetRepoPath);

    const gitRes = await fetch(`/api/git?path=${encodeURIComponent(proj.targetRepoPath)}`);
    const git = await gitRes.json();
    setGitStatus(git);

    if (git.isGit) {
      const prRes = await fetch(`/api/git/pr?repoPath=${encodeURIComponent(proj.targetRepoPath)}`);
      setPrInfo(await prRes.json());
    }
  };

  useEffect(() => { fetchStatus(); }, [projectId]);

  const handlePush = async () => {
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath }),
      });
      const data = await res.json();
      if (res.ok) {
        setPushResult({ ok: true, msg: data.output || (isZh ? "推送成功" : "Pushed") });
        await fetchStatus();
      } else {
        setPushResult({ ok: false, msg: data.error });
      }
    } catch (e) {
      setPushResult({ ok: false, msg: String(e) });
    } finally {
      setPushing(false);
    }
  };

  const handleCreatePR = async () => {
    if (!prTitle.trim()) return;
    setCreatingPR(true);
    try {
      const res = await fetch("/api/git/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, title: prTitle, body: prBody, baseBranch: prBase || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        setPrDialogOpen(false);
        setPrTitle("");
        setPrBody("");
        await fetchStatus();
        window.open(data.url, "_blank");
      } else {
        alert(data.error || "Failed");
      }
    } finally {
      setCreatingPR(false);
    }
  };

  if (!gitStatus) {
    return <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>{isZh ? "加载中..." : "Loading..."}</p>;
  }

  if (!gitStatus.isGit) {
    return (
      <div className="text-center py-12 space-y-2">
        <AlertTriangleIcon size={32} className="mx-auto text-yellow-500" />
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {isZh ? "该项目不是 Git 仓库，无法发布。" : "This project is not a Git repository."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Branch & Status */}
      <div className="rounded-lg border p-4" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitBranchIcon size={16} />
            <span className="font-mono text-sm font-medium" style={{ color: "var(--foreground)" }}>
              {gitStatus.currentBranch}
            </span>
          </div>
        </div>

        {/* Push section */}
        <div className="flex items-center gap-3">
          <Button onClick={handlePush} disabled={pushing} size="sm">
            {pushing ? (isZh ? "推送中..." : "Pushing...") : (isZh ? "推送到远程" : "Push to Remote")}
          </Button>
          {pushResult && (
            <span className={`text-xs ${pushResult.ok ? "text-green-500" : "text-red-500"}`}>
              {pushResult.msg.slice(0, 100)}
            </span>
          )}
        </div>
      </div>

      {/* PR section */}
      <div className="rounded-lg border p-4" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <h4 className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
          Pull Request
        </h4>

        {prInfo?.hasPR && prInfo.pr ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckIcon size={14} className="text-green-500" />
              <a
                href={prInfo.pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium hover:underline"
                style={{ color: "#60a5fa" }}
              >
                #{prInfo.pr.number} {prInfo.pr.title}
              </a>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                background: prInfo.pr.state === "OPEN" ? "rgba(34,197,94,0.15)" : "rgba(139,92,246,0.15)",
                color: prInfo.pr.state === "OPEN" ? "#86efac" : "#c4b5fd",
              }}>
                {prInfo.pr.state}
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {prInfo.pr.headRefName || gitStatus.currentBranch} → {prInfo.pr.baseRefName}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {isZh ? "当前分支没有 Pull Request" : "No Pull Request for current branch"}
            </p>
            <Button size="sm" onClick={() => {
              setPrTitle(`feat: ${gitStatus.currentBranch}`);
              setPrDialogOpen(true);
            }}>
              {isZh ? "创建 Pull Request" : "Create Pull Request"}
            </Button>
          </div>
        )}
      </div>

      {/* AI Deploy */}
      <div className="rounded-lg border p-4" style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <h4 className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
          <SparklesIcon size={14} className="inline-block align-[-2px]" /> {isZh ? "AI 部署" : "AI Deploy"}
        </h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {DEPLOY_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDeployCmd(p.cmd)}
              className="text-[11px] px-2 py-1 rounded hover:opacity-80"
              style={{ background: "var(--card-border)", color: "var(--foreground)" }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea
          value={deployCmd}
          onChange={(e) => setDeployCmd(e.target.value)}
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm mb-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
          placeholder={isZh
            ? "告诉 AI 怎么部署，例如：推送代码、构建 Docker 镜像并部署到 K8s..."
            : "Tell AI how to deploy, e.g.: push code, build Docker image and deploy to K8s..."}
        />
        <div className="flex items-center gap-2">
          <ProviderModelSelect
            provider={deployProvider}
            model={deployModel}
            onProviderChange={setDeployProvider}
            onModelChange={setDeployModel}
            disabled={deploying}
            compact
          />
          <Button onClick={handleDeploy} disabled={deploying || !deployCmd.trim()} size="sm">
            <SparklesIcon size={14} className="inline-block align-[-2px]" /> {deploying ? (isZh ? "部署中..." : "Deploying...") : (isZh ? "执行部署" : "Deploy")}
          </Button>
        </div>
      </div>

      {/* PR creation dialog */}
      <Dialog
        open={prDialogOpen}
        onClose={() => setPrDialogOpen(false)}
        title={isZh ? "创建 Pull Request" : "Create Pull Request"}
      >
        <div className="space-y-4">
          <Input
            label="Title"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            placeholder="feat: implement new feature"
          />
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
              {isZh ? "描述" : "Description"}
            </label>
            <textarea
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
              rows={4}
              className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
              placeholder={isZh ? "PR 描述..." : "PR description..."}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
              Base Branch
            </label>
            <select
              value={prBase}
              onChange={(e) => setPrBase(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
            >
              <option value="">{isZh ? "默认 (main/master)" : "Default (main/master)"}</option>
              {gitStatus.branches?.filter(b => b !== gitStatus.currentBranch).map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPrDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreatePR} disabled={creatingPR || !prTitle.trim()}>
              {creatingPR ? (isZh ? "创建中..." : "Creating...") : (isZh ? "创建" : "Create")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
