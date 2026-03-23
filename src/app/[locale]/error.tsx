"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md">
        <div className="text-4xl">⚠</div>
        <h2 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
          出错了 / Something went wrong
        </h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="text-xs font-mono" style={{ color: "var(--muted)" }}>
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            重试 / Retry
          </button>
          <a
            href="/"
            className="px-4 py-2 rounded-md text-sm font-medium border"
            style={{ color: "var(--foreground)", borderColor: "var(--card-border)" }}
          >
            返回首页 / Home
          </a>
        </div>
      </div>
    </div>
  );
}
