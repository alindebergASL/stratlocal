"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/kit/Toaster";
import { acceptQuickAction, snoozeAction, undoAcceptAction, wakeAction } from "./actions";

// "Accept N quick", with Undo in the toast that follows.
export function QuickAccept({ accountId, count }: { accountId: string; count: number }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="quiet"
        size="sm"
        disabled={pending}
        data-testid="inbox-accept-quick"
        onClick={() =>
          start(async () => {
            try {
              const r = await acceptQuickAction(accountId);
              if (!r.ok) return setError(r.error);
              setError(null);
              toast({ text: r.message, tone: "positive", undo: r.ids.length ? () => undoAcceptAction(r.ids) : undefined });
            } catch {
              setError("The request did not come back. Reload to see what happened.");
            }
          })
        }
      >
        {pending ? "Working…" : `Accept ${count} quick`}
      </Button>
      {error && <span role="alert" className="text-micro text-danger">{error}</span>}
    </span>
  );
}

// Put an item off until tomorrow or next Monday. It leaves the Inbox and the
// count, for you only, and comes back on the day.
export function Snooze({ itemKey, tomorrow, nextWeek }: { itemKey: string; tomorrow: string; nextWeek: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const put = (day: string, label: string) =>
    start(async () => {
      const r = await snoozeAction(itemKey, day);
      if (r.ok) toast({ text: `Back ${label}`, undo: () => wakeAction(itemKey) });
    });
  return (
    <details className="relative" data-testid="inbox-snooze">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2.5 text-label text-ink-muted hover:bg-surface-sunk hover:text-ink sm:min-h-9 [&::-webkit-details-marker]:hidden">Later</summary>
      <span className="absolute right-0 z-10 mt-1 flex w-40 flex-col rounded-xl border border-line bg-surface p-1 shadow-raised">
        <button type="button" disabled={pending} onClick={() => put(tomorrow, "tomorrow")} className="rounded-lg px-3 py-2 text-left text-label hover:bg-surface-sunk" data-testid="inbox-snooze-tomorrow">Tomorrow</button>
        <button type="button" disabled={pending} onClick={() => put(nextWeek, "next week")} className="rounded-lg px-3 py-2 text-left text-label hover:bg-surface-sunk" data-testid="inbox-snooze-week">Next week</button>
      </span>
    </details>
  );
}

export function Wake({ itemKey }: { itemKey: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => void (await wakeAction(itemKey)))} className="text-label font-semibold text-accent hover:underline" data-testid="inbox-wake">
      Bring back
    </button>
  );
}

// j and k move between Inbox rows, Enter opens the focused one, a accepts its
// quick changes and s puts it off until tomorrow. Never while typing.
export function InboxKeys() {
  useEffect(() => {
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-inbox-row]"));
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector('[role="dialog"]')) return;
      const all = rows();
      if (!all.length) return;
      const at = all.findIndex((r) => r.contains(document.activeElement));
      const row = at >= 0 ? all[at]! : null;
      if (e.key === "j" || e.key === "k") {
        const next = all[Math.max(0, Math.min(all.length - 1, at < 0 ? 0 : at + (e.key === "j" ? 1 : -1)))]!;
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      } else if (e.key === "a" && row) row.querySelector<HTMLElement>('[data-testid="inbox-accept-quick"]')?.click();
      else if (e.key === "s" && row) row.querySelector<HTMLElement>('[data-testid="inbox-snooze-tomorrow"]')?.click();
      else if (e.key === "Enter" && row && row === document.activeElement) row.querySelector<HTMLElement>("[data-inbox-open]")?.click();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return null;
}
