"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface AnalyzePromptProps {
  repoPath: string;
  onResult: (description: string) => void;
  isZh: boolean;
}

export function AnalyzePrompt({ repoPath, onResult, isZh }: AnalyzePromptProps) {
  const [state, setState] = useState<"checking" | "asking" | "analyzing" | "done">("checking");
  const [source, setSource] = useState("");

  // Auto-check: if CLAUDE.md/AGENTS.md exists, auto-fill and skip
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/projects/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath }),
        });
        const data = await res.json();

        if (data.empty) {
          setState("done");
          return;
        }

        if (data.hasAgentDocs) {
          onResult(data.description);
          setSource(data.source);
          setState("done");
          return;
        }

        setState("asking");
      } catch {
        setState("done");
      }
    })();
  }, [repoPath]);

  const handleAnalyze = async () => {
    setState("analyzing");
    try {
      const res = await fetch("/api/projects/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath }),
      });
      const data = await res.json();
      if (data.description) {
        onResult(data.description);
      }
    } catch {
      // ignore
    }
    setState("done");
  };

  if (state === "checking") {
    return (
      <div className="rounded-md bg-gray-50 border px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {isZh ? "检测项目..." : "Checking project..."}
      </div>
    );
  }

  if (state === "done") {
    if (source) {
      return (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-2 text-xs text-green-700">
          {isZh ? `已从 ${source} 读取项目描述` : `Loaded from ${source}`}
        </div>
      );
    }
    return null;
  }

  if (state === "analyzing") {
    return (
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {isZh ? "AI 正在分析项目..." : "AI is analyzing..."}
      </div>
    );
  }

  return (
    <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm">
      <p className="text-blue-700">
        {isZh
          ? "检测到项目包含代码。是否使用 AI 分析并自动生成描述？"
          : "Project contains code. Use AI to analyze and generate description?"}
      </p>
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={handleAnalyze}>
          {isZh ? "分析项目" : "Analyze"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setState("done")}>
          {isZh ? "跳过" : "Skip"}
        </Button>
      </div>
    </div>
  );
}
