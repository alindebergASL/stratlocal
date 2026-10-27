"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { archiveRecord, saveActionItem, setActionItemStatus } from "@/app/actions";
import { attempt, type ActionResult } from "@/components/attempt";
import { Button, control } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { BacklogItem } from "@/lib/queries/attention";

type Item = BacklogItem & { dueLabel: string; lateDays: number };
type Pick = { label: string; day: string; shown: string };
type Outcome = "done" | "dated" | "dropped" | "skipped";

const OUTCOME_WORD: Record<Exclude<Outcome, "skipped">, string> = { done: "done", dated: "given a new date", dropped: "let go" };

// One follow-up, one decision, next. Each decision is the same server action
// the rest of the app uses for it, so it lands in history like any other edit;
// this screen only changes the order in which you meet them.
export function SortSession({ items, total, today, picks, backHref }: { items: Item[]; total: number; today: string; picks: Pick[]; backHref: string }) {
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [dating, setDating] = useState(false);
  const [day, setDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const item = items[index];
  const count = (o: Outcome) => outcomes.filter((x) => x === o).length;

  function next(outcome: Outcome) {
    setOutcomes((o) => [...o, outcome]);
    setIndex((i) => i + 1);
    setDating(false);
    setDay("");
    setError(null);
  }

  function run(outcome: Exclude<Outcome, "skipped">, action: () => Promise<ActionResult>) {
    start(async () => {
      const result = await attempt(action);
      if (result.ok) next(outcome);
      else setError(result.error);
    });
  }

  // One key per decision, the way a triage queue should feel. Only while the
  // four buttons are on screen and nothing is being typed: a date field owns
  // its keys, and a modifier means the browser's shortcut, not ours.
  const keys = useRef<Record<string, () => void>>({});
  keys.current = item && !dating && !pending
    ? {
        d: () => run("done", () => setActionItemStatus(item.accountId, item.id, "done")),
        n: () => { setDating(true); setError(null); },
        l: () => run("dropped", () => archiveRecord("action_item", item.id)),
        s: () => next("skipped"),
      }
    : {};
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const act = keys.current[e.key.toLowerCase()];
      if (act) { e.preventDefault(); act(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!item) {
    const parts = (["done", "dated", "dropped"] as const).filter((o) => count(o) > 0).map((o) => `${count(o)} ${OUTCOME_WORD[o]}`);
    const remaining = total - items.length;
    return (
      <section className="animate-card-in rounded-3xl border border-line bg-surface p-8 text-center shadow-raised sm:p-10" data-testid="sort-finished">
        <svg aria-hidden viewBox="0 0 52 52" className="draw-check mx-auto size-16 text-positive">
          <circle cx="26" cy="26" r="24" className="fill-positive-soft stroke-positive-line" strokeWidth="2" />
          <path d="M15 27l7 7 15-16" className="fill-none stroke-current" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h1 className="mt-5 font-display text-title font-extrabold tracking-tight text-ink-strong sm:text-display">{items.length === 0 ? "Nothing to sort." : "Sorted."}</h1>
        <p className="mt-2 text-lead text-ink">
          {items.length === 0 ? "No follow-up is more than a week past due in this scope." : parts.length > 0 ? `${parts.join(", ")}.` : "You skipped them all, which is a decision too."}
        </p>
        {remaining > 0 && <p className="mt-2 text-label text-ink-muted">{remaining} more are waiting. Reload this page to carry on.</p>}
        <Link href={backHref} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-white shadow-raised transition hover:-translate-y-px hover:bg-accent-hover">Back to Today<Icon name="arrow" /></Link>
      </section>
    );
  }

  const position = index + 1;
  const tally: Array<[string, number, string]> = [
    ["done", count("done"), "text-positive"],
    ["new date", count("dated"), "text-accent"],
    ["let go", count("dropped"), "text-ink-muted"],
  ];
  return (
    <section aria-labelledby="sort-title" data-testid="sort-session">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 id="sort-title" className="font-display text-title font-extrabold tracking-tight text-ink-strong sm:text-display">Sort the backlog</h1>
          <p className="mt-1 text-label text-ink-muted" aria-live="polite">
            <span className="font-semibold text-ink">{position}</span> of {items.length}{total > items.length ? ` (the oldest ${items.length} of ${total})` : ""}
          </p>
        </div>
        <p className="flex gap-4 text-label text-ink-muted" aria-label="So far">
          {tally.map(([label, n, tone]) => <span key={label}><span className={`font-display text-heading font-bold tabular-nums ${n > 0 ? tone : "text-ink-faint"}`}>{n}</span> {label}</span>)}
        </p>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-sunk" aria-hidden>
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-positive transition-[width] duration-500 ease-out" style={{ width: `${(index / items.length) * 100}%` }} />
      </div>

      <article className="animate-card-in mt-6 rounded-3xl border border-line bg-surface p-6 shadow-raised sm:p-8" data-testid="sort-card" key={item.id}>
        <p className="flex items-center gap-1.5 text-label text-ink-muted"><Icon name="accounts" className="size-4" />{item.accountName}{item.promisedBy ? ` · ${item.promisedBy} promised this` : item.owner ? ` · ${item.owner}` : ""}</p>
        <h2 className="mt-2 font-display text-heading font-bold text-ink-strong [overflow-wrap:anywhere] sm:text-title">{item.text}</h2>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-label font-medium text-warning ring-1 ring-warning-line"><Icon name="clock" className="size-3.5" />Due {item.dueLabel} · {item.lateDays} days late</p>

        {!dating ? (
          <div className="mt-7 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap [&>button]:whitespace-nowrap sm:[&>button]:flex-1">
            <Button className="min-h-12 rounded-xl" disabled={pending} onClick={() => keys.current.d?.()} data-testid="sort-done"><Icon name="check" />Done<Kbd>D</Kbd></Button>
            <Button className="min-h-12 rounded-xl" variant="quiet" disabled={pending} onClick={() => keys.current.n?.()} data-testid="sort-date"><Icon name="calendar" />New date<Kbd>N</Kbd></Button>
            <Button className="min-h-12 rounded-xl" variant="quiet" disabled={pending} onClick={() => keys.current.l?.()} data-testid="sort-drop">Let go<Kbd>L</Kbd></Button>
            <Button className="min-h-12 rounded-xl" variant="ghost" disabled={pending} onClick={() => keys.current.s?.()} data-testid="sort-skip">Skip<Kbd>S</Kbd></Button>
          </div>
        ) : (
          <form
            className="animate-rise mt-7 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!day || day <= today) { setError("Pick a day after today."); return; }
              const fd = new FormData();
              // Only the fields this card shows: the title as it is and the
              // new date. The version makes a stale card a refusal, not an
              // overwrite of something the other person just changed.
              fd.set("text", item.text);
              fd.set("due", day);
              fd.set("base_version", String(item.version));
              run("dated", () => saveActionItem(item.accountId, item.id, fd));
            }}
          >
            <div className="flex flex-wrap gap-2">
              {picks.map((p) => (
                <Button key={p.day} variant={day === p.day ? "primary" : "quiet"} className="rounded-xl" onClick={() => setDay(p.day)}>
                  {p.label} <span className="font-normal opacity-75">{p.shown}</span>
                </Button>
              ))}
            </div>
            <label className="flex flex-wrap items-center gap-3 text-label text-ink-muted">
              Or a day
              <input type="date" value={day} min={today} onChange={(e) => setDay(e.target.value)} className={`${control} max-w-48`} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11 rounded-xl" disabled={pending || !day} data-testid="sort-date-save">Save the date</Button>
              <Button variant="ghost" className="min-h-11 rounded-xl" disabled={pending} onClick={() => { setDating(false); setDay(""); setError(null); }}>Back</Button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="mt-4 text-label text-danger">{error}</p>}
      </article>
      <p className="mt-4 text-micro text-ink-muted">Let go archives it: gone from every list, history kept, and it can be restored from its account.</p>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd aria-hidden className="ml-1 hidden rounded border border-current px-1 font-sans text-[0.7rem] leading-4 opacity-50 sm:inline">{children}</kbd>;
}
