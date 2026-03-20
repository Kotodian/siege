"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SkillSummary {
  name: string;
  source: string;
  description: string;
}

interface GenerateSchemeDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (provider: string, skills: string[], model?: string) => void;
  generating: boolean;
}

export function GenerateSchemeDialog({
  open,
  onClose,
  onGenerate,
  generating,
}: GenerateSchemeDialogProps) {
  const t = useTranslations();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");

  useEffect(() => {
    // Auto-detect default provider
    fetch("/api/settings").then(r => r.json()).then(s => {
      if (s.default_provider) setProvider(s.default_provider);
    }).catch(() => {});
    if (open) {
      fetch("/api/skills")
        .then((r) => r.json())
        .then(setSkills)
        .catch(() => {});
    }
  }, [open]);

  const toggleSkill = (name: string) => {
    setSelectedSkills((prev) =>
      prev.includes(name)
        ? prev.filter((s) => s !== name)
        : [...prev, name]
    );
  };

  // Group by source
  const bySource = skills.reduce<Record<string, SkillSummary[]>>(
    (acc, s) => {
      if (!acc[s.source]) acc[s.source] = [];
      acc[s.source].push(s);
      return acc;
    },
    {}
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("scheme.generate")}
    >
      <div className="space-y-4">
        {/* Provider */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("generate.provider")}
          </label>
          <div className="flex gap-2 flex-wrap">
            {[
              { id: "acp", label: "Claude Code", badge: "ACP" },
              { id: "codex-acp", label: "Codex", badge: "ACP" },
              { id: "anthropic", label: "Claude" },
              { id: "openai", label: "GPT" },
              { id: "glm", label: "GLM" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
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
        </div>

        {/* Model input for ACP engines */}
        {(provider === "acp" || provider === "codex-acp") && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("generate.provider")} Model
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. claude-sonnet-4-20250514"
              className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--card-border)" }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              {provider === "codex-acp"
                ? "Codex ACP model name (leave empty for default)"
                : "Claude Code ACP model name (leave empty for default)"}
            </p>
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("generate.skills")} ({selectedSkills.length})
            </label>
            <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
              {Object.entries(bySource).map(([source, items]) => (
                <div key={source}>
                  <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-500">
                    {source}
                  </div>
                  {items.map((skill) => (
                    <label
                      key={skill.name}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSkills.includes(skill.name)}
                        onChange={() => toggleSkill(skill.name)}
                        className="rounded border-gray-300"
                      />
                      <div className="min-w-0">
                        <span className="text-sm font-mono truncate block">
                          {skill.name}
                        </span>
                        {skill.description && (
                          <span className="text-xs text-gray-400 truncate block">
                            {skill.description}
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => onGenerate(provider, selectedSkills, model || undefined)}
            disabled={generating}
          >
            {generating ? t("common.loading") : t("scheme.generate")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
