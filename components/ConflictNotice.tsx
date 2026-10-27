"use client";

// The second save, refused, explained.
//
// Two people share these accounts and every form was last-writer-wins: press
// Save on a page opened before your partner's edit and their work went, with
// "Saved" on screen in green. The write path now refuses that — but only a
// refusal that says what it is protecting is worth having, so this renders
// what the other person put there and offers the override rather than leaving
// you stuck holding text you typed.
//
// The tone matches the conflict card on a proposal, because it is the same
// event: a change made against a picture of the record that has moved.
import { fmtWhen } from "@/lib/format";
import { Button } from "./ui";
import type { Conflict } from "./attempt";

export function ConflictNotice({
  conflict,
  onOverride,
  overrideLabel = "Save anyway",
  busy,
  explanation,
  details,
  children,
}: {
  conflict: Conflict;
  onOverride: () => void;
  overrideLabel?: string;
  busy?: boolean;
  explanation?: React.ReactNode;
  details?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const one = conflict.changes.length === 1;
  return (
    <div role="alert" className="basis-full rounded-lg border border-warning-line bg-warning-soft/50 p-3">
      <p className="text-label font-semibold text-ink-strong">
        Not saved — {one ? "this was" : "these were"} changed while you had this open.
      </p>
      <ul className="mt-2 space-y-1.5">
        {conflict.changes.map((c) => (
          <li key={c.field} className="text-label">
            <span className="font-medium text-ink">{c.label}</span>
            <span className="ml-2 text-ink">{c.theirs}</span>
            <span className="ml-2 text-micro text-ink-muted">
              — {c.actor}, {fmtWhen(c.atMs)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-micro text-ink-muted">
        {explanation ?? <>Nothing you typed has been lost. Keep theirs by cancelling, or overwrite {one ? "it" : "them"} with what is in the form.</>}
      </p>
      {details}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button variant="danger" onClick={onOverride} disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : overrideLabel}
        </Button>
        {children}
      </div>
    </div>
  );
}
