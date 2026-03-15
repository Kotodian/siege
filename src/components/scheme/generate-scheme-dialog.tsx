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
  onGenerate: (provider: string, skills: string[]) => void;
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
  const [provider, setProvider] = useState("anthropic");

  useEffect(() => {
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
            AI Provider
          </label>
          <div className="flex gap-2">
            {["anthropic", "openai", "glm"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`px-3 py-1.5 text-sm rounded-md border ${
                  provider === p
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                }`}
              >
                {p === "anthropic" ? "Claude" : p === "openai" ? "GPT" : "GLM"}
              </button>
            ))}
          </div>
        </div>

        {/* Skills */}
        {skills.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Skills ({selectedSkills.length} selected)
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
            onClick={() => onGenerate(provider, selectedSkills)}
            disabled={generating}
          >
            {generating ? t("common.loading") : t("scheme.generate")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
