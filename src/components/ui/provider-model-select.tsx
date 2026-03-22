"use client";

import { useState, useEffect } from "react";

const PROVIDERS = [
  { id: "acp", label: "Claude Code", badge: "ACP" },
  { id: "codex-acp", label: "Codex", badge: "ACP" },
  { id: "anthropic", label: "Claude", models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101", "claude-sonnet-4-20250514", "claude-opus-4-20250514"] },
  { id: "openai", label: "GPT", models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.3-codex", "o3-pro", "o3-mini", "gpt-4o", "gpt-4o-mini"] },
  { id: "glm", label: "GLM", models: ["glm-5", "glm-4-plus", "glm-4", "glm-4-air", "glm-4-flash", "glm-4-long"] },
] as const;

const CLAUDE_ACP_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-5-20251101",
];

const CODEX_ACP_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.3-codex",
  "o3-pro",
  "o3-mini",
  "gpt-4o",
  "gpt-4o-mini",
];

interface ProviderModelSelectProps {
  provider: string;
  model: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  compact?: boolean; // compact mode: single-line select instead of button group
}

export function ProviderModelSelect({
  provider,
  model,
  onProviderChange,
  onModelChange,
  disabled,
  compact,
}: ProviderModelSelectProps) {
  const isAcp = provider === "acp" || provider === "codex-acp";
  const currentProvider = PROVIDERS.find(p => p.id === provider);
  const models = provider === "acp"
    ? CLAUDE_ACP_MODELS
    : provider === "codex-acp"
      ? CODEX_ACP_MODELS
      : ("models" in (currentProvider || {}) ? (currentProvider as { models: readonly string[] }).models : []);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <select
          value={provider}
          onChange={(e) => { onProviderChange(e.target.value); onModelChange(""); }}
          disabled={disabled}
          className="rounded-md border px-2 py-1.5 text-xs"
          style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
        >
          <option value="">默认 / Default</option>
          {PROVIDERS.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}{("badge" in p) ? ` (${p.badge})` : ""}
            </option>
          ))}
        </select>
        {provider && models.length > 0 && (
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled}
            className="rounded-md border px-2 py-1.5 text-xs"
            style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
          >
            <option value="">默认模型 / Default</option>
            {models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { onProviderChange(p.id); onModelChange(""); }}
            disabled={disabled}
            className="px-3 py-1.5 text-sm rounded-md border flex items-center gap-1"
            style={provider === p.id
              ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" }
              : { background: "var(--card)", color: "var(--muted)", borderColor: "var(--card-border)" }
            }
          >
            {p.label}
            {("badge" in p) && (
              <span className="text-[10px] px-1 rounded" style={
                provider === p.id ? { background: "rgba(0,0,0,0.2)" } : { background: "var(--card-border)", color: "var(--foreground)" }
              }>{p.badge}</span>
            )}
          </button>
        ))}
      </div>
      {provider && models.length > 0 && (
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
        >
          <option value="">默认模型 / Default Model</option>
          {models.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Hook to auto-detect default provider from settings */
export function useDefaultProvider() {
  const [provider, setProvider] = useState("");
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(s => {
      if (s.default_provider) setProvider(s.default_provider);
    }).catch(() => {});
  }, []);
  return provider;
}
