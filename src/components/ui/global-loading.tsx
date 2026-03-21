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
  startLoading: (message: string) => void;
  updateContent: (content: string) => void;
  setTasks: (tasks: TaskProgress[]) => void;
  updateTaskStatus: (taskId: string, status: TaskProgress["status"]) => void;
  stopLoading: (toast?: string) => void;
  toast: string;
}

const GlobalLoadingContext = createContext<GlobalLoadingContextType>({
  loading: false,
  message: "",
  content: "",
  tasks: [],
  startLoading: () => {},
  updateContent: () => {},
  setTasks: () => {},
  updateTaskStatus: () => {},
  stopLoading: () => {},
  toast: "",
});

export function useGlobalLoading() {
  return useContext(GlobalLoadingContext);
}

function TaskTimeline({ tasks }: { tasks: TaskProgress[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="px-6 py-3 overflow-x-auto" style={{ borderBottom: "1px solid var(--card-border)" }}>
      <div className="flex items-center gap-1 min-w-0">
        {tasks.map((task, i) => (
          <div key={task.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && (
              <div
                className="w-4 h-px shrink-0"
                style={{ background: task.status === "pending" ? "var(--card-border)" : "var(--foreground)" }}
              />
            )}
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] whitespace-nowrap ${
                task.status === "running" ? "ring-1 ring-blue-400" : ""
              }`}
              style={{
                background: task.status === "completed"
                  ? "rgba(34,197,94,0.15)"
                  : task.status === "running"
                    ? "rgba(59,130,246,0.15)"
                    : task.status === "failed"
                      ? "rgba(239,68,68,0.15)"
                      : "var(--card-border)",
                color: task.status === "completed"
                  ? "#22c55e"
                  : task.status === "running"
                    ? "#3b82f6"
                    : task.status === "failed"
                      ? "#ef4444"
                      : "var(--muted)",
              }}
            >
              {task.status === "completed" ? (
                <CheckIcon size={10} />
              ) : task.status === "running" ? (
                <HourglassIcon size={10} className="animate-pulse" />
              ) : task.status === "failed" ? (
                <XIcon size={10} />
              ) : (
                <CircleIcon size={10} />
              )}
              <span>#{task.order} {task.title}</span>
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
}: {
  loading: boolean;
  message: string;
  content: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  tasks: TaskProgress[];
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
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{message}</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {content ? "" : "约 1-2 分钟"}
            </p>
          </div>
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
  const contentRef = useRef<HTMLDivElement>(null);

  const startLoading = useCallback((msg: string) => {
    setLoading(true);
    setMessage(msg);
    setContent("");
    setToast("");
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

  const stopLoading = useCallback((toastMsg?: string) => {
    setLoading(false);
    setMessage("");
    setContent("");
    setTasksState([]);
    if (toastMsg) {
      setToast(toastMsg);
      setTimeout(() => setToast(""), 4000);
    }
  }, []);

  return (
    <GlobalLoadingContext.Provider value={{ loading, message, content, tasks, startLoading, updateContent, setTasks, updateTaskStatus, stopLoading, toast }}>
      {children}

      <LoadingDialog
        loading={loading}
        message={message}
        content={content}
        contentRef={contentRef}
        tasks={tasks}
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
