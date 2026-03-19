"use client";

import { useState, useMemo } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";

interface Section {
  title: string;
  level: number;
  content: string;
}

function splitIntoSections(content: string): { preamble: string; sections: Section[] } {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let preamble = "";
  let current: { title: string; level: number; lines: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      if (current) {
        sections.push({
          title: current.title,
          level: current.level,
          content: current.lines.join("\n").trim(),
        });
      }
      current = { title: match[2].replace(/[*_`~]/g, "").trim(), level: match[1].length, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble += line + "\n";
    }
  }
  if (current) {
    sections.push({
      title: current.title,
      level: current.level,
      content: current.lines.join("\n").trim(),
    });
  }

  return { preamble: preamble.trim(), sections };
}

interface SchemeSectionsProps {
  content: string;
}

export function SchemeSections({ content }: SchemeSectionsProps) {
  const { preamble, sections } = useMemo(() => splitIntoSections(content), [content]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const toggle = (i: number) => {
    setExpandedIndex(expandedIndex === i ? null : i);
  };

  return (
    <div className="space-y-0">
      {preamble && (
        <div className="pb-3 mb-2">
          <MarkdownRenderer content={preamble} />
        </div>
      )}
      <div className="border rounded-lg divide-y">
        {sections.map((section, i) => {
          const isOpen = expandedIndex === i;
          return (
            <div key={i}>
              <button
                onClick={() => toggle(i)}
                className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors ${
                  isOpen ? "bg-gray-50" : ""
                }`}
              >
                <span
                  className="font-medium text-sm"
                  style={{ paddingLeft: `${(section.level - 1) * 12}px` }}
                >
                  {section.title}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <div className="px-4 pb-4">
                  <MarkdownRenderer content={section.content} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
