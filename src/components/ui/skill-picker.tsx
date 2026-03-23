"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface SkillSummary {
  name: string;
  source: string;
  description: string;
}

interface SkillPickerProps {
  skills: SkillSummary[];
  selected: string[];
  onToggle: (name: string) => void;
}

export function SkillPicker({ skills, selected, onToggle }: SkillPickerProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [search, setSearch] = useState("");

  if (skills.length === 0) return null;

  const query = search.toLowerCase();
  const filtered = query
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.source.toLowerCase().includes(query)
      )
    : skills;

  const bySource = filtered.reduce<Record<string, SkillSummary[]>>(
    (acc, s) => {
      if (!acc[s.source]) acc[s.source] = [];
      acc[s.source].push(s);
      return acc;
    },
    {}
  );

  return (
    <div>
      <label
        className="block text-sm font-medium mb-1"
        style={{ color: "var(--foreground)" }}
      >
        {t("generate.skills")} ({selected.length})
      </label>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={isZh ? "搜索技能..." : "Search skills..."}
        className="w-full px-3 py-1.5 text-sm border rounded-md mb-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
        style={{
          background: "var(--card)",
          color: "var(--foreground)",
          borderColor: "var(--card-border)",
        }}
      />
      <div
        className="max-h-48 overflow-y-auto border rounded-md divide-y"
        style={{ borderColor: "var(--card-border)" }}
      >
        {Object.keys(bySource).length === 0 ? (
          <p
            className="text-xs text-center py-3"
            style={{ color: "var(--muted)" }}
          >
            {isZh ? "无匹配技能" : "No matching skills"}
          </p>
        ) : (
          Object.entries(bySource).map(([source, items]) => (
            <div key={source}>
              <div
                className="px-3 py-1.5 text-xs font-medium"
                style={{
                  background: "var(--background)",
                  color: "var(--muted)",
                }}
              >
                {source}
              </div>
              {items.map((skill) => (
                <label
                  key={skill.name}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:opacity-80"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(skill.name)}
                    onChange={() => onToggle(skill.name)}
                    className="rounded"
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-mono truncate block">
                      {skill.name}
                    </span>
                    {skill.description && (
                      <span
                        className="text-xs truncate block"
                        style={{ color: "var(--muted)" }}
                      >
                        {skill.description}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
