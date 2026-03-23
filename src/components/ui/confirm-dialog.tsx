"use client";

import { useState, useCallback, createContext, useContext, ReactNode } from "react";
import { Dialog } from "./dialog";
import { Button } from "./button";

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

interface ConfirmContextType {
  confirm: (title: string, message: string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType>({
  confirm: () => Promise.resolve(false),
});

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({ open: false, title: "", message: "", onConfirm: () => {} });
  const resolveRef = { current: null as ((v: boolean) => void) | null };

  const confirm = useCallback((title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, title, message, onConfirm: () => { resolve(true); setState(s => ({ ...s, open: false })); } });
    });
  }, []);

  const handleClose = () => {
    resolveRef.current?.(false);
    setState(s => ({ ...s, open: false }));
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Dialog open={state.open} onClose={handleClose} title={state.title}>
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--on-surface)" }}>{state.message}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose}>取消 / Cancel</Button>
            <Button onClick={state.onConfirm} style={{ background: "var(--error)", color: "var(--on-error)" }}>确认 / Confirm</Button>
          </div>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
