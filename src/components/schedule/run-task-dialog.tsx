"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProviderModelSelect, useDefaultProvider } from "@/components/ui/provider-model-select";
import { SkillPicker } from "@/components/ui/skill-picker";

interface SkillSummary {
  name: string;
  source: string;
  description: string;
}

interface RunTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onRun: (skills: string[], provider?: string, model?: string) => void;
  taskTitle: string;
}

export function RunTaskDialog({ open, onClose, onRun, taskTitle }: RunTaskDialogProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const defaultProvider = useDefaultProvider();
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    if (defaultProvider && !provider) setProvider(defaultProvider);
  }, [defaultProvider]);

  useEffect(() => {
    if (open) {
      fetch("/api/skills").then(r => r.json()).then(setSkills).catch(() => {});
    }
  }, [open]);

  const toggleSkill = (name: string) => {
    setSelectedSkills(prev =>
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={isZh ? `执行: ${taskTitle}` : `Run: ${taskTitle}`}>
      <div className="space-y-4">
        {/* Provider + Model */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>
            {t("generate.provider")}
          </label>
          <ProviderModelSelect
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
          />
        </div>

        {/* Skills */}
        <SkillPicker skills={skills} selected={selectedSkills} onToggle={toggleSkill} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => { onRun(selectedSkills, provider || undefined, model || undefined); onClose(); }}>
            {isZh ? "开始执行" : "Run"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
