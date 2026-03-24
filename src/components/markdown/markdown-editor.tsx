"use client";

import { useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  height = 200,
  placeholder,
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="rounded-md border border-gray-300 overflow-hidden focus-within:border-[var(--primary)] focus-within:ring-1 focus-within:ring-blue-500">
      {/* Toolbar */}
      <div className="flex items-center justify-between bg-[var(--surface-container)] border-b px-2 py-1">
        <span className="text-xs text-[var(--on-surface-variant)]">Markdown</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className={`px-2 py-0.5 text-xs rounded ${
              !showPreview ? "bg-[var(--surface-container-highest)] shadow-sm font-medium" : "text-[var(--on-surface-variant)]"
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className={`px-2 py-0.5 text-xs rounded ${
              showPreview ? "bg-[var(--surface-container-highest)] shadow-sm font-medium" : "text-[var(--on-surface-variant)]"
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {showPreview ? (
        <div
          className="px-3 py-2 overflow-auto bg-[var(--surface-container-highest)]"
          style={{ minHeight: height }}
        >
          {value ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="text-sm text-[var(--on-surface-variant)]">{placeholder || "Nothing to preview"}</p>
          )}
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm font-mono resize-y border-0 outline-none"
          style={{ minHeight: height }}
        />
      )}
    </div>
  );
}
