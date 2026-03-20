"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";

interface GlobalLoadingContextType {
  loading: boolean;
  message: string;
  content: string;
  startLoading: (message: string) => void;
  updateContent: (content: string) => void;
  stopLoading: (toast?: string) => void;
  toast: string;
}

const GlobalLoadingContext = createContext<GlobalLoadingContextType>({
  loading: false,
  message: "",
  content: "",
  startLoading: () => {},
  updateContent: () => {},
  stopLoading: () => {},
  toast: "",
});

export function useGlobalLoading() {
  return useContext(GlobalLoadingContext);
}

function LoadingDialog({
  loading,
  message,
  content,
  contentRef,
}: {
  loading: boolean;
  message: string;
  content: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
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
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 rounded-xl p-0 backdrop:bg-black/40 backdrop:backdrop-blur-[1px] w-full max-w-2xl max-h-[80vh]"
      style={{ background: "var(--card)", color: "var(--foreground)" }}
    >
      <div className="rounded-xl shadow-lg flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid var(--card-border)" }}>
          <svg className="animate-spin h-5 w-5 text-blue-600 flex-shrink-0" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-gray-700">{message}</p>
            <p className="text-xs text-gray-400">
              {content ? "" : "约 1-2 分钟"}
            </p>
          </div>
        </div>
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto px-6 py-4 min-h-[200px]"
        >
          {content ? (
            <MarkdownRenderer content={content} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-300">
              <p className="text-sm">等待 AI 输出...</p>
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
    // Auto scroll to bottom
    setTimeout(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  const stopLoading = useCallback((toastMsg?: string) => {
    setLoading(false);
    setMessage("");
    setContent("");
    if (toastMsg) {
      setToast(toastMsg);
      setTimeout(() => setToast(""), 4000);
    }
  }, []);

  return (
    <GlobalLoadingContext.Provider value={{ loading, message, content, startLoading, updateContent, stopLoading, toast }}>
      {children}

      <LoadingDialog
        loading={loading}
        message={message}
        content={content}
        contentRef={contentRef}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="bg-green-600 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium">
            ✓ {toast}
          </div>
        </div>
      )}
    </GlobalLoadingContext.Provider>
  );
}
