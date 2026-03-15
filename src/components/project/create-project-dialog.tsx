"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { RepoPicker } from "@/components/repo-picker/repo-picker";
import { AnalyzePrompt } from "./analyze-prompt";
import { IconPicker } from "@/components/ui/icon-picker";

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    icon: string;
    description: string;
    guidelines: string;
    targetRepoPath: string;
  }) => void;
}

export function CreateProjectDialog({
  open,
  onClose,
  onSubmit,
}: CreateProjectDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📁");
  const [description, setDescription] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [targetRepoPath, setTargetRepoPath] = useState("");
  const [githubAuthed, setGithubAuthed] = useState(false);

  useEffect(() => {
    if (open) {
      fetch("/api/github/auth")
        .then((r) => r.json())
        .then((d) => setGithubAuthed(d.authenticated))
        .catch(() => setGithubAuthed(false));
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name || !targetRepoPath) return;
    onSubmit({ name, icon, description, guidelines, targetRepoPath });
    setName("");
    setIcon("📁");
    setDescription("");
    setGuidelines("");
    setTargetRepoPath("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("project.create")}>
      <div className="space-y-4">
        <div className="flex items-end gap-3">
          <IconPicker value={icon} onChange={setIcon} />
          <div className="flex-1">
            <Input
              label={t("project.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("project.description")}
          </label>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            height={150}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {locale === "zh" ? "架构与开发规范（可选）" : "Architecture & Guidelines (optional)"}
          </label>
          <MarkdownEditor
            value={guidelines}
            onChange={setGuidelines}
            height={120}
            placeholder={locale === "zh"
              ? "例如：使用 TDD、遵循 RESTful 设计、代码风格用 ESLint..."
              : "e.g., Use TDD, follow RESTful design, ESLint for code style..."}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("project.targetRepoPath")}
          </label>
          {targetRepoPath ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-gray-50">
                <span className="text-sm font-mono flex-1 truncate">
                  {targetRepoPath}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTargetRepoPath("")}
                >
                  {locale === "zh" ? "重选" : "Change"}
                </Button>
              </div>
              {!description && (
                <AnalyzePrompt
                  repoPath={targetRepoPath}
                  isZh={locale === "zh"}
                  onResult={(desc) => setDescription(desc)}
                />
              )}
            </div>
          ) : (
            <RepoPicker
              locale={locale}
              githubAuthed={githubAuthed}
              onSelect={(path) => {
                setTargetRepoPath(path);
                // Auto-fill name from directory if empty
                if (!name) {
                  setName(path.split("/").pop() || "");
                }
              }}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!name || !targetRepoPath}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
