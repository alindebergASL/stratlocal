"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, controlSm } from "./ui";
import type { ActionResult } from "./attempt";

type Watched = { id: string; name: string; lastLook: string | null; draftWaiting: boolean; running: boolean };

// The accounts Account watch looks at. Each one is a weekly cost, so adding
// one is a choice someone makes here or on the account's research page.
export function WatchList({
  watched,
  accounts,
  estimate,
  setWatched,
}: {
  watched: Watched[];
  accounts: Array<{ id: string; name: string }>;
  estimate: string;
  setWatched: (accountId: string, on: boolean) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (id: string, on: boolean) =>
    start(async () => {
      try {
        const r = await setWatched(id, on);
        if (r.ok) {
          setPick("");
          setError(null);
          router.refresh();
        } else setError(r.error);
      } catch {
        setError("The request did not come back. Reload to see the list.");
      }
    });
  const unwatched = accounts.filter((a) => !watched.some((w) => w.id === a.id));
  return (
    <div className="space-y-2" data-testid="watch-list">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">Watching {watched.length === 0 ? "no accounts yet" : `${watched.length} account${watched.length === 1 ? "" : "s"}`}</p>
      {watched.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {watched.map((w) => (
            <li key={w.id} className="flex items-center gap-2 px-3 py-2 text-label" data-testid="watch-row">
              <div className="min-w-0 flex-1">
                <Link href={`/accounts/${w.id}/research`} className="block truncate font-medium text-ink-strong hover:underline">{w.name}</Link>
                <span className="flex flex-wrap items-center gap-1.5 text-micro text-ink-muted">
                  {w.lastLook ? `looked ${w.lastLook}` : "not looked at yet"}
                  {w.running ? <Chip tone="info">looking now</Chip> : w.draftWaiting ? <Chip tone="warning">note to review</Chip> : null}
                </span>
              </div>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(w.id, false)} aria-label={`Stop watching ${w.name}`}>Stop</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${controlSm} min-w-0 max-w-60`} aria-label="Account to watch" data-testid="watch-pick">
          <option value="">Add an account…</option>
          {unwatched.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <Button size="sm" variant="quiet" disabled={pending || !pick} onClick={() => run(pick, true)} data-testid="watch-add">Watch</Button>
      </div>
      <p className="text-micro text-ink-muted" data-testid="watch-estimate">{estimate}</p>
      {error && <p role="alert" className="text-micro text-danger">{error}</p>}
    </div>
  );
}
