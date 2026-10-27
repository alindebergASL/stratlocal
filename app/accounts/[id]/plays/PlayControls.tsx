"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { movePlayAction, setPlayKindAction } from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string };

// A play's rank and kind controls, kept small on purpose: the Plan tab has a
// weight budget (e2e/weight.mjs), and four full buttons on every row spent it.
// The actions are imported here rather than bound per row on the server, and
// "Info only" and "Not applicable" wait behind ⋯ until asked for.
const BTN = "min-h-8 min-w-8 rounded-sm px-2 py-1 text-micro font-semibold text-ink-muted hover:bg-surface-sunk hover:text-ink disabled:opacity-50";

export function PlayControls({ accountId, playId, live }: { accountId: string; playId: string; live: boolean }) {
  const router = useRouter();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) => () =>
    start(async () => {
      try {
        const r = await fn();
        setError(r.ok ? null : r.error);
        if (r.ok) router.refresh();
      } catch {
        setError("The request did not come back. Reload to see what happened.");
      }
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      {live ? (
        <>
          <button type="button" className={BTN} disabled={pending} onClick={run(() => movePlayAction(accountId, playId, -1))} aria-label="Move up" data-testid="play-up">↑</button>
          <button type="button" className={BTN} disabled={pending} onClick={run(() => movePlayAction(accountId, playId, 1))} aria-label="Move down" data-testid="play-down">↓</button>
          {more ? (
            <>
              <button type="button" className={BTN} disabled={pending} onClick={run(() => setPlayKindAction(accountId, playId, "info_only"))} data-testid="play-info-only">Info only</button>
              <button type="button" className={BTN} disabled={pending} onClick={run(() => setPlayKindAction(accountId, playId, "not_applicable"))} data-testid="play-not-applicable">Not applicable</button>
            </>
          ) : (
            <button type="button" className={BTN} onClick={() => setMore(true)} aria-label="More" data-testid="play-more">⋯</button>
          )}
        </>
      ) : (
        <button type="button" className={BTN} disabled={pending} onClick={run(() => setPlayKindAction(accountId, playId, "active"))} data-testid="play-reactivate">Make it live</button>
      )}
      {error && <span role="alert" className="text-micro text-danger">{error}</span>}
    </span>
  );
}
