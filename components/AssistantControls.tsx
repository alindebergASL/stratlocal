"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attempt } from "./attempt";
import { Button, controlSm } from "./ui";
import { Icon } from "./icons";
import type { ActionResult } from "./attempt";
import type { AssistantMode } from "@/lib/assistants/registry";
import type { RunNowResult } from "@/app/assistants/actions";

const MODES: Array<{ mode: AssistantMode; label: string; hint: string }> = [
  { mode: "off", label: "Off", hint: "Never runs, and what it left is hidden." },
  { mode: "ask", label: "When I ask", hint: "Runs only when you press Run now." },
  { mode: "auto", label: "On its own", hint: "Runs on the clock and leaves what it found for you." },
];

// The three settings, the monthly limit, and Run now. A mode change saves at
// once, with the limit as it stands; the limit saves with its own button.
export function AssistantControls({
  id,
  name,
  mode,
  limitDollars,
  usesModel,
  save,
  runNow,
}: {
  id: string;
  name: string;
  mode: AssistantMode;
  limitDollars: string;
  usesModel: boolean;
  save: (fd: FormData) => Promise<ActionResult>;
  runNow: () => Promise<RunNowResult>;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(mode);
  const [limit, setLimit] = useState(limitDollars);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(nextMode: AssistantMode, nextLimit: string) {
    start(async () => {
      const fd = new FormData();
      fd.set("mode", nextMode);
      fd.set("limit", nextLimit);
      const r = await attempt(() => save(fd));
      if (r.ok) {
        setCurrent(nextMode);
        setMessage({ tone: "ok", text: "Saved." });
        router.refresh();
      } else setMessage({ tone: "error", text: r.error });
    });
  }

  function run() {
    start(async () => {
      try {
        const r = await runNow();
        setMessage(r.ok ? { tone: "ok", text: r.summary } : { tone: "error", text: r.error });
        if (r.ok) router.refresh();
      } catch {
        setMessage({ tone: "error", text: "The request did not come back. Check the run log below before pressing again." });
      }
    });
  }

  return (
    <div className="space-y-3" data-testid={`assistant-controls-${id}`}>
      <div role="radiogroup" aria-label={`${name}: when it runs`} className="grid grid-cols-3 gap-1 rounded-xl bg-surface-sunk p-1 text-label">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={current === m.mode}
            title={m.hint}
            disabled={pending}
            onClick={() => current !== m.mode && submit(m.mode, limit)}
            data-testid={`assistant-mode-${id}-${m.mode}`}
            className={`min-h-10 rounded-lg px-2 font-medium transition ${current === m.mode ? "bg-surface text-ink-strong shadow-card" : "text-ink-muted hover:text-ink"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-micro text-ink-muted">{MODES.find((m) => m.mode === current)!.hint}</p>
      <div className="flex flex-wrap items-end gap-2">
        {usesModel && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(current, limit);
            }}
          >
            <label className="text-micro text-ink-muted">
              Monthly limit
              <span className="mt-1 flex items-center gap-1">
                <span aria-hidden className="text-label text-ink">$</span>
                <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className={`${controlSm} max-w-24`} data-testid={`assistant-limit-${id}`} />
              </span>
            </label>
            <Button type="submit" size="sm" variant="quiet" disabled={pending || limit === limitDollars}>Save limit</Button>
          </form>
        )}
        <Button size="sm" variant="quiet" disabled={pending || current === "off"} onClick={run} className="ml-auto" data-testid={`assistant-run-${id}`}>
          <Icon name="sparkle" />{pending ? "Working…" : "Run now"}
        </Button>
      </div>
      {message && (
        <p role="status" className={`text-micro ${message.tone === "ok" ? "text-positive" : "text-danger"}`} data-testid={`assistant-message-${id}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
