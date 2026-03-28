"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { RepoPicker } from "@/components/repo-picker/repo-picker";
import { AnalyzePrompt } from "./analyze-prompt";
import { IconPicker } from "@/components/ui/icon-picker";
import { apiFetch } from "@/lib/api";

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    icon: string;
    description: string;
    guidelines: string;
    targetRepoPath: string;
    remoteHost?: string;
    remoteUser?: string;
    remoteRepoPath?: string;
    remoteEnabled?: boolean;
  }) => void;
}

export function CreateProjectDialog({
  open,
  onClose,
  onSubmit,
}: CreateProjectDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📁");
  const [description, setDescription] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [targetRepoPath, setTargetRepoPath] = useState("");
  const [githubAuthed, setGithubAuthed] = useState(false);
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteHost, setRemoteHost] = useState("");
  const [remoteUser, setRemoteUser] = useState("root");
  const [remoteRepoPath, setRemoteRepoPath] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [connectionError, setConnectionError] = useState("");

  const isZh = locale === "zh";

  const testConnection = async () => {
    setConnectionStatus("testing");
    setConnectionError("");
    try {
      const res = await apiFetch("/api/projects/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteHost, remoteUser }),
      });
      const data = await res.json();
      if (data.status === "connected") {
        setConnectionStatus("connected");
      } else {
        setConnectionStatus("failed");
        setConnectionError(data.error || "Connection failed");
      }
    } catch {
      setConnectionStatus("failed");
      setConnectionError("Request failed");
    }
  };

  useEffect(() => {
    if (open) {
      apiFetch("/api/github/auth")
        .then((r) => r.json())
        .then((d) => setGithubAuthed(d.authenticated))
        .catch(() => setGithubAuthed(false));
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name || !targetRepoPath) return;
    onSubmit({
      name, icon, description, guidelines, targetRepoPath,
      ...(remoteEnabled && remoteHost && {
        remoteHost,
        remoteUser,
        remoteRepoPath: remoteRepoPath || targetRepoPath,
        remoteEnabled: true,
      }),
    });
    setName("");
    setIcon("📁");
    setDescription("");
    setGuidelines("");
    setTargetRepoPath("");
    setRemoteEnabled(false);
    setRemoteHost("");
    setRemoteUser("root");
    setRemoteRepoPath("");
    setConnectionStatus("idle");
    setConnectionError("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("project.create")}>
      <div className="space-y-4">
        <div className="flex items-end gap-3">
          <IconPicker value={icon} onChange={setIcon} />
          <div className="flex-1">
            <Input
              label={t("project.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface-variant)" }}>
            {t("project.description")}
          </label>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            height={150}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface-variant)" }}>
            {locale === "zh" ? "架构与开发规范（可选）" : "Architecture & Guidelines (optional)"}
          </label>
          <MarkdownEditor
            value={guidelines}
            onChange={setGuidelines}
            height={120}
            placeholder={locale === "zh"
              ? "例如：使用 TDD、遵循 RESTful 设计、代码风格用 ESLint..."
              : "e.g., Use TDD, follow RESTful design, ESLint for code style..."}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface-variant)" }}>
            {t("project.targetRepoPath")}
          </label>
          {targetRepoPath ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-md border px-3 py-2" style={{ background: "var(--surface-container)", borderColor: "var(--outline-variant)" }}>
                <span className="text-sm font-mono flex-1 truncate">
                  {targetRepoPath}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTargetRepoPath("")}
                >
                  {locale === "zh" ? "重选" : "Change"}
                </Button>
              </div>
              {!description && (
                <AnalyzePrompt
                  repoPath={targetRepoPath}
                  isZh={locale === "zh"}
                  onResult={(desc) => setDescription(desc)}
                />
              )}
            </div>
          ) : (
            <RepoPicker
              locale={locale}
              githubAuthed={githubAuthed}
              onSelect={(path) => {
                setTargetRepoPath(path);
                // Auto-fill name from directory if empty
                if (!name) {
                  setName(path.split("/").pop() || "");
                }
              }}
            />
          )}
        </div>
        {/* Remote Execution (Tailscale) */}
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remoteEnabled}
              onChange={(e) => setRemoteEnabled(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium" style={{ color: "var(--on-surface)" }}>
              {isZh ? "远程执行 (Tailscale)" : "Remote Execution (Tailscale)"}
            </span>
          </label>

          {remoteEnabled && (
            <div className="space-y-3 p-4 rounded-lg" style={{ background: "var(--surface-container)", border: "1px solid var(--outline-variant)" }}>
              <Input
                label={isZh ? "远程主机 (Tailscale IP)" : "Remote Host (Tailscale IP)"}
                placeholder="100.64.1.5"
                value={remoteHost}
                onChange={(e) => { setRemoteHost(e.target.value); setConnectionStatus("idle"); }}
              />
              <Input
                label={isZh ? "SSH 用户" : "SSH User"}
                value={remoteUser}
                onChange={(e) => setRemoteUser(e.target.value)}
              />
              <Input
                label={isZh ? "远程仓库路径" : "Remote Repo Path"}
                placeholder="/home/user/projects/my-app"
                value={remoteRepoPath}
                onChange={(e) => setRemoteRepoPath(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={testConnection}
                  disabled={!remoteHost || connectionStatus === "testing"}
                >
                  {connectionStatus === "testing"
                    ? (isZh ? "测试中..." : "Testing...")
                    : (isZh ? "测试连接" : "Test Connection")}
                </Button>
                {connectionStatus === "connected" && (
                  <span className="text-xs font-medium" style={{ color: "var(--success)" }}>
                    ✓ {isZh ? "连接成功" : "Connected"}
                  </span>
                )}
                {connectionStatus === "failed" && (
                  <span className="text-xs" style={{ color: "var(--error)" }}>
                    ✗ {connectionError || (isZh ? "连接失败" : "Failed")}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!name || !targetRepoPath}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
