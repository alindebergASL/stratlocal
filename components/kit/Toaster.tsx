"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// A short message after something happened, at the foot of the screen, with
// Undo when the thing can be taken back. Errors are not toasts: they stay
// beside the control that failed, with what to do about it (DECISIONS #13).
export type Toast = { id: number; text: string; undo?: () => Promise<unknown> | unknown; tone?: "neutral" | "positive" };
type Ctx = { toast: (t: Omit<Toast, "id">) => void };

const ToastContext = createContext<Ctx>({ toast: () => {} });

export function useToast(): Ctx["toast"] {
  return useContext(ToastContext).toast;
}

const SHOWN_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = next.current++;
    // One at a time is plenty: a newer message replaces an older one.
    setToasts([{ ...t, id }]);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 max-sm:bottom-16">
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [undoing, setUndoing] = useState(false);
  useEffect(() => {
    const timer = setTimeout(onDone, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <div role="status" data-testid="toast" className="pointer-events-auto flex max-w-md items-center gap-4 rounded-xl bg-ink px-4 py-2.5 text-label text-ink-invert shadow-raised">
      <span className="min-w-0">{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          disabled={undoing}
          data-testid="toast-undo"
          className="shrink-0 font-semibold text-accent-soft underline-offset-2 hover:underline disabled:opacity-60"
          onClick={async () => {
            setUndoing(true);
            try {
              await toast.undo?.();
            } finally {
              onDone();
            }
          }}
        >
          {undoing ? "Undoing…" : "Undo"}
        </button>
      )}
    </div>
  );
}
