"use client";

import { useEffect, useRef, ReactNode } from "react";
import { XIcon } from "@/components/ui/icons";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Dialog({ open, onClose, title, children, maxWidth }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 rounded-lg p-0 backdrop:bg-black/60 w-full max-h-[calc(100vh-2rem)] overflow-auto ${maxWidth || "max-w-lg"}`}
      style={{ background: "var(--surface-container-high)", color: "var(--on-surface)", border: "none" }}
    >
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="transition-colors"
            style={{ color: "var(--on-surface-variant)" }}
            onMouseEnter={(e) => e.currentTarget.style.color = "var(--on-surface)"}
            onMouseLeave={(e) => e.currentTarget.style.color = "var(--on-surface-variant)"}
          >
            <XIcon size={16} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
