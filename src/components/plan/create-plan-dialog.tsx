"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";

interface CreatePlanDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; tag: string }) => void;
}

export function CreatePlanDialog({
  open,
  onClose,
  onSubmit,
}: CreatePlanDialogProps) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("feature");
  const [suggesting, setSuggesting] = useState(false);
  const [userEditedName, setUserEditedName] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const suggestTitle = useCallback(
    async (desc: string) => {
      if (userEditedName || desc.trim().length < 10) return;

      // Cancel previous request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSuggesting(true);
      try {
        const res = await fetch("/api/plans/suggest-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: desc }),
          signal: controller.signal,
        });
        if (res.ok && !controller.signal.aborted) {
          const data = await res.json();
          if (!userEditedName) {
            setName(data.title);
          }
        }
      } catch {
        // ignore abort/errors
      } finally {
        if (!controller.signal.aborted) {
          setSuggesting(false);
        }
      }
    },
    [userEditedName]
  );

  const handleDescriptionChange = (value: string) => {
    setDescription(value);

    // Debounce title suggestion
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      suggestTitle(value);
    }, 1500);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    setUserEditedName(true);
    setSuggesting(false);
    if (abortRef.current) abortRef.current.abort();
  };

  const handleSubmit = () => {
    if (!name) return;
    onSubmit({ name, description, tag });
    setName("");
    setDescription("");
    setTag("feature");
    setUserEditedName(false);
    onClose();
  };

  const TAGS = ["feature", "bug", "enhance", "refactor", "docs", "test", "chore", "perf"] as const;

  const handleClose = () => {
    setName("");
    setDescription("");
    setTag("feature");
    setUserEditedName(false);
    setSuggesting(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title={t("plan.create")}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("plan.description")}
          </label>
          <MarkdownEditor
            value={description}
            onChange={handleDescriptionChange}
            height={150}
            placeholder={
              t("plan.description") + "..."
            }
          />
          {suggesting && (
            <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              AI 正在生成标题...
            </p>
          )}
        </div>
        <div>
          <Input
            label={t("plan.name")}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            placeholder={suggesting ? t("common.loading") : ""}
          />
          {!userEditedName && name && (
            <p className="text-xs text-gray-400 mt-1">
              AI generated — edit to customize
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("plan.tag")}
          </label>
          <div className="flex flex-wrap gap-2">
            {TAGS.map((t_) => (
              <button
                key={t_}
                type="button"
                onClick={() => setTag(t_)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  tag === t_
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                }`}
              >
                {t(`plan.tags.${t_}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name}
          >
            {t("common.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
