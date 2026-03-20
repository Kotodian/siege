"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";

interface ImportConfig {
  id: string;
  source: string;
  config: Record<string, string>;
  enabled: boolean;
}

interface ImportableItem {
  id: string;
  title: string;
  description: string;
  source: string;
  sourceUrl?: string;
}

interface ImportPlanDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  locale: string;
  onImported: () => void;
}

const SOURCE_TYPES = ["github", "gitlab", "notion", "jira", "confluence", "feishu", "mcp"] as const;

const SOURCE_FIELDS: Record<
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

const SOURCE_HINTS: Record<string, { en: string; zh: string }> = {
  notion: {
    en: "Create an integration at notion.so/my-integrations to get your API Key",
    zh: "在 notion.so/my-integrations 创建集成获取 API Key",
  },
  jira: {
    en: "Generate an API token at id.atlassian.com/manage-profile/security/api-tokens",
    zh: "在 id.atlassian.com/manage-profile/security/api-tokens 生成 API Token",
  },
  confluence: {
    en: "Uses the same Atlassian API token as Jira",
    zh: "使用与 Jira 相同的 Atlassian API Token",
  },
  feishu: {
    en: "Create an app at open.feishu.cn/app to get App ID and App Secret",
    zh: "在 open.feishu.cn/app 创建应用获取 App ID 和 App Secret",
  },
  github: {
    en: "Auto-detects gh CLI login. Or enter a Personal Access Token for explicit auth.",
    zh: "自动检测 gh CLI 登录状态。也可手动输入 Personal Access Token。",
  },
  gitlab: {
    en: "Generate a token in GitLab Preferences > Access Tokens with 'read_api' scope",
    zh: "在 GitLab 偏好设置 > 访问令牌中生成 token，需要 read_api 权限",
  },
  mcp: {
    en: "Enter the MCP server command and arguments to connect",
    zh: "输入 MCP 服务器启动命令和参数",
  },
};

function QuickSetupForm({
  sourceType,
  locale,
  onConfigured,
}: {
  sourceType: string;
  locale: string;
  onConfigured: (config: ImportConfig) => void;
}) {
  const isZh = locale === "zh";
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fieldDefs = SOURCE_FIELDS[sourceType] || [];
  const hint = SOURCE_HINTS[sourceType];

  // Check if required fields are filled
  const requiredKeys = fieldDefs
    .filter((f) => !f.label.includes("optional") && !f.labelZh.includes("可选"))
    .map((f) => f.key);
  const canSave = requiredKeys.every((k) => fields[k]?.trim());

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      // Create the config
      const createRes = await fetch("/api/import-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceType, config: fields }),
      });
      if (!createRes.ok) {
        setError(isZh ? "保存失败" : "Save failed");
        return;
      }
      const created = await createRes.json();

      // Validate connection
      const valRes = await fetch(
        `/api/import-sources/${created.id}/validate`,
        { method: "POST" }
      );
      const valData = await valRes.json();

      if (!valData.valid) {
        // Delete the bad config
        await fetch(`/api/import-sources?id=${created.id}`, {
          method: "DELETE",
        });
        setError(
          isZh
            ? "连接验证失败，请检查配置信息"
            : "Connection validation failed. Please check your credentials."
        );
        return;
      }

      onConfigured(created);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
        <p className="text-sm font-medium text-blue-800 mb-1">
          {isZh
            ? `配置 ${sourceType.toUpperCase()} 连接`
            : `Set up ${sourceType.toUpperCase()} connection`}
        </p>
        {hint && (
          <p className="text-xs text-blue-600">
            {isZh ? hint.zh : hint.en}
          </p>
        )}
      </div>

      {fieldDefs.map((field) => (
        <Input
          key={field.key}
          label={isZh ? field.labelZh : field.label}
          value={fields[field.key] || ""}
          onChange={(e) =>
            setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
          }
          placeholder={field.placeholder}
          type={field.type || "text"}
        />
      ))}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Button onClick={handleSave} disabled={!canSave || saving} className="w-full">
        {saving
          ? (isZh ? "连接验证中..." : "Validating connection...")
          : (isZh ? "保存并连接" : "Save & Connect")}
      </Button>
    </div>
  );
}

function MarkdownTab({
  projectId,
  locale,
  onImported,
  onClose,
}: {
  projectId: string;
  locale: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [importPath, setImportPath] = useState("");
  const [loading, setLoading] = useState(false);
  const isZh = locale === "zh";

  const handleImport = async () => {
    if (!importPath) return;
    setLoading(true);
    try {
      await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filePath: importPath }),
      });
      setImportPath("");
      onImported();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Input
        label={isZh ? "Markdown 文件路径" : "Markdown File Path"}
        value={importPath}
        onChange={(e) => setImportPath(e.target.value)}
        placeholder="/path/to/plan.md"
        required
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleImport} disabled={!importPath || loading}>
          {loading
            ? t("common.loading")
            : isZh
              ? "导入"
              : "Import"}
        </Button>
      </div>
    </div>
  );
}

function SourceTab({
  sourceType,
  projectId,
  locale,
  onImported,
  onClose,
}: {
  sourceType: string;
  projectId: string;
  locale: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const isZh = locale === "zh";
  const [configs, setConfigs] = useState<ImportConfig[]>([]);
  const [items, setItems] = useState<ImportableItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const fetchConfigs = () => {
    fetch("/api/import-sources")
      .then((r) => r.json())
      .then((all: ImportConfig[]) => {
        setConfigs(all.filter((c) => c.source === sourceType));
        setConfigLoaded(true);
      });
  };

  useEffect(() => {
    fetchConfigs();
  }, [sourceType]);

  const activeConfig = configs[0];

  const handleSearch = async (configId?: string) => {
    const id = configId || activeConfig?.id;
    if (!id) return;
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      const res = await fetch(`/api/import-sources/${id}/items?${params}`);
      const data = await res.json();
      setItems(data);
      setSelected(new Set());
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (activeConfig) {
      handleSearch();
    }
  }, [activeConfig?.id]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (!activeConfig || selected.size === 0) return;
    setLoading(true);
    try {
      for (const itemId of selected) {
        await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            source: sourceType,
            sourceId: activeConfig.id,
            itemId,
          }),
        });
      }
      onImported();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!activeConfig && configLoaded) {
    return (
      <QuickSetupForm
        sourceType={sourceType}
        locale={locale}
        onConfigured={(newConfig) => {
          setConfigs([newConfig]);
          handleSearch(newConfig.id);
        }}
      />
    );
  }

  if (!activeConfig) {
    return (
      <p className="text-gray-400 text-sm text-center py-6">
        {t("common.loading")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          label=""
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isZh ? "搜索..." : "Search..."}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Button
          variant="secondary"
          onClick={() => handleSearch()}
          disabled={searching}
          className="self-end"
        >
          {searching
            ? t("common.loading")
            : isZh
              ? "搜索"
              : "Search"}
        </Button>
      </div>

      <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
        {items.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">
            {searching
              ? t("common.loading")
              : t("common.noData")}
          </p>
        ) : (
          items.map((item) => (
            <label
              key={item.id}
              className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggleSelect(item.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {item.title}
                </div>
                {item.description && (
                  <div className="text-xs text-gray-500 truncate">
                    {item.description}
                  </div>
                )}
              </div>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-blue-500 hover:underline shrink-0"
                >
                  {isZh ? "链接" : "Link"}
                </a>
              )}
            </label>
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {isZh
            ? `已选 ${selected.size} 项`
            : `${selected.size} selected`}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleImport}
            disabled={selected.size === 0 || loading}
          >
            {loading
              ? t("common.loading")
              : isZh
                ? `导入所选 (${selected.size})`
                : `Import Selected (${selected.size})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

const SOURCE_LABELS: Record<string, { en: string; zh: string }> = {
  notion: { en: "Notion", zh: "Notion" },
  jira: { en: "Jira", zh: "Jira" },
  confluence: { en: "Confluence", zh: "Confluence" },
  feishu: { en: "Feishu", zh: "飞书" },
  github: { en: "GitHub", zh: "GitHub" },
  gitlab: { en: "GitLab", zh: "GitLab" },
  mcp: { en: "MCP", zh: "MCP" },
};

const SOURCE_ICONS: Record<string, string> = {
  markdown: "/icons/markdown.svg",
  notion: "/icons/notion.svg",
  jira: "/icons/jira.svg",
  confluence: "/icons/confluence.svg",
  feishu: "/icons/feishu.svg",
  github: "/icons/github.svg",
  gitlab: "/icons/gitlab.svg",
  mcp: "/icons/mcp.svg",
};

export function ImportPlanDialog({
  open,
  onClose,
  projectId,
  locale,
  onImported,
}: ImportPlanDialogProps) {
  const isZh = locale === "zh";
  const [activeSource, setActiveSource] = useState("markdown");

  const allSources = [
    { id: "markdown", label: "Markdown" },
    ...SOURCE_TYPES.map((src) => ({
      id: src,
      label: SOURCE_LABELS[src][isZh ? "zh" : "en"],
    })),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isZh ? "导入计划" : "Import Plan"}
      maxWidth="max-w-3xl"
    >
      <div className="flex min-h-[400px] -mx-6 -mb-6">
        {/* Left sidebar */}
        <div className="w-40 shrink-0 border-r bg-gray-50 rounded-bl-lg overflow-y-auto">
          {allSources.map((src) => (
            <button
              key={src.id}
              onClick={() => setActiveSource(src.id)}
              className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                activeSource === src.id
                  ? "bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-600"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={SOURCE_ICONS[src.id]} alt="" className="w-4 h-4 shrink-0" />
              <span className="truncate">{src.label}</span>
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="flex-1 p-5 overflow-y-auto">
          {activeSource === "markdown" ? (
            <MarkdownTab
              projectId={projectId}
              locale={locale}
              onImported={onImported}
              onClose={onClose}
            />
          ) : (
            <SourceTab
              key={activeSource}
              sourceType={activeSource}
              projectId={projectId}
              locale={locale}
              onImported={onImported}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}
