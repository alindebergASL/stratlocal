"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: true; message?: string } | { ok: false; error: string };

// One checklist item: ticks on change, says who and when once done, and
// says why when the tick did not take.
export function CheckItem({ label, done, detail, toggle }: { label: string; done: boolean; detail: string | null; toggle: (done: boolean) => Promise<Result> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li>
      <label className="flex min-h-9 cursor-pointer items-start gap-2.5 py-1" data-testid="playbook-check">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-accent"
          checked={done}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            start(async () => {
              try {
                const r = await toggle(next);
                setError(r.ok ? null : r.error);
                if (r.ok) router.refresh();
              } catch {
                setError("The request did not come back. Reload to see what happened.");
              }
            });
          }}
        />
        <span className="min-w-0">
          <span className={`text-body ${done ? "text-ink-muted line-through decoration-ink-muted/50" : "text-ink"}`}>{label}</span>
          {detail && <span className="block text-micro text-ink-muted">{detail}</span>}
          {error && <span role="alert" className="block text-micro text-danger">{error}</span>}
        </span>
      </label>
    </li>
  );
}
