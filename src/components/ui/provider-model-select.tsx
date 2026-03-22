"use client";

import { useState, useEffect } from "react";

interface ProviderConfig {
  id: string;
  label: string;
  badge?: string;
  models: string[];
}

// ACP providers are always available (they use CLI auth, not API keys)
const ACP_PROVIDERS: ProviderConfig[] = [
  { id: "acp", label: "Claude Code", badge: "ACP", models: [
    "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101",
  ]},
  { id: "codex-acp", label: "Codex", badge: "ACP", models: [
    "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.3-codex",
    "o3-pro", "o3-mini", "gpt-4o", "gpt-4o-mini",
  ]},
];

// SDK providers — only shown if API key is configured
const SDK_PROVIDERS: Record<string, { label: string; models: string[] }> = {
  anthropic: { label: "Claude", models: [
    "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101",
    "claude-sonnet-4-20250514", "claude-opus-4-20250514",
  ]},
  openai: { label: "GPT", models: [
    "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.3-codex",
    "o3-pro", "o3-mini", "gpt-4o", "gpt-4o-mini",
  ]},
  glm: { label: "GLM", models: [
    "glm-5", "glm-4-plus", "glm-4", "glm-4-air", "glm-4-flash", "glm-4-long",
  ]},
};

interface ProviderModelSelectProps {
  provider: string;
  model: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ProviderModelSelect({
  provider,
  model,
  onProviderChange,
  onModelChange,
  disabled,
  compact,
}: ProviderModelSelectProps) {
  const [availableProviders, setAvailableProviders] = useState<ProviderConfig[]>(ACP_PROVIDERS);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(settings => {
      const providers: ProviderConfig[] = [...ACP_PROVIDERS];
      for (const [id, config] of Object.entries(SDK_PROVIDERS)) {
        const hasKey = !!settings[`${id}_api_key`];
        const hasUrl = !!settings[`${id}_base_url`];
        if (hasKey || hasUrl) {
          providers.push({ id, label: config.label, models: config.models });
        }
      }
      setAvailableProviders(providers);
    }).catch(() => {});
  }, []);

  const currentProvider = availableProviders.find(p => p.id === provider);
  const models = currentProvider?.models || [];

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
          {availableProviders.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}{p.badge ? ` (${p.badge})` : ""}
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
        {availableProviders.map((p) => (
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
            {p.badge && (
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
