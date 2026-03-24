"use client";

import { useMemo } from "react";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface SchemeTocProps {
  content: string;
  activeId?: string;
}

export function extractHeadings(content: string): TocItem[] {
  const headings: TocItem[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^(#{1,4})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[*_`~]/g, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 60);
      headings.push({ id, text, level });
    }
  }
  return headings;
}

export function SchemeToc({ content, activeId }: SchemeTocProps) {
  const headings = useMemo(() => extractHeadings(content), [content]);

  if (headings.length === 0) return null;

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <nav className="space-y-0.5">
      {headings.map((h, i) => (
        <button
          key={`${h.id}-${i}`}
          onClick={() => handleClick(h.id)}
          className={`block w-full text-left text-xs py-1 rounded transition-colors truncate ${
            activeId === h.id
              ? "text-[var(--primary)] font-medium bg-[rgba(192,193,255,0.12)]"
              : "text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container)]"
          }`}
          style={{ paddingLeft: `${(h.level - 1) * 12 + 4}px` }}
          title={h.text}
        >
          {h.text}
        </button>
      ))}
    </nav>
  );
}
