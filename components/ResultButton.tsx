"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonVariant } from "./ui";

type Result = { ok: true; message?: string } | { ok: false; error: string };

// A button bound to one server action that answers ok or not, says what
// happened beside itself, and refreshes the page on success.
export function ResultButton({
  run,
  children,
  variant = "quiet",
  size = "sm",
  testId,
  className = "",
}: {
  run: () => Promise<Result>;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  testId?: string;
  className?: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        data-testid={testId}
        onClick={() =>
          start(async () => {
            try {
              const r = await run();
              setNote(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
              if (r.ok) router.refresh();
            } catch {
              setNote({ ok: false, text: "The request did not come back. Reload to see what happened." });
            }
          })
        }
      >
        {pending ? "Working…" : children}
      </Button>
      {note && <span role={note.ok ? "status" : "alert"} className={`text-micro ${note.ok ? "text-positive" : "text-danger"}`}>{note.text}</span>}
    </span>
  );
}
