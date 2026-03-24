"use client";

import { useState, useEffect, useRef } from "react";

interface ProviderConfig {
  id: string;
  label: string;
  badge?: string;
  models: string[];
}

const ACP_PROVIDERS: ProviderConfig[] = [
  { id: "acp", label: "Claude Code", badge: "ACP", models: [
    "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101",
  ]},
  { id: "codex-acp", label: "Codex", badge: "ACP", models: [
    "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.3-codex",
    "o3-pro", "o3-mini", "gpt-4o", "gpt-4o-mini",
  ]},
  { id: "copilot-acp", label: "Copilot", badge: "ACP", models: [
    "gpt-4o", "gpt-4o-mini", "o3-mini", "claude-sonnet-4-6",
  ]},
];

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

/** Custom dropdown that matches dark theme */
function Dropdown({ value, options, onChange, disabled, placeholder, compact }: {
  value: string;
  options: Array<{ value: string; label: string; badge?: string }>;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`flex items-center gap-1.5 rounded-md border ${compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"} w-full text-left`}
        style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: open ? "var(--on-surface)" : "var(--outline-variant)" }}
      >
        <span className="flex-1 truncate">
          {selected ? (
            <span className="flex items-center gap-1.5">
              {selected.label}
              {selected.badge && <span className="text-[10px] px-1 rounded" style={{ background: "var(--outline-variant)" }}>{selected.badge}</span>}
            </span>
          ) : (
            <span style={{ color: "var(--outline)" }}>{placeholder}</span>
          )}
        </span>
        <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--outline)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[160px] rounded-md border shadow-lg overflow-hidden"
          style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          <button
            className={`w-full text-left ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"} hover:opacity-80`}
            style={{ color: "var(--outline)" }}
            onClick={() => { onChange(""); setOpen(false); }}
          >
            {placeholder}
          </button>
          {options.map(o => (
            <button
              key={o.value}
              className={`w-full text-left ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"} flex items-center gap-1.5 hover:opacity-80`}
              style={{
                background: o.value === value ? "var(--on-surface)" : undefined,
                color: o.value === value ? "var(--background)" : "var(--on-surface)",
              }}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
              {o.badge && (
                <span className="text-[10px] px-1 rounded" style={{
                  background: o.value === value ? "rgba(0,0,0,0.2)" : "var(--outline-variant)",
                }}>{o.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
        if (settings[`${id}_api_key`] || settings[`${id}_base_url`]) {
          providers.push({ id, label: config.label, models: config.models });
        }
      }
      setAvailableProviders(providers);
    }).catch(() => {});
  }, []);

  const currentProvider = availableProviders.find(p => p.id === provider);
  const models = currentProvider?.models || [];

  const providerOptions = availableProviders.map(p => ({
    value: p.id,
    label: p.label,
    badge: p.badge,
  }));

  const modelOptions = models.map(m => ({ value: m, label: m }));

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Dropdown
          value={provider}
          options={providerOptions}
          onChange={(v) => { onProviderChange(v); onModelChange(""); }}
          disabled={disabled}
          placeholder="默认 / Default"
          compact
        />
        {provider && models.length > 0 && (
          <Dropdown
            value={model}
            options={modelOptions}
            onChange={onModelChange}
            disabled={disabled}
            placeholder="默认模型"
            compact
          />
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
              ? { background: "var(--on-surface)", color: "var(--background)", borderColor: "var(--on-surface)" }
              : { background: "var(--surface-container-high)", color: "var(--outline)", borderColor: "var(--outline-variant)" }
            }
          >
            {p.label}
            {p.badge && (
              <span className="text-[10px] px-1 rounded" style={
                provider === p.id ? { background: "rgba(0,0,0,0.2)" } : { background: "var(--outline-variant)", color: "var(--on-surface)" }
              }>{p.badge}</span>
            )}
          </button>
        ))}
      </div>
      {provider && models.length > 0 && (
        <Dropdown
          value={model}
          options={modelOptions}
          onChange={onModelChange}
          disabled={disabled}
          placeholder="默认模型 / Default Model"
        />
      )}
    </div>
  );
}

export function useDefaultProvider() {
  const [provider, setProvider] = useState("");
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(s => {
      if (s.default_provider) setProvider(s.default_provider);
    }).catch(() => {});
  }, []);
  return provider;
}
