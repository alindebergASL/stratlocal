"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, controlSm } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { CalendarResult } from "./actions";

export type AddRow = { id: string; title: string; when: string; accountName: string; reason: string | null; people: string };

// Everything matched, ticked by default; one tap adds them all. Untick what
// is not a meeting worth keeping, or say so for good with "Not a meeting".
export function AddMeetings({ rows, add, ignore }: { rows: AddRow[]; add: (ids: string[]) => Promise<CalendarResult>; ignore: (ids: string[]) => Promise<CalendarResult> }) {
  const router = useRouter();
  // Dealt once: adding refreshes the page, and the refreshed list must not
  // swap the confirmation out from under the person who just pressed Add.
  const [dealt, setDealt] = useState(rows);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<CalendarResult>, finish: boolean) =>
    start(async () => {
      try {
        const r = await action();
        if (r.ok && finish) setDone(r.message ?? "Added.");
        else setNote(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
        if (r.ok) router.refresh();
      } catch {
        setNote({ ok: false, text: "The request did not come back. Reload to see what was added." });
      }
    });
  // A read that brings the first events in: deal them (a guarded update during
  // render, React's way of deriving state from new props).
  if (dealt.length === 0 && !done && rows.length > 0) {
    setDealt(rows);
    setPicked(new Set(rows.map((r) => r.id)));
  }
  const n = picked.size;
  if (done) {
    return (
      <div className="animate-card-in flex flex-wrap items-center gap-3 rounded-2xl bg-positive-soft px-4 py-3 text-label text-positive ring-1 ring-positive-line" data-testid="calendar-added" role="status">
        <Icon name="check" className="size-4" />
        <span className="font-semibold">{done}</span>
        {rows.length > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setDealt(rows); setPicked(new Set(rows.map((r) => r.id))); setDone(null); setNote(null); }}>
            {rows.length} more to look at
          </Button>
        )}
      </div>
    );
  }
  if (dealt.length === 0) {
    return <p className="text-label text-ink-muted">Nothing new: every customer meeting is on file.</p>;
  }
  return (
    <div data-testid="calendar-add">
      <ul className="divide-y divide-line">
        {dealt.map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-3" data-testid="calendar-add-row">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-accent"
              checked={picked.has(r.id)}
              aria-label={`Add ${r.title}`}
              onChange={(e) => setPicked((s) => { const next = new Set(s); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next; })}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-strong [overflow-wrap:anywhere]">{r.title}</p>
              <p className="text-micro text-ink-muted">
                <span className="font-semibold text-accent">{r.accountName}</span> · {r.when}{r.reason ? ` · ${r.reason}` : ""}
              </p>
              {r.people && <p className="mt-0.5 truncate text-micro text-ink-muted">{r.people}</p>}
            </div>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => { setDealt((d) => d.filter((x) => x.id !== r.id)); setPicked((p) => { const next = new Set(p); next.delete(r.id); return next; }); run(() => ignore([r.id]), false); }} data-testid="calendar-ignore">Not a meeting</Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button className="min-h-11 rounded-xl px-5" disabled={pending || n === 0} onClick={() => run(() => add([...picked]), true)} data-testid="calendar-add-submit">
          <Icon name="calendar" />{pending ? "Adding…" : `Add ${n} meeting${n === 1 ? "" : "s"}`}
        </Button>
        {note && <span role={note.ok ? "status" : "alert"} className={`text-label ${note.ok ? "text-positive" : "text-danger"}`}>{note.text}</span>}
      </div>
    </div>
  );
}

export type QuestionRow = { id: string; title: string; when: string; reason: string | null; people: string; suggested: string[] };

export function WhichAccount({ row, accounts, add, ignore }: { row: QuestionRow; accounts: Array<{ id: string; name: string }>; add: (accountId: string) => Promise<CalendarResult>; ignore: () => Promise<CalendarResult> }) {
  const router = useRouter();
  const suggested = accounts.filter((a) => row.suggested.includes(a.id));
  const [account, setAccount] = useState(suggested[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<CalendarResult>) =>
    start(async () => {
      try {
        const r = await action();
        if (r.ok) router.refresh();
        else setError(r.error);
      } catch {
        setError("The request did not come back. Reload to see what happened.");
      }
    });
  return (
    <li className="py-3" data-testid="calendar-question">
      <p className="font-medium text-ink-strong [overflow-wrap:anywhere]">{row.title}</p>
      <p className="text-micro text-ink-muted">{row.when}{row.reason ? ` · ${row.reason}` : ""}</p>
      {row.people && <p className="mt-0.5 truncate text-micro text-ink-muted">{row.people}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={`${controlSm} min-w-0 max-w-64`} aria-label={`Account for ${row.title}`} data-testid="calendar-question-account">
          <option value="">Which account?</option>
          {suggested.length > 0 && (
            <optgroup label="Likely">
              {suggested.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </optgroup>
          )}
          <optgroup label="All accounts">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </optgroup>
        </select>
        <Button size="sm" disabled={pending || !account} onClick={() => run(() => add(account))} data-testid="calendar-question-add">Add meeting</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(ignore)} data-testid="calendar-question-ignore">Not a customer meeting</Button>
        {error && <span role="alert" className="text-micro text-danger">{error}</span>}
      </div>
    </li>
  );
}
