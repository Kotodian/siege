"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { CheckIcon, XIcon, CircleIcon, PlayIcon, SparklesIcon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProviderModelSelect, useDefaultProvider } from "@/components/ui/provider-model-select";
import { useGlobalLoading } from "@/components/ui/global-loading";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
  scheduleItemId: string | null;
  results: TestResult[];
}

interface TestSuite {
  id: string;
  planId: string;
  status: string;
  cases: TestCase[];
}

interface ScheduleTask {
  id: string;
  title: string;
  order: number;
  status: string;
  fileCount: number;
}

interface TestViewProps {
  planId: string;
  planStatus: string;
  onPlanStatusChange: () => void;
}

const COLLAPSE_THRESHOLD = 300; // characters

function ResultBlock({ content, isZh, isError }: { content: string; isZh: boolean; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = content.length > COLLAPSE_THRESHOLD;
  const display = long && !expanded ? content.slice(0, COLLAPSE_THRESHOLD) + "..." : content;

  return (
    <div className="mt-1">
      <pre className={`whitespace-pre-wrap text-xs ${isError ? "text-[var(--error)]" : ""}`}
        style={{ maxHeight: expanded ? "none" : "120px", overflow: "hidden" }}
      >{display}</pre>
      {long && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] mt-1"
          style={{ color: "var(--primary)" }}
        >
          {expanded ? (isZh ? "收起" : "Collapse") : (isZh ? "展开全部" : "Show all")}
        </button>
      )}
    </div>
  );
}

export function TestView({ planId, planStatus, onPlanStatusChange }: TestViewProps) {
  const t = useTranslations();
  const isZh = t("common.back") === "返回";
  const [suite, setSuite] = useState<TestSuite | null>(null);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [runningCase, setRunningCase] = useState<string | null>(null);
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const defaultProvider = useDefaultProvider();
  const { startLoading, updateContent, setTasks: setLoadingTasks, updateTaskStatus, stopLoading } = useGlobalLoading();
  const { confirm } = useConfirm();

  useEffect(() => {
    if (defaultProvider && !provider) setProvider(defaultProvider);
  }, [defaultProvider]);

  const fetchSuite = async () => {
    const res = await fetch(`/api/test-suites?planId=${planId}`);
    const data = await res.json();
    setSuite(data);
  };

  const fetchTasks = async () => {
    const res = await fetch(`/api/snapshots/tasks?planId=${planId}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data);
    }
  };

  useEffect(() => {
    fetchSuite();
    fetchTasks();
  }, [planId]);

  const toggleTask = (id: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedTasks.size === tasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(tasks.map(t => t.id)));
    }
  };

  const handleGenerate = async () => {
    if (selectedTasks.size === 0) return;
    setGenerating(true);
    const taskNames = tasks.filter(t => selectedTasks.has(t.id)).map(t => `#${t.order} ${t.title}`);
    startLoading(isZh ? `生成测试用例 (${selectedTasks.size} 个任务)` : `Generating tests (${selectedTasks.size} tasks)`);
    updateContent(taskNames.join("\n"));
    try {
      await fetch("/api/test-suites/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          provider: provider || undefined,
          model: model || undefined,
          scheduleItemIds: Array.from(selectedTasks),
        }),
      });
      await fetchSuite();
      onPlanStatusChange();
      stopLoading(isZh ? "测试用例生成完成" : "Tests generated");
    } catch {
      stopLoading(isZh ? "生成失败" : "Generation failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleRunCase = async (caseId: string) => {
    setRunningCase(caseId);
    const tc = suite?.cases.find(c => c.id === caseId);
    const label = tc?.description || tc?.name || "";
    startLoading(isZh ? `运行测试` : `Running test`);
    setLoadingTasks([{ id: caseId, order: 1, title: label, status: "running" }]);
    // Show elapsed time while waiting
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      updateContent(isZh ? `AI 正在执行测试... ${elapsed}s` : `AI executing test... ${elapsed}s`);
    }, 1000);
    try {
      const res = await fetch(`/api/test-cases/${caseId}/run`, { method: "POST" });
      clearInterval(timer);
      const result = await res.json();
      // Show the output immediately in loading dialog
      if (result?.output && result.output !== "No output") {
        updateContent(result.output.slice(0, 2000));
      }
      const freshRes = await fetch(`/api/test-suites?planId=${planId}`);
      const freshSuite = await freshRes.json() as TestSuite | null;
      setSuite(freshSuite);
      const freshCase = freshSuite?.cases.find(c => c.id === caseId);
      if (freshCase?.status === "passed") {
        updateTaskStatus(caseId, "completed");
        stopLoading(isZh ? "测试通过" : "Test passed");
      } else if (freshCase?.status === "failed") {
        updateTaskStatus(caseId, "failed");
        stopLoading(isZh ? "测试未通过" : "Test failed", "error");
        setFailedPrompt({ cases: [freshCase] });
      } else {
        stopLoading();
      }
    } catch {
      clearInterval(timer);
      updateTaskStatus(caseId, "failed");
      stopLoading(isZh ? "运行失败" : "Run failed", "error");
    } finally {
      setRunningCase(null);
    }
  };

  const handleRunAll = async () => {
    if (!suite) return;
    const toRun = suite.cases.filter(tc => tc.status !== "passed");
    if (toRun.length === 0) return;
    startLoading(isZh ? `运行测试 (${toRun.length} 个)` : `Running tests (${toRun.length})`);
    // Set up task timeline
    setLoadingTasks(toRun.map((tc, i) => ({
      id: tc.id,
      order: i + 1,
      title: tc.description || tc.name,
      status: "pending" as const,
    })));
    let passed = 0;
    let done = 0;
    for (const tc of toRun) {
      setRunningCase(tc.id);
      updateTaskStatus(tc.id, "running");
      const taskStart = Date.now();
      const timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - taskStart) / 1000);
        updateContent(isZh
          ? `[${done + 1}/${toRun.length}] ${tc.name} — ${elapsed}s`
          : `[${done + 1}/${toRun.length}] ${tc.name} — ${elapsed}s`);
      }, 1000);
      updateContent(isZh
        ? `[${done + 1}/${toRun.length}] ${tc.name}`
        : `[${done + 1}/${toRun.length}] ${tc.name}`);
      await fetch(`/api/test-cases/${tc.id}/run`, { method: "POST" });
      clearInterval(timer);
      done++;
      const res = await fetch(`/api/test-suites?planId=${planId}`);
      const freshSuite = await res.json() as TestSuite | null;
      const freshCase = freshSuite?.cases.find(c => c.id === tc.id);
      if (freshCase?.status === "passed") {
        passed++;
        updateTaskStatus(tc.id, "completed");
      } else {
        updateTaskStatus(tc.id, "failed");
      }
    }
    setRunningCase(null);
    const finalRes = await fetch(`/api/test-suites?planId=${planId}`);
    const finalSuite = await finalRes.json() as TestSuite | null;
    setSuite(finalSuite);
    onPlanStatusChange();
    const failedCases = finalSuite?.cases.filter(c => c.status === "failed") || [];
    stopLoading(isZh
      ? `测试完成: ${passed}/${done} 通过`
      : `Done: ${passed}/${done} passed`);
    if (failedCases.length > 0) {
      setFailedPrompt({ cases: failedCases });
    }
  };

  // Failed test prompt
  const [failedPrompt, setFailedPrompt] = useState<{ cases: TestCase[] } | null>(null);

  const handleCreateFixTasks = async (failedCases: TestCase[]) => {
    for (const tc of failedCases) {
      const lastResult = tc.results[tc.results.length - 1];
      await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          title: `[fix] ${tc.description || tc.name}`,
          description: `Test failed: ${tc.name}\n\n${lastResult?.errorMessage || lastResult?.output || ""}\n\nFile: ${tc.filePath || ""}`.trim(),
          afterItemId: tc.scheduleItemId || undefined,
          estimatedHours: 0.5,
        }),
      });
    }
    setFailedPrompt(null);
    onPlanStatusChange();
  };

  // Edit test case
  const [editingCase, setEditingCase] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", type: "unit", code: "", filePath: "" });

  const startEditCase = (tc: TestCase) => {
    setEditForm({
      name: tc.name,
      description: tc.description || "",
      type: tc.type,
      code: tc.generatedCode || "",
      filePath: tc.filePath || "",
    });
    setEditingCase(tc.id);
  };

  const saveEditCase = async () => {
    if (!editingCase) return;
    await fetch(`/api/test-cases/${editingCase}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        description: editForm.description,
        type: editForm.type,
        generatedCode: editForm.code,
        filePath: editForm.filePath,
      }),
    });
    setEditingCase(null);
    await fetchSuite();
  };

  const deleteCase = async (caseId: string) => {
    await fetch(`/api/test-cases/${caseId}`, { method: "DELETE" });
    setExpandedCase(null);
    await fetchSuite();
  };

  // Manual add test case
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", description: "", type: "unit", code: "", filePath: "", taskId: "" });

  const handleAddCase = async () => {
    if (!addForm.name.trim()) return;
    await fetch("/api/test-cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        name: addForm.name,
        description: addForm.description,
        type: addForm.type,
        generatedCode: addForm.code,
        filePath: addForm.filePath || undefined,
        scheduleItemId: addForm.taskId || undefined,
      }),
    });
    setAddDialogOpen(false);
    setAddForm({ name: "", description: "", type: "unit", code: "", filePath: "", taskId: "" });
    await fetchSuite();
  };

  const passedCount = suite?.cases.filter(c => c.status === "passed").length || 0;
  const totalCount = suite?.cases.length || 0;

  // Group cases by task
  const casesByTask = new Map<string, { title: string; order: number; cases: TestCase[] }>();
  if (suite) {
    for (const tc of suite.cases) {
      const taskId = tc.scheduleItemId || "_unlinked";
      if (!casesByTask.has(taskId)) {
        const task = tasks.find(t => t.id === taskId);
        casesByTask.set(taskId, {
          title: task?.title || (isZh ? "未关联任务" : "Unlinked"),
          order: task?.order ?? 999,
          cases: [],
        });
      }
      casesByTask.get(taskId)!.cases.push(tc);
    }
  }
  const sortedGroups = [...casesByTask.values()].sort((a, b) => a.order - b.order);
  const hasGroups = sortedGroups.length > 1 || (sortedGroups.length === 1 && sortedGroups[0].order !== 999);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">{t("plan.tabs.tests")}</h3>
          {suite && totalCount > 0 && (
            <span className="text-sm" style={{ color: "var(--outline)" }}>
              {passedCount}/{totalCount} {isZh ? "通过" : "passed"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAddDialogOpen(true)}>
            {isZh ? "手动添加" : "Add Test"}
          </Button>
          {suite && suite.cases.length > 0 && (
            <Button size="sm" onClick={handleRunAll} disabled={runningCase !== null}>
              <PlayIcon size={14} className="inline-block align-[-2px]" /> {runningCase ? t("common.loading") : (isZh ? "全部运行" : "Run All")}
          </Button>
          )}
        </div>
      </div>

      {/* Task selector for generation */}
      {tasks.length > 0 && (
        <div className="rounded-lg border p-4" style={{ background: "var(--surface-container-high)", borderColor: "var(--outline-variant)" }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium" style={{ color: "var(--on-surface)" }}>
              {isZh ? "选择要测试的已完成任务" : "Select completed tasks to test"}
            </h4>
            <button onClick={selectAll} className="text-xs" style={{ color: "var(--outline)" }}>
              {selectedTasks.size === tasks.length ? (isZh ? "取消全选" : "Deselect All") : (isZh ? "全选" : "Select All")}
            </button>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {tasks.map((task) => {
              const existingCases = suite?.cases.filter(c => c.scheduleItemId === task.id) || [];
              const taskPassed = existingCases.length > 0 && existingCases.every(c => c.status === "passed");
              return (
                <label
                  key={task.id}
                  className="flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:opacity-80"
                  style={{ background: selectedTasks.has(task.id) ? "rgba(59,130,246,0.1)" : undefined }}
                >
                  <input
                    type="checkbox"
                    checked={selectedTasks.has(task.id)}
                    onChange={() => toggleTask(task.id)}
                    className="rounded"
                  />
                  <span className="text-sm flex-1" style={{ color: "var(--on-surface)" }}>
                    #{task.order} {task.title}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--outline)" }}>
                    {task.fileCount} {isZh ? "文件" : "files"}
                  </span>
                  {existingCases.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                      background: taskPassed ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)",
                      color: taskPassed ? "#86efac" : "#93c5fd",
                    }}>
                      {existingCases.filter(c => c.status === "passed").length}/{existingCases.length}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <ProviderModelSelect
              provider={provider}
              model={model}
              onProviderChange={setProvider}
              onModelChange={setModel}
              disabled={generating}
              compact
            />
            <Button
              onClick={handleGenerate}
              disabled={generating || selectedTasks.size === 0}
              size="sm"
            >
              <SparklesIcon size={14} className="inline-block align-[-2px]" /> {generating
                ? (isZh ? "生成中..." : "Generating...")
                : (() => {
                    const hasExisting = [...selectedTasks].some(id => suite?.cases.some(c => c.scheduleItemId === id));
                    return hasExisting
                      ? (isZh ? `重新生成 (${selectedTasks.size})` : `Regenerate (${selectedTasks.size})`)
                      : (isZh ? `生成测试 (${selectedTasks.size})` : `Generate (${selectedTasks.size})`);
                  })()}
            </Button>
          </div>
        </div>
      )}

      {tasks.length === 0 && (
        <p className="text-sm text-center py-4" style={{ color: "var(--outline)" }}>
          {isZh ? "暂无已完成的任务。请先执行排期任务。" : "No completed tasks yet. Execute schedule tasks first."}
        </p>
      )}

      {/* Test cases grouped by task */}
      {suite && suite.cases.length > 0 && (
        <div className="space-y-3">
          {sortedGroups.map((group) => {
            const groupPassed = group.cases.filter(c => c.status === "passed").length;
            return (
              <div key={group.order} className="rounded-lg border" style={{ borderColor: "var(--outline-variant)" }}>
                {hasGroups && (
                  <div className="px-4 py-2 flex items-center justify-between" style={{ background: "var(--background)", borderBottom: "1px solid var(--outline-variant)" }}>
                    <span className="text-xs font-medium" style={{ color: "var(--outline)" }}>
                      #{group.order} {group.title}
                    </span>
                    <span className="text-[10px]" style={{ color: groupPassed === group.cases.length ? "#86efac" : "var(--outline)" }}>
                      {groupPassed}/{group.cases.length}
                    </span>
                  </div>
                )}
                {group.cases.map((tc) => (
                  <div key={tc.id} style={{ borderBottom: "1px solid var(--outline-variant)" }}>
                    <div
                      className="px-4 py-3 flex items-center justify-between cursor-pointer hover:opacity-80"
                      style={{ background: "var(--surface-container-high)" }}
                      onClick={() => setExpandedCase(expandedCase === tc.id ? null : tc.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {tc.status === "passed"
                          ? <CheckIcon size={16} className="text-[var(--success)] shrink-0" />
                          : tc.status === "failed"
                            ? <XIcon size={16} className="text-[var(--error)] shrink-0" />
                            : <CircleIcon size={16} className="text-[var(--on-surface-variant)] shrink-0" />}
                        <div className="min-w-0">
                          <span className="text-sm truncate block" style={{ color: "var(--on-surface)" }}>
                            {tc.description || tc.name}
                          </span>
                          {tc.description && (
                            <span className="text-[10px] font-mono truncate block" style={{ color: "var(--outline)" }}>
                              {tc.name}
                            </span>
                          )}
                        </div>
                        <StatusBadge status={tc.type} label={tc.type} />
                      </div>
                      <div className="flex items-center gap-2">
                        {tc.results.length > 0 && (
                          <span className="text-xs" style={{ color: "var(--outline)" }}>
                            {tc.results[tc.results.length - 1].durationMs}ms
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); handleRunCase(tc.id); }}
                          disabled={runningCase !== null}
                        >
                          {runningCase === tc.id ? "..." : (isZh ? "运行" : "Run")}
                        </Button>
                      </div>
                    </div>

                    {expandedCase === tc.id && (
                      <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid var(--outline-variant)", background: "var(--surface-container-high)" }}>
                        {editingCase === tc.id ? (
                          <div className="pt-3 space-y-3">
                            <Input label={isZh ? "名称" : "Name"} value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} />
                            <Input label={isZh ? "描述" : "Description"} value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} />
                            <Input label={isZh ? "文件路径" : "File Path"} value={editForm.filePath} onChange={(e) => setEditForm(f => ({ ...f, filePath: e.target.value }))} />
                            <div>
                              <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>{isZh ? "测试代码" : "Test Code"}</label>
                              <textarea value={editForm.code} onChange={(e) => setEditForm(f => ({ ...f, code: e.target.value }))} rows={8}
                                className="w-full rounded-md border px-3 py-2 text-sm font-mono" style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }} />
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={saveEditCase}>{t("common.save")}</Button>
                              <Button size="sm" variant="secondary" onClick={() => setEditingCase(null)}>{t("common.cancel")}</Button>
                            </div>
                          </div>
                        ) : (
                        <>
                        {/* Action buttons */}
                        <div className="pt-3 flex gap-2">
                          <button onClick={() => startEditCase(tc)} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ background: "var(--outline-variant)", color: "var(--on-surface)" }}>
                            {t("common.edit")}
                          </button>
                          <button onClick={() => { confirm(isZh ? "删除测试" : "Delete Test", isZh ? "确定删除？" : "Delete this test?").then(ok => { if (ok) deleteCase(tc.id); }); }} className="text-xs px-2 py-1 rounded hover:opacity-80 text-[var(--error)]" style={{ background: "rgba(239,68,68,0.1)" }}>
                            {t("common.delete")}
                          </button>
                        </div>
                        {tc.description && (
                          <div>
                            <MarkdownRenderer content={tc.description} />
                          </div>
                        )}
                        {tc.generatedCode && (
                          <div className="pt-2">
                            <h5 className="text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>
                              {isZh ? "测试代码" : "Test Code"}
                            </h5>
                            <MarkdownRenderer content={`\`\`\`\n${tc.generatedCode}\n\`\`\``} />
                          </div>
                        )}
                        {tc.results.length > 0 && (
                          <div className="pt-2">
                            <h5 className="text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>
                              {isZh ? `运行记录 (${tc.results.length})` : `Results (${tc.results.length})`}
                            </h5>
                            {tc.results.slice().reverse().map((r) => (
                              <div key={r.id} className="text-xs p-3 rounded mb-2" style={{ background: "var(--background)", color: "var(--on-surface)" }}>
                                <div className="flex items-center gap-2 mb-1">
                                  <StatusBadge status={r.status} label={r.status} />
                                  <span style={{ color: "var(--outline)" }}>{r.durationMs}ms</span>
                                  <span style={{ color: "var(--outline)" }} suppressHydrationWarning>
                                    {new Date(r.runAt + "Z").toLocaleString()}
                                  </span>
                                </div>
                                {r.output && r.output !== "No output" && (
                                  <ResultBlock content={r.output} isZh={isZh} />
                                )}
                                {r.errorMessage && (
                                  <ResultBlock content={r.errorMessage} isZh={isZh} isError />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Add test case dialog */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} title={isZh ? "添加测试用例" : "Add Test Case"}>
        <div className="space-y-3">
          <Input label={isZh ? "测试名称" : "Test Name"} value={addForm.name} onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="test_something" />
          <Input label={isZh ? "描述" : "Description"} value={addForm.description} onChange={(e) => setAddForm(f => ({ ...f, description: e.target.value }))} placeholder={isZh ? "验证某个功能" : "Validates something"} />
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>{isZh ? "类型" : "Type"}</label>
            <select value={addForm.type} onChange={(e) => setAddForm(f => ({ ...f, type: e.target.value }))} className="w-full rounded-md border px-3 py-2 text-sm" style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}>
              <option value="unit">Unit</option>
              <option value="integration">Integration</option>
              <option value="e2e">E2E</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>{isZh ? "测试代码" : "Test Code"}</label>
            <textarea value={addForm.code} onChange={(e) => setAddForm(f => ({ ...f, code: e.target.value }))} rows={6} className="w-full rounded-md border px-3 py-2 text-sm font-mono focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]" style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }} placeholder={isZh ? "测试代码..." : "Test code..."} />
          </div>
          <Input label={isZh ? "文件路径" : "File Path"} value={addForm.filePath} onChange={(e) => setAddForm(f => ({ ...f, filePath: e.target.value }))} placeholder="tests/test_something.rs" />
          {tasks.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: "var(--on-surface)" }}>{isZh ? "关联任务" : "Linked Task"}</label>
              <select value={addForm.taskId} onChange={(e) => setAddForm(f => ({ ...f, taskId: e.target.value }))} className="w-full rounded-md border px-3 py-2 text-sm" style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}>
                <option value="">{isZh ? "无" : "None"}</option>
                {tasks.map(t => <option key={t.id} value={t.id}>#{t.order} {t.title}</option>)}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleAddCase} disabled={!addForm.name.trim()}>{t("common.create")}</Button>
          </div>
        </div>
      </Dialog>

      {/* Failed tests prompt */}
      <Dialog
        open={!!failedPrompt}
        onClose={() => setFailedPrompt(null)}
        title={isZh ? "测试未通过" : "Tests Failed"}
      >
        {failedPrompt && (
          <div className="space-y-4">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {failedPrompt.cases.map(tc => (
                <div key={tc.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}>
                  <XIcon size={12} />
                  <span>{tc.description || tc.name}</span>
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: "var(--outline)" }}>
              {isZh
                ? `${failedPrompt.cases.length} 个测试未通过，你可以：`
                : `${failedPrompt.cases.length} test(s) failed. You can:`}
            </p>
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => handleCreateFixTasks(failedPrompt.cases)}
              >
                {isZh ? `创建 ${failedPrompt.cases.length} 个修复任务到排期` : `Create ${failedPrompt.cases.length} Fix Task(s)`}
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => { setFailedPrompt(null); handleRunAll(); }}
              >
                {isZh ? "重新运行失败的测试" : "Re-run Failed Tests"}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setFailedPrompt(null)}
              >
                {isZh ? "暂不处理" : "Ignore"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
