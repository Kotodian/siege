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
  const [chatInput, setChatInput] = useState("");
  const [chatting, setChatting] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: "user" | "ai"; text: string }>
  >([]);

  const handleChat = async () => {
    if (!chatInput.trim() || chatting) return;

    const message = chatInput.trim();
    setChatHistory((prev) => [...prev, { role: "user", text: message }]);
    setChatInput("");
    setChatting(true);

    try {
      const res = await fetch("/api/schemes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemeId: scheme.id, message }),
      });

      if (res.ok) {
        const updated = await res.json();
        setChatHistory((prev) => [
          ...prev,
          { role: "ai", text: t("common.save") + " ✓" },
        ]);
        onUpdate(scheme.id, {
          title: updated.title,
          content: updated.content,
        });
      } else {
        setChatHistory((prev) => [
          ...prev,
          { role: "ai", text: "Failed to modify" },
        ]);
      }
    } catch {
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", text: "Error" },
      ]);
    } finally {
      setChatting(false);
    }
  };

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

  const isZh = t("common.back") === "返回";

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

      {/* Chat history */}
      {chatHistory.length > 0 && (
        <div className="mt-3 border-t pt-3 space-y-2">
          {chatHistory.map((msg, i) => (
            <div
              key={i}
              className={`text-sm px-3 py-1.5 rounded-lg max-w-[80%] ${
                msg.role === "user"
                  ? "bg-blue-50 text-blue-800 ml-auto"
                  : "bg-gray-50 text-gray-700"
              }`}
            >
              {msg.text}
            </div>
          ))}
          {chatting && (
            <div className="text-sm text-gray-400 flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {isZh ? "AI 修改中..." : "AI modifying..."}
            </div>
          )}
        </div>
      )}

      {/* Chat input */}
      {!readonly && (
        <div className="mt-3 flex gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChat()}
            placeholder={
              isZh
                ? "输入修改指令，如「把技术栈换成 Go」"
                : "e.g., Change the tech stack to Go"
            }
            disabled={chatting}
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm
              focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
              disabled:opacity-50"
          />
          <Button
            size="sm"
            onClick={handleChat}
            disabled={chatting || !chatInput.trim()}
          >
            {chatting
              ? isZh ? "修改中" : "..."
              : isZh ? "AI 修改" : "AI Edit"}
          </Button>
        </div>
      )}
    </div>
  );
}
