"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown/markdown-editor";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";

interface SchemeEditorProps {
  initialTitle?: string;
  initialContent?: string;
  onSave: (title: string, content: string) => void;
  onCancel: () => void;
}

interface Section {
  heading: string; // original heading line, e.g. "## Overview"
  title: string;
  level: number;
  content: string;
}

function splitSections(content: string): { preamble: string; sections: Section[] } {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let preamble = "";
  let current: { heading: string; title: string; level: number; lines: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      if (current) {
        sections.push({
          heading: current.heading,
          title: current.title,
          level: current.level,
          content: current.lines.join("\n"),
        });
      }
      current = {
        heading: line,
        title: match[2].replace(/[*_`~]/g, "").trim(),
        level: match[1].length,
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble += line + "\n";
    }
  }
  if (current) {
    sections.push({
      heading: current.heading,
      title: current.title,
      level: current.level,
      content: current.lines.join("\n"),
    });
  }
  return { preamble, sections };
}

function joinSections(preamble: string, sections: Section[]): string {
  let result = preamble;
  for (const s of sections) {
    result += s.heading + "\n" + s.content;
    if (!result.endsWith("\n")) result += "\n";
  }
  return result.trim();
}

export function SchemeEditor({
  initialTitle = "",
  initialContent = "",
  onSave,
  onCancel,
}: SchemeEditorProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [title, setTitle] = useState(initialTitle);
  const [preamble, setPreamble] = useState(() => splitSections(initialContent).preamble);
  const [sections, setSections] = useState<Section[]>(() => splitSections(initialContent).sections);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editBuffer, setEditBuffer] = useState("");

  const hasSections = sections.length > 1;

  // Fallback: if < 2 sections, use single editor mode
  const [singleContent, setSingleContent] = useState(initialContent);

  const handleSectionSave = (index: number) => {
    setSections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, content: editBuffer } : s))
    );
    setEditingIndex(null);
    setEditBuffer("");
  };

  const handleSave = () => {
    if (hasSections) {
      onSave(title, joinSections(preamble, sections));
    } else {
      onSave(title, singleContent);
    }
  };

  if (!hasSections) {
    // Original single-editor mode
    return (
      <div className="rounded-lg border p-5 space-y-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
        <Input
          label={t("scheme.schemeTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>
            {t("scheme.content")}
          </label>
          <MarkdownEditor value={singleContent} onChange={setSingleContent} height={300} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSave(title, singleContent)} disabled={!title}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-5 space-y-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
      <Input
        label={t("scheme.schemeTitle")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {/* Preamble */}
      {preamble.trim() && (
        <div className="text-sm rounded p-3" style={{ background: "var(--background)", color: "var(--outline)" }}>
          <MarkdownRenderer content={preamble} />
        </div>
      )}

      {/* Sections accordion */}
      <div className="border rounded-lg divide-y" style={{ borderColor: "var(--outline-variant)", "--tw-divide-color": "var(--outline-variant)" } as React.CSSProperties}>
        {sections.map((section, i) => {
          const isEditing = editingIndex === i;
          return (
            <div key={i}>
              <div className="flex items-center justify-between px-4 py-3">
                <span
                  className="font-medium text-sm"
                  style={{ paddingLeft: `${(section.level - 1) * 12}px` }}
                >
                  {section.title}
                </span>
                {!isEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingIndex(i);
                      setEditBuffer(section.content);
                    }}
                  >
                    {t("common.edit")}
                  </Button>
                )}
              </div>
              {isEditing ? (
                <div className="px-4 pb-4 space-y-2">
                  <MarkdownEditor
                    value={editBuffer}
                    onChange={setEditBuffer}
                    height={200}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setEditingIndex(null); setEditBuffer(""); }}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button size="sm" onClick={() => handleSectionSave(i)}>
                      {isZh ? "确定" : "Done"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="px-4 pb-3">
                  <MarkdownRenderer content={section.content} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleSave} disabled={!title}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
