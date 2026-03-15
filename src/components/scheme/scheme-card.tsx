"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { StatusBadge } from "@/components/ui/status-badge";
import { TimeAgo } from "@/components/ui/time-ago";
import { Button } from "@/components/ui/button";
import { SchemeEditor } from "./scheme-editor";

interface Scheme {
  id: string;
  planId: string;
  title: string;
  content: string | null;
  sourceType: string;
  updatedAt: string;
  createdAt: string;
}

interface SchemeCardProps {
  scheme: Scheme;
  readonly: boolean;
  onUpdate: (id: string, data: { title: string; content: string }) => void;
  onDelete: (id: string) => void;
}

export function SchemeCard({
  scheme,
  readonly,
  onUpdate,
  onDelete,
}: SchemeCardProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <SchemeEditor
        initialTitle={scheme.title}
        initialContent={scheme.content || ""}
        onSave={(title, content) => {
          onUpdate(scheme.id, { title, content });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{scheme.title}</h3>
          <StatusBadge
            status={scheme.sourceType}
            label={t(`scheme.sourceType.${scheme.sourceType}`)}
          />
          <TimeAgo date={scheme.updatedAt || scheme.createdAt} />
        </div>
        {!readonly && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
            >
              {t("common.edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm(t("scheme.deleteConfirm"))) {
                  onDelete(scheme.id);
                }
              }}
            >
              {t("common.delete")}
            </Button>
          </div>
        )}
      </div>
      <MarkdownRenderer content={scheme.content || ""} />
    </div>
  );
}
