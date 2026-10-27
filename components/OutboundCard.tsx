"use client";

import { useState, useTransition } from "react";
import type { OutboundDraft, Recipient } from "@/lib/outbound/drafts";
import { Button } from "./ui";

type Result = { ok: true; message?: string } | { ok: false; error: string };

export type OutboundActions = {
  send: (id: string) => Promise<Result>;
  save: (id: string, patch: { to: Recipient[]; subject: string; body: string; startsAt?: string | null; minutes?: number | null }) => Promise<Result>;
  discard: (id: string) => Promise<Result>;
  reopen: (id: string) => Promise<Result>;
};

const field = "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-label text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// One draft, exactly as it will go (DECISIONS #103): who it is to, the
// subject and every word, all editable. Send is a button and only a button.
export function OutboundCard({ draft, actions, sendingOn }: { draft: OutboundDraft; actions: OutboundActions; sendingOn: boolean }) {
  const [to, setTo] = useState<Recipient[]>(draft.to);
  const [typed, setTyped] = useState("");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [startsAt, setStartsAt] = useState(draft.startsAt ?? "");
  const [minutes, setMinutes] = useState(draft.minutes ?? 30);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const open = draft.status === "draft" || draft.status === "failed";
  const changed = subject !== draft.subject || body !== draft.body || JSON.stringify(to) !== JSON.stringify(draft.to) || (draft.kind === "invite" && (startsAt !== (draft.startsAt ?? "") || minutes !== (draft.minutes ?? 30)));

  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      try {
        const r = await fn();
        setNote(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      } catch {
        setNote({ ok: false, text: "The request did not come back. Reload to see what happened." });
      }
    });
  const patch = () => ({ to, subject, body, ...(draft.kind === "invite" ? { startsAt, minutes } : {}) });

  return (
    <article className="rounded-xl border border-line bg-surface p-4" data-testid="outbound-card" data-status={draft.status}>
      <p className="text-micro font-semibold uppercase tracking-[0.08em] text-accent">{draft.kind === "invite" ? "Calendar invite" : "Email"} · from your mailbox</p>
      {!open ? (
        <div className="mt-2 text-label">
          <p className="font-semibold text-ink-strong">{draft.subject}</p>
          <p className="text-ink-muted">To {draft.to.map((r) => r.name ?? r.email).join(", ")}</p>
          {draft.status === "sent" && <p className="mt-1 text-positive" data-testid="outbound-sent">{draft.kind === "invite" ? "Invite sent" : "Sent"}{draft.sentAt ? ` ${new Date(draft.sentAt).toLocaleString()}` : ""}.</p>}
          {draft.status === "sending" && <p className="mt-1 text-ink-muted">Sending…</p>}
          {draft.status === "unknown" && (
            <div className="mt-1 text-warning" role="status" data-testid="outbound-unknown">
              <p>Whether this went is not known ({draft.error}). Check your Sent folder before sending it again.</p>
              <Button size="sm" variant="quiet" className="mt-2" disabled={pending} onClick={() => run(() => actions.reopen(draft.id))}>It did not go: make it a draft again</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <span className="text-micro text-ink-muted">To</span>
            <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="outbound-to">
              {to.map((r) => (
                <li key={r.email} className="inline-flex items-center gap-1 rounded-full bg-surface-sunk px-2.5 py-1 text-micro text-ink">
                  {r.name ? `${r.name} · ${r.email}` : r.email}
                  <button type="button" aria-label={`Remove ${r.email}`} className="ml-0.5 text-ink-muted hover:text-danger" onClick={() => setTo((t) => t.filter((x) => x.email !== r.email))}>×</button>
                </li>
              ))}
              <li>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && typed.trim()) {
                      e.preventDefault();
                      setTo((t) => [...t, { email: typed.trim(), name: null, contactId: null, typed: true }]);
                      setTyped("");
                    }
                  }}
                  placeholder="Add an address, Enter"
                  className="min-h-8 rounded-full border border-line px-3 text-micro"
                  data-testid="outbound-add"
                />
              </li>
            </ul>
          </div>
          <label className="block">
            <span className="text-micro text-ink-muted">{draft.kind === "invite" ? "Title" : "Subject"}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${field} mt-1`} data-testid="outbound-subject" />
          </label>
          {draft.kind === "invite" && (
            <div className="flex flex-wrap gap-3">
              <label className="block">
                <span className="text-micro text-ink-muted">Starts</span>
                <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={`${field} mt-1`} data-testid="outbound-starts" />
              </label>
              <label className="block">
                <span className="text-micro text-ink-muted">Minutes</span>
                <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${field} mt-1`}>
                  {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-micro text-ink-muted">{draft.kind === "invite" ? "Description" : "Message"}</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(4, body.split("\n").length + 1))} className={`${field} mt-1 font-[inherit]`} data-testid="outbound-body" />
          </label>
          {draft.status === "failed" && draft.error && <p className="text-label text-danger" role="alert">It did not go: {draft.error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={pending || !sendingOn || to.length === 0}
              onClick={() => run(async () => {
                if (changed) {
                  const saved = await actions.save(draft.id, patch());
                  if (!saved.ok) return saved;
                }
                return actions.send(draft.id);
              })}
              data-testid="outbound-send"
            >
              {pending ? "Working…" : draft.kind === "invite" ? "Send invite" : "Send"}
            </Button>
            {changed && <Button variant="quiet" disabled={pending} onClick={() => run(() => actions.save(draft.id, patch()))} data-testid="outbound-save">Save</Button>}
            <Button variant="ghost" disabled={pending} onClick={() => run(() => actions.discard(draft.id))} data-testid="outbound-discard">Discard</Button>
            {!sendingOn && <span className="text-micro text-ink-muted">Turn on sending under Settings → Connections.</span>}
          </div>
        </div>
      )}
      {note && <p role={note.ok ? "status" : "alert"} className={`mt-2 text-label ${note.ok ? "text-positive" : "text-danger"}`} data-testid="outbound-note">{note.text}</p>}
    </article>
  );
}
