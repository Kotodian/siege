"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SkillSummary {
  name: string;
  source: string;
  description: string;
}

export default function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const t = useTranslations();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings);
    fetch("/api/skills")
      .then((r) => r.json())
      .then(setSkills);
  }, []);

  const handleSave = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Group skills by source
  const skillsBySource = skills.reduce<Record<string, SkillSummary[]>>(
    (acc, skill) => {
      if (!acc[skill.source]) acc[skill.source] = [];
      acc[skill.source].push(skill);
      return acc;
    },
    {}
  );

  return (
    <div>
      <a
        href={`/${locale}`}
        className="text-sm text-blue-600 hover:underline"
      >
        &larr; {t("common.back")}
      </a>
      <h1 className="text-3xl font-bold mt-2 mb-8">{t("nav.settings")}</h1>

      {/* AI Configuration */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">AI Configuration</h2>
        <div className="rounded-lg border bg-white p-6 space-y-4">
          <Input
            label="Default Provider"
            value={settings.default_provider || "anthropic"}
            onChange={(e) =>
              updateSetting("default_provider", e.target.value)
            }
            placeholder="anthropic or openai"
          />
          <Input
            label="Default Model (Anthropic)"
            value={
              settings.default_model_anthropic ||
              "claude-sonnet-4-20250514"
            }
            onChange={(e) =>
              updateSetting("default_model_anthropic", e.target.value)
            }
          />
          <Input
            label="Default Model (OpenAI)"
            value={settings.default_model_openai || "gpt-4o"}
            onChange={(e) =>
              updateSetting("default_model_openai", e.target.value)
            }
          />
        </div>
      </section>

      {/* Archive & Cleanup */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Archive & Cleanup</h2>
        <div className="rounded-lg border bg-white p-6 space-y-4">
          <Input
            label="Archive after days (completed plans)"
            type="number"
            value={settings.archive_after_days || "30"}
            onChange={(e) =>
              updateSetting("archive_after_days", e.target.value)
            }
          />
          <Input
            label="Cleanup after days (archived plans)"
            type="number"
            value={settings.cleanup_after_days || "90"}
            onChange={(e) =>
              updateSetting("cleanup_after_days", e.target.value)
            }
          />
        </div>
      </section>

      {/* Skills */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          Skills ({skills.length})
        </h2>
        {Object.entries(skillsBySource).map(([source, sourceSkills]) => (
          <div key={source} className="mb-4">
            <h3 className="text-sm font-medium text-gray-500 mb-2">
              {source} ({sourceSkills.length})
            </h3>
            <div className="rounded-lg border bg-white divide-y">
              {sourceSkills.map((skill) => (
                <div key={skill.name} className="px-4 py-3">
                  <span className="font-mono text-sm">{skill.name}</span>
                  {skill.description && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {skill.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {skills.length === 0 && (
          <p className="text-gray-500 text-sm">
            No skills found in ~/.claude/skills/
          </p>
        )}
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave}>{t("common.save")}</Button>
        {saved && (
          <span className="text-sm text-green-600">Saved!</span>
        )}
      </div>
    </div>
  );
}
