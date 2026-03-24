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
        <h2 className="text-xl font-bold" style={{ color: "var(--on-surface)" }}>
          出错了 / Something went wrong
        </h2>
        <p className="text-sm" style={{ color: "var(--outline)" }}>
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="text-xs font-mono" style={{ color: "var(--outline)" }}>
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ background: "var(--on-surface)", color: "var(--background)" }}
          >
            重试 / Retry
          </button>
          <a
            href="/"
            className="px-4 py-2 rounded-md text-sm font-medium border"
            style={{ color: "var(--on-surface)", borderColor: "var(--outline-variant)" }}
          >
            返回首页 / Home
          </a>
        </div>
      </div>
    </div>
  );
}
