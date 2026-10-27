"use client";

import { useState, useTransition } from "react";

const CHOICES: Array<{ days: number; label: string }> = [
  { days: 0, label: "Not watched" },
  { days: 1, label: "Daily" },
  { days: 3, label: "Every 3 days" },
  { days: 7, label: "Weekly" },
  { days: 14, label: "Every 2 weeks" },
];

// How often Account watch looks for news about this account (DECISIONS #100).
// Each look is research on the Assistants page's budget.
export function WatchPace({ pace, save }: { pace: number | null; save: (days: number) => Promise<{ ok: true; message?: string } | { ok: false; error: string }> }) {
  const [value, setValue] = useState(pace ?? 0);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className="flex flex-wrap items-center gap-2 text-label text-ink" data-testid="watch-pace">
      <span className="text-ink-muted">News watch</span>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const days = Number(e.target.value);
          const before = value;
          setValue(days);
          start(async () => {
            const r = await save(days).catch(() => ({ ok: false as const, error: "The request did not come back." }));
            if (!r.ok) setValue(before);
            setNote(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
          });
        }}
        className="min-h-9 rounded-md border border-line-strong bg-surface px-2 text-label text-ink focus-visible:outline-2 focus-visible:outline-accent"
        data-testid="watch-pace-select"
      >
        {CHOICES.map((c) => (
          <option key={c.days} value={c.days}>{c.label}</option>
        ))}
      </select>
      {note && <span role={note.ok ? "status" : "alert"} className={`text-micro ${note.ok ? "text-positive" : "text-danger"}`}>{note.text}</span>}
    </label>
  );
}
