"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { ProviderModelSelect, useDefaultProvider } from "@/components/ui/provider-model-select";
import { SparklesIcon, PlusIcon, XIcon } from "@/components/ui/icons";

interface SubtaskForm {
  title: string;
  description: string;
  estimatedHours: string;
}

interface SplitTaskDialogProps {
  open: boolean;
  item: { id: string; title: string; description: string | null };
  onClose: () => void;
  onSplitComplete: () => void;
}

export function SplitTaskDialog({ open, item, onClose, onSplitComplete }: SplitTaskDialogProps) {
  const t = useTranslations("subtask");
  const tc = useTranslations("common");
  const defaultProvider = useDefaultProvider();
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiOutput, setAiOutput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [manualSubtasks, setManualSubtasks] = useState<SubtaskForm[]>([
    { title: "", description: "", estimatedHours: "1" },
    { title: "", description: "", estimatedHours: "1" },
  ]);

  const handleAiGenerate = async () => {
    setGenerating(true);
    setAiOutput("");
    setError("");
    try {
      const res = await fetch(`/api/schedule-items/${item.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ai",
          provider: provider || defaultProvider || undefined,
          model: model || undefined,
        }),
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setAiOutput(text);
        }
        onSplitComplete();
      } else {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        setError(data.error || "Failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  };

  const handleManualSave = async () => {
    const valid = manualSubtasks.filter(s => s.title.trim());
    if (valid.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/schedule-items/${item.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          subtasks: valid.map(s => ({
            title: s.title.trim(),
            description: s.description.trim(),
            estimatedHours: parseFloat(s.estimatedHours) || 1,
          })),
        }),
      });
      if (res.ok) {
        onSplitComplete();
      } else {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        setError(data.error || "Failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const updateSubtask = (idx: number, field: keyof SubtaskForm, value: string) => {
    setManualSubtasks(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const addSubtask = () => {
    setManualSubtasks(prev => [...prev, { title: "", description: "", estimatedHours: "1" }]);
  };

  const removeSubtask = (idx: number) => {
    if (manualSubtasks.length <= 1) return;
    setManualSubtasks(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("splitTitle")} maxWidth="max-w-2xl">
      <p className="text-sm mb-4" style={{ color: "var(--on-surface-variant)" }}>
        {t("splitDescription")}
      </p>
      <div className="text-xs mb-4 p-2 rounded" style={{ background: "var(--surface-container)", color: "var(--on-surface)" }}>
        <strong>{item.title}</strong>
      </div>

      {error && (
        <div className="p-3 rounded mb-4 text-sm" style={{ background: "var(--error-container)", color: "var(--error)" }}>
          {error}
        </div>
      )}

      <Tabs
        defaultTab="ai"
        tabs={[
          {
            id: "ai",
            label: t("aiAssisted"),
            content: (
              <div className="space-y-4">
                <ProviderModelSelect
                  provider={provider}
                  model={model}
                  onProviderChange={setProvider}
                  onModelChange={setModel}
                  disabled={generating}
                  compact
                />
                {aiOutput && (
                  <pre className="text-xs p-3 rounded overflow-auto max-h-60" style={{ background: "var(--background)", color: "var(--on-surface)" }}>
                    {aiOutput}
                  </pre>
                )}
                <div className="flex justify-end gap-3">
                  <Button variant="ghost" onClick={onClose}>{tc("cancel")}</Button>
                  <Button onClick={handleAiGenerate} disabled={generating}>
                    {generating
                      ? tc("loading")
                      : <><SparklesIcon size={14} className="inline-block align-[-2px]" /> {t("generate")}</>}
                  </Button>
                </div>
              </div>
            ),
          },
          {
            id: "manual",
            label: t("manual"),
            content: (
              <div className="space-y-3">
                {manualSubtasks.map((st, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded" style={{ background: "var(--surface-container)" }}>
                    <div className="flex-1 space-y-2">
                      <Input
                        label={`#${idx + 1}`}
                        value={st.title}
                        onChange={(e) => updateSubtask(idx, "title", e.target.value)}
                      />
                      <textarea
                        className="w-full text-xs rounded px-2 py-1 border resize-none"
                        style={{ background: "var(--background)", color: "var(--on-surface)", borderColor: "var(--ghost-border)" }}
                        rows={2}
                        value={st.description}
                        onChange={(e) => updateSubtask(idx, "description", e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col items-center gap-1 mt-6">
                      <input
                        type="number"
                        className="w-14 text-xs rounded px-1 py-1 border text-center"
                        style={{ background: "var(--background)", color: "var(--on-surface)", borderColor: "var(--ghost-border)" }}
                        value={st.estimatedHours}
                        onChange={(e) => updateSubtask(idx, "estimatedHours", e.target.value)}
                      />
                      <span className="text-[10px]" style={{ color: "var(--outline)" }}>h</span>
                    </div>
                    <button onClick={() => removeSubtask(idx)} className="mt-6 p-1" style={{ color: "var(--error)" }}>
                      <XIcon size={14} />
                    </button>
                  </div>
                ))}
                <button onClick={addSubtask} className="flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ color: "var(--primary)" }}>
                  <PlusIcon size={14} /> {t("addSubtask")}
                </button>
                <div className="flex justify-end gap-3 mt-4">
                  <Button variant="ghost" onClick={onClose}>{tc("cancel")}</Button>
                  <Button onClick={handleManualSave} disabled={saving || manualSubtasks.every(s => !s.title.trim())}>
                    {saving ? tc("loading") : t("confirmSplit")}
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />
    </Dialog>
  );
}
