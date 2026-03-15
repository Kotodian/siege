"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { StatusBadge } from "@/components/ui/status-badge";
import { TimeAgo } from "@/components/ui/time-ago";
import { Button } from "@/components/ui/button";
import { SchemeEditor } from "./scheme-editor";
import { SchemeVersions } from "./scheme-versions";
import { useGlobalLoading } from "@/components/ui/global-loading";

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
  const isZh = t("common.back") === "返回";
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatting, setChatting] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: "user" | "ai"; text: string }>
  >([]);

  const pollSchemeUpdate = async (originalUpdatedAt: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      updateContent(isZh
        ? `AI 正在修改方案，已等待 ${(i + 1) * 3} 秒...`
        : `AI modifying scheme... ${(i + 1) * 3}s elapsed.`);
      const res = await fetch(`/api/schemes/${scheme.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.updatedAt !== originalUpdatedAt) {
          return data;
        }
      }
    }
    return null;
  };

  const handleChat = async () => {
    if (!chatInput.trim() || chatting) return;
    startLoading(isZh ? "AI 修改方案中..." : "AI modifying scheme...");

    const message = chatInput.trim();
    setChatHistory((prev) => [...prev, { role: "user", text: message }]);
    setChatInput("");
    setChatting(true);

    const originalUpdatedAt = scheme.updatedAt;

    try {
      await fetch("/api/schemes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemeId: scheme.id, message }),
      });

      // Poll for update
      const updated = await pollSchemeUpdate(originalUpdatedAt);
      if (updated) {
        setChatHistory((prev) => [
          ...prev,
          { role: "ai", text: isZh ? "修改完成 ✓" : "Done ✓" },
        ]);
        onUpdate(scheme.id, {
          title: updated.title,
          content: updated.content,
        });
        stopLoading(isZh ? "方案修改完成" : "Scheme modified");
      } else {
        setChatHistory((prev) => [
          ...prev,
          { role: "ai", text: isZh ? "修改超时" : "Timed out" },
        ]);
        stopLoading(isZh ? "修改超时" : "Timed out");
      }
    } catch {
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", text: "Error" },
      ]);
      stopLoading(isZh ? "修改失败" : "Failed");
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
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(
                `# ${scheme.title}\n\n${scheme.content || ""}`
              );
            }}
          >
            {isZh ? "复制" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVersionsOpen(true)}
          >
            {isZh ? "版本" : "Versions"}
          </Button>
          {!readonly && (
            <>
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
            </>
          )}
        </div>
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
            <div className="text-sm text-blue-600 bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-2">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div>
                <span>{isZh ? "AI 修改中，请稍候..." : "AI modifying, please wait..."}</span>
                <span className="block text-xs text-blue-400">
                  {isZh ? "通常需要 1-2 分钟" : "Usually takes 1-2 minutes"}
                </span>
              </div>
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

      <SchemeVersions
        schemeId={scheme.id}
        currentContent={scheme.content || ""}
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        onRestore={(content) => {
          onUpdate(scheme.id, { title: scheme.title, content });
        }}
      />
    </div>
  );
}
