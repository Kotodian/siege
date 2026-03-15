"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";

interface TestResult {
  id: string;
  testCaseId: string;
  runAt: string;
  status: string;
  output: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}

interface TestCase {
  id: string;
  name: string;
  description: string | null;
  type: string;
  generatedCode: string | null;
  filePath: string | null;
  status: string;
  results: TestResult[];
}

interface TestSuite {
  id: string;
  planId: string;
  status: string;
  cases: TestCase[];
}

interface TestViewProps {
  planId: string;
  planStatus: string;
  onPlanStatusChange: () => void;
}

export function TestView({
  planId,
  planStatus,
  onPlanStatusChange,
}: TestViewProps) {
  const t = useTranslations();
  const [suite, setSuite] = useState<TestSuite | null>(null);
  const [generating, setGenerating] = useState(false);
  const [runningCase, setRunningCase] = useState<string | null>(null);
  const [expandedCase, setExpandedCase] = useState<string | null>(null);

  const fetchSuite = async () => {
    const res = await fetch(`/api/test-suites?planId=${planId}`);
    const data = await res.json();
    setSuite(data);
  };

  useEffect(() => {
    fetchSuite();
  }, [planId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await fetch("/api/test-suites/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, provider: "anthropic" }),
      });
      await fetchSuite();
      onPlanStatusChange();
    } finally {
      setGenerating(false);
    }
  };

  const handleRunCase = async (caseId: string) => {
    setRunningCase(caseId);
    try {
      await fetch(`/api/test-cases/${caseId}/run`, { method: "POST" });
      await fetchSuite();
    } finally {
      setRunningCase(null);
    }
  };

  const handleRunAll = async () => {
    if (!suite) return;
    for (const tc of suite.cases) {
      if (tc.status !== "passed") {
        setRunningCase(tc.id);
        await fetch(`/api/test-cases/${tc.id}/run`, { method: "POST" });
      }
    }
    setRunningCase(null);
    await fetchSuite();
    onPlanStatusChange();
  };

  const passedCount =
    suite?.cases.filter((c) => c.status === "passed").length || 0;
  const totalCount = suite?.cases.length || 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">{t("plan.tabs.tests")}</h3>
          {suite && totalCount > 0 && (
            <span className="text-sm text-gray-500">
              {passedCount}/{totalCount} passed
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? t("common.loading") : t("scheme.generate")}
          </Button>
          {suite && suite.cases.length > 0 && (
            <Button onClick={handleRunAll} disabled={runningCase !== null}>
              {runningCase ? t("common.loading") : "Run All"}
            </Button>
          )}
        </div>
      </div>

      {!suite || suite.cases.length === 0 ? (
        <p className="text-gray-500 text-center py-8">
          {t("common.noData")}
        </p>
      ) : (
        <div className="space-y-2">
          {suite.cases.map((tc) => (
            <div key={tc.id} className="rounded-lg border bg-white">
              <div
                className="p-4 flex items-center justify-between cursor-pointer"
                onClick={() =>
                  setExpandedCase(
                    expandedCase === tc.id ? null : tc.id
                  )
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {tc.status === "passed"
                      ? "✓"
                      : tc.status === "failed"
                        ? "✗"
                        : "○"}
                  </span>
                  <span className="font-mono text-sm">{tc.name}</span>
                  <StatusBadge status={tc.status} label={tc.status} />
                  <span className="text-xs text-gray-400">{tc.type}</span>
                </div>
                <div className="flex items-center gap-2">
                  {tc.results.length > 0 && (
                    <span className="text-xs text-gray-400">
                      {tc.results[tc.results.length - 1].durationMs}ms
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRunCase(tc.id);
                    }}
                    disabled={runningCase !== null}
                  >
                    {runningCase === tc.id ? "..." : "Run"}
                  </Button>
                </div>
              </div>

              {expandedCase === tc.id && (
                <div className="border-t px-4 pb-4 space-y-3">
                  {tc.description && (
                    <div className="pt-3">
                      <MarkdownRenderer content={tc.description} />
                    </div>
                  )}
                  {tc.generatedCode && (
                    <div className="pt-2">
                      <h5 className="text-sm font-medium mb-1">
                        Generated Code
                      </h5>
                      <MarkdownRenderer
                        content={`\`\`\`\n${tc.generatedCode}\n\`\`\``}
                      />
                    </div>
                  )}
                  {tc.results.length > 0 && (
                    <div className="pt-2">
                      <h5 className="text-sm font-medium mb-1">
                        Results ({tc.results.length} runs)
                      </h5>
                      {tc.results
                        .slice()
                        .reverse()
                        .map((r) => (
                          <div
                            key={r.id}
                            className="text-xs bg-gray-50 p-3 rounded mb-2"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <StatusBadge
                                status={r.status}
                                label={r.status}
                              />
                              <span className="text-gray-400">
                                {r.durationMs}ms
                              </span>
                              <span className="text-gray-400">
                                {new Date(r.runAt).toLocaleString()}
                              </span>
                            </div>
                            {r.output && (
                              <pre className="whitespace-pre-wrap mt-1">
                                {r.output}
                              </pre>
                            )}
                            {r.errorMessage && (
                              <pre className="whitespace-pre-wrap text-red-600 mt-1">
                                {r.errorMessage}
                              </pre>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
