"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { CheckIcon, CircleIcon, HourglassIcon, XIcon } from "@/components/ui/icons";

export interface TaskProgress {
  id: string;
  order: number;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface GlobalLoadingContextType {
  loading: boolean;
  message: string;
  content: string;
  tasks: TaskProgress[];
  onCancel: (() => void) | null;
  startLoading: (message: string) => void;
  updateContent: (content: string) => void;
  setTasks: (tasks: TaskProgress[]) => void;
  updateTaskStatus: (taskId: string, status: TaskProgress["status"]) => void;
  setOnCancel: (fn: (() => void) | null) => void;
  stopLoading: (toast?: string) => void;
  toast: string;
}

const GlobalLoadingContext = createContext<GlobalLoadingContextType>({
  loading: false,
  message: "",
  content: "",
  tasks: [],
  onCancel: null,
  startLoading: () => {},
  updateContent: () => {},
  setTasks: () => {},
  updateTaskStatus: () => {},
  setOnCancel: () => {},
  stopLoading: () => {},
  toast: "",
});

export function useGlobalLoading() {
  return useContext(GlobalLoadingContext);
}

function TaskTimeline({ tasks }: { tasks: TaskProgress[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="px-6 py-3 max-h-[180px] overflow-y-auto" style={{ borderBottom: "1px solid var(--card-border)" }}>
      <div className="space-y-0">
        {tasks.map((task, i) => (
          <div key={task.id} className="flex items-stretch gap-3">
            {/* Vertical line + dot */}
            <div className="flex flex-col items-center w-4 shrink-0">
              {task.status === "running" ? (
                <svg className="w-4 h-4 shrink-0 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0 mt-[3px]"
                  style={{
                    background: task.status === "completed"
                      ? "#22c55e"
                      : task.status === "failed"
                        ? "#ef4444"
                        : "var(--card-border)",
                  }}
                />
              )}
              {i < tasks.length - 1 && (
                <div
                  className="flex-1 w-px min-h-[12px]"
                  style={{
                    background: task.status === "completed" ? "#22c55e" : "var(--card-border)",
                  }}
                />
              )}
            </div>
            {/* Task label */}
            <div className={`text-xs pb-2 ${task.status === "running" ? "font-medium" : ""}`}
              style={{
                color: task.status === "completed"
                  ? "#22c55e"
                  : task.status === "running"
                    ? "var(--foreground)"
                    : task.status === "failed"
                      ? "#ef4444"
                      : "var(--muted)",
              }}
            >
              #{task.order} {task.title}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingDialog({
  loading,
  message,
  content,
  contentRef,
  tasks,
  onCancel,
}: {
  loading: boolean;
  message: string;
  content: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  tasks: TaskProgress[];
  onCancel: (() => void) | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (loading && !dialog.open) {
      dialog.showModal();
    } else if (!loading && dialog.open) {
      dialog.close();
    }
  }, [loading]);

  return (
    <dialog
      ref={dialogRef}
      className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 rounded-xl p-0 backdrop:bg-black/40 backdrop:backdrop-blur-[1px] w-full max-h-[80vh] ${tasks.length > 0 ? "max-w-4xl" : "max-w-2xl"}`}
      style={{ background: "var(--card)", color: "var(--foreground)" }}
    >
      <div className="rounded-xl shadow-lg flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: tasks.length > 0 ? undefined : "1px solid var(--card-border)" }}>
          <svg className="animate-spin h-5 w-5 flex-shrink-0" style={{ color: "var(--foreground)" }} viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{message}</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {content ? "" : "约 1-2 分钟"}
            </p>
          </div>
          <button
            onClick={onCancel || (() => {
              // Fallback: force close the dialog
              const dialog = document.querySelector("dialog[open]") as HTMLDialogElement;
              if (dialog) dialog.close();
            })}
            className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium hover:opacity-80"
            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
          >
            {onCancel ? (tasks.length > 0 ? "停止 / Stop" : "取消 / Cancel") : "关闭 / Close"}
          </button>
        </div>
        <TaskTimeline tasks={tasks} />
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto px-6 py-4 min-h-[200px]"
        >
          {content ? (
            <MarkdownRenderer content={content} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: "var(--muted)" }}>等待 AI 输出...</p>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [content, setContent] = useState("");
  const [tasks, setTasksState] = useState<TaskProgress[]>([]);
  const [toast, setToast] = useState("");
  const cancelRef = useRef<(() => void) | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startLoading = useCallback((msg: string) => {
    setLoading(true);
    setMessage(msg);
    setContent("");
    setToast("");
    // Safety: auto-close after 10 minutes to prevent stuck dialogs
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => {
      setLoading(false);
      setMessage("");
      setContent("");
      setTasksState([]);
      cancelRef.current = null;
    }, 600000);
  }, []);

  const updateContent = useCallback((c: string) => {
    setContent(c);
    setTimeout(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  const setTasks = useCallback((t: TaskProgress[]) => {
    setTasksState(t);
  }, []);

  const updateTaskStatus = useCallback((taskId: string, status: TaskProgress["status"]) => {
    setTasksState(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
  }, []);

  const setOnCancel = useCallback((fn: (() => void) | null) => {
    cancelRef.current = fn;
  }, []);

  const stopLoading = useCallback((toastMsg?: string) => {
    setLoading(false);
    setMessage("");
    setContent("");
    setTasksState([]);
    cancelRef.current = null;
    if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
    if (toastMsg) {
      setToast(toastMsg);
      setTimeout(() => setToast(""), 4000);
    }
  }, []);

  return (
    <GlobalLoadingContext.Provider value={{ loading, message, content, tasks, onCancel: cancelRef.current, startLoading, updateContent, setTasks, updateTaskStatus, setOnCancel, stopLoading, toast }}>
      {children}

      <LoadingDialog
        loading={loading}
        message={message}
        content={content}
        contentRef={contentRef}
        tasks={tasks}
        onCancel={cancelRef.current}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium">
            <CheckIcon size={14} className="inline-block align-[-2px]" /> {toast}
          </div>
        </div>
      )}
    </GlobalLoadingContext.Provider>
  );
}
