"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";

interface CreateSchemeDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { title: string; content: string }) => void;
}

export function CreateSchemeDialog({
  open,
  onClose,
  onSubmit,
}: CreateSchemeDialogProps) {
  const t = useTranslations();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const handleSubmit = () => {
    if (!title) return;
    onSubmit({ title, content });
    setTitle("");
    setContent("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("scheme.create")}>
      <div className="space-y-4">
        <Input
          label={t("scheme.schemeTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <div>
          <label className="block text-sm font-medium text-[var(--on-surface)] mb-1">
            {t("scheme.content")}
          </label>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            height={200}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!title}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
