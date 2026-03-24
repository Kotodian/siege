"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useGlobalLoading } from "@/components/ui/global-loading";
import fs from "fs";

interface AnalyzePromptProps {
  repoPath: string;
  onResult: (description: string) => void;
  isZh: boolean;
}

export function AnalyzePrompt({ repoPath, onResult, isZh }: AnalyzePromptProps) {
  const { startLoading, updateContent, stopLoading } = useGlobalLoading();
  const [state, setState] = useState<"checking" | "asking" | "done">("checking");
  const [source, setSource] = useState("");
  const [hasClaudeMd, setHasClaudeMd] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/projects/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath }),
        });
        const data = await res.json();

        if (data.empty) { setState("done"); return; }
        if (data.hasAgentDocs) {
          onResult(data.description);
          setSource(data.source);
          setHasClaudeMd(true);
          setState("done");
          return;
        }
        setState("asking");
      } catch { setState("done"); }
    })();
  }, [repoPath]);

  const handleAnalyzeAndGenerate = async () => {
    startLoading(isZh ? "AI 正在分析项目并生成 CLAUDE.md..." : "AI analyzing project, generating CLAUDE.md...");
    try {
      // Generate CLAUDE.md
      const res = await fetch("/api/projects/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, type: "claude" }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateContent(content);
        }
        onResult(content.trim());
        setHasClaudeMd(true);
        setSource("CLAUDE.md");

        // Also generate AGENTS.md
        stopLoading(isZh ? "CLAUDE.md 已生成，正在生成 AGENTS.md..." : "CLAUDE.md done, generating AGENTS.md...");
        startLoading(isZh ? "AI 正在生成 AGENTS.md..." : "Generating AGENTS.md...");

        const res2 = await fetch("/api/projects/generate-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath, type: "agents" }),
        });

        if (res2.ok && res2.body) {
          const reader2 = res2.body.getReader();
          let content2 = "";
          while (true) {
            const { done, value } = await reader2.read();
            if (done) break;
            content2 += decoder.decode(value, { stream: true });
            updateContent(content2);
          }
        }

        stopLoading(isZh ? "CLAUDE.md + AGENTS.md 已生成" : "CLAUDE.md + AGENTS.md generated");
      } else {
        stopLoading(isZh ? "生成失败" : "Generation failed");
      }
    } catch {
      stopLoading(isZh ? "生成失败" : "Failed");
    }
    setState("done");
  };

  const handleRegenerate = async (type: "claude" | "agents") => {
    const label = type === "claude" ? "CLAUDE.md" : "AGENTS.md";
    startLoading(isZh ? `正在重新生成 ${label}...` : `Regenerating ${label}...`);
    try {
      const res = await fetch("/api/projects/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath, type }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateContent(content);
        }
        if (type === "claude") onResult(content.trim());
        stopLoading(isZh ? `${label} 已重新生成` : `${label} regenerated`);
      } else {
        stopLoading(isZh ? "生成失败" : "Failed");
      }
    } catch {
      stopLoading(isZh ? "生成失败" : "Failed");
    }
  };

  if (state === "checking") {
    return (
      <div className="rounded-md bg-[var(--surface-container)] border px-4 py-3 text-sm text-[var(--on-surface-variant)] flex items-center gap-2">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {isZh ? "检测项目..." : "Checking project..."}
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="rounded-md bg-[var(--surface-container)] border px-4 py-2 space-y-1">
        {source && (
          <p className="text-xs text-[var(--success)]">
            {isZh ? `已从 ${source} 读取项目描述` : `Loaded from ${source}`}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => handleRegenerate("claude")}>
            {isZh ? "重新生成 CLAUDE.md" : "Regen CLAUDE.md"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handleRegenerate("agents")}>
            {isZh ? "重新生成 AGENTS.md" : "Regen AGENTS.md"}
          </Button>
        </div>
      </div>
    );
  }

  // state === "asking"
  return (
    <div className="rounded-md bg-[rgba(192,193,255,0.12)] border border-[var(--primary)] px-4 py-3 text-sm">
      <p className="text-[var(--primary)]">
        {isZh
          ? "检测到项目包含代码。AI 将分析代码结构并生成 CLAUDE.md 和 AGENTS.md。"
          : "Project contains code. AI will analyze and generate CLAUDE.md + AGENTS.md."}
      </p>
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={handleAnalyzeAndGenerate}>
          {isZh ? "分析并生成" : "Analyze & Generate"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setState("done")}>
          {isZh ? "跳过" : "Skip"}
        </Button>
      </div>
    </div>
  );
}
