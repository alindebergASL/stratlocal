"use client";
import { useState, useTransition } from "react";
import { createNextStepFollowUp } from "@/app/commitmentActions";
import { useRefreshHold } from "./AccountFreshness";
import { attempt } from "./attempt";
import { Button, controlSm } from "./ui";
export function NextStepCommitment({ accountId, kind, sourceId, suggestion, basis, due, owners }: {
  accountId: string; kind: "deal" | "play"; sourceId: string; suggestion: string; basis: string; due: string | null; owners: { id: string; name: string }[];
}) {
  const [draft, setDraft] = useState<{ basis: string; text: string; due: string | null } | null>(null);
  const [noDate, setNoDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  useRefreshHold(`commitment-${sourceId}`, draft ? "A follow-up confirmation is part-written here." : null);
  if (!draft) return <Button size="sm" variant="quiet" onClick={() => { setError(null); setNoDate(false); setDraft({ basis, text: suggestion, due }); }}>Create a follow-up</Button>;
  return <form className="mt-3 flex min-w-0 flex-wrap gap-3 rounded-lg border border-line p-3" onSubmit={(event) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget);
    start(async () => { const result = await attempt(() => createNextStepFollowUp(accountId, kind, sourceId, fd)); if (result.ok) setDraft(null); else setError(result.error); });
  }}>
    <input type="hidden" name="basis" value={draft.basis} />
    <label className="basis-full min-w-0">Follow-up text<textarea name="text" required maxLength={4000} defaultValue={draft.text} className={controlSm} rows={3} /></label>
    <label>Assignee<select name="assignee" required defaultValue="" className={controlSm}><option value="" disabled>Choose assignee</option><option value="unassigned">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    <label>Due date<input type="date" name="due" disabled={noDate} required={!noDate} defaultValue={draft.due ?? ""} className={controlSm} /></label>
    <label className="flex items-center gap-2"><input type="checkbox" name="no_date" checked={noDate} onChange={(e) => setNoDate(e.target.checked)} />No date yet</label>
    <p className="basis-full text-micro text-ink-muted">Only confirming creates work. Planning text is unchanged; assignee is independent of account ownership.</p>
    {error && <p role="alert" className="basis-full text-danger">{error}</p>}
    <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Confirm follow-up"}</Button>
    <Button type="button" variant="quiet" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
  </form>;
}
