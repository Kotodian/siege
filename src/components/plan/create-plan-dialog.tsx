"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { useGlobalLoading } from "@/components/ui/global-loading";

interface CreatePlanDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; tag: string }) => void;
  projectId?: string;
}

export function CreatePlanDialog({
  open,
  onClose,
  onSubmit,
  projectId,
}: CreatePlanDialogProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("feature");

  const handleSuggestTitle = async () => {
    if (description.trim().length < 5) return;

    startLoading(isZh ? "AI 正在生成标题..." : "AI generating title...");
    try {
      const res = await fetch("/api/plans/suggest-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateContent(content);
        }
        const title = content.trim().split("\n")[0].replace(/^["'#*]+|["'*]+$/g, "").trim().slice(0, 50);
        if (title) {
          setName(title);
          stopLoading(`${isZh ? "标题" : "Title"}: ${title}`);
          return;
        }
      }
      stopLoading(isZh ? "标题生成失败" : "Title generation failed");
    } catch {
      stopLoading(isZh ? "标题生成失败" : "Failed");
    }
  };

  const handleSubmit = () => {
    if (!name) return;
    onSubmit({ name, description, tag });
    setName("");
    setDescription("");
    setTag("feature");
    onClose();
  };

  const TAGS = ["feature", "bug", "enhance", "refactor", "docs", "test", "chore", "perf"] as const;

  const handleClose = () => {
    setName("");
    setDescription("");
    setTag("feature");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title={t("plan.create")}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
            {t("plan.description")}
          </label>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            height={150}
            placeholder={t("plan.description") + "..."}
          />
        </div>
        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t("plan.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSuggestTitle}
              disabled={!description.trim()}
            >
              {isZh ? "AI 生成" : "AI Title"}
            </Button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--foreground)" }}>
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
                    : ""
                }`}
                style={tag !== t_ ? { background: "var(--card)", color: "var(--muted)", borderColor: "var(--card-border)" } : undefined}
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
          <Button onClick={handleSubmit} disabled={!name}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
