"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/components/attempt";

type Row = { id: string; accountId: string; accountName: string; text: string; dueLabel: string; late: boolean; version: number };

// Tick what the other person should own while you are away; one press hands
// them over. Unticked, a follow-up stays yours.
export function HandOver({ rows, to, hand }: { rows: Row[]; to: { id: string; name: string }; hand: (items: Array<{ id: string; accountId: string; version: number }>, toUserId: string) => Promise<ActionResult & { moved?: number }> }) {
  const router = useRouter();
  const [dealt] = useState(rows);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // What was handed over stays on screen, marked, until the person asks for
  // the refreshed page: refreshing at once would empty this list (the rows
  // are no longer theirs) and take the confirmation with it.
  const [handed, setHanded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const n = picked.size;
  if (dealt.length === 0) return <p className="text-label text-ink-muted" data-testid="hand-over">No follow-up falls due by then.</p>;
  return (
    <div data-testid="hand-over">
      <ul className="divide-y divide-line">
        {dealt.map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-2.5">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-accent"
              checked={picked.has(r.id)}
              disabled={pending || handed.has(r.id)}
              aria-label={`Hand over ${r.text}`}
              onChange={(e) => setPicked((s) => { const next = new Set(s); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next; })}
            />
            <div className="min-w-0 flex-1">
              <p className="text-ink-strong [overflow-wrap:anywhere]">{r.text}</p>
              <p className="text-micro text-ink-muted">
                {r.accountName} · <span className={r.late ? "text-warning" : ""}>{r.late ? "was due" : "due"} {r.dueLabel}</span>
                {handed.has(r.id) && <span className="font-semibold text-positive"> · now {to.name}&apos;s</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={pending || n === 0}
          onClick={() =>
            start(async () => {
              try {
                const chosen = dealt.filter((x) => picked.has(x.id) && !handed.has(x.id));
                const r = await hand(chosen.map((x) => ({ id: x.id, accountId: x.accountId, version: x.version })), to.id);
                setNote(r.ok ? { ok: true, text: `${r.moved} handed to ${to.name}.` } : { ok: false, text: r.error });
                if (r.ok) {
                  setHanded((h) => new Set([...h, ...chosen.map((x) => x.id)]));
                  setPicked(new Set());
                } else router.refresh();
              } catch {
                setNote({ ok: false, text: "The request did not come back. Reload to see who owns what." });
              }
            })
          }
          data-testid="hand-over-submit"
        >
          {pending ? "Handing over…" : `Hand ${n} to ${to.name}`}
        </Button>
        {note && <span role={note.ok ? "status" : "alert"} className={`text-label ${note.ok ? "text-positive" : "text-danger"}`}>{note.text}</span>}
        {handed.size > 0 && <Button variant="ghost" size="sm" onClick={() => router.refresh()}>Show the updated list</Button>}
      </div>
    </div>
  );
}
