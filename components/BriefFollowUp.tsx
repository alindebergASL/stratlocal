"use client";

// The one step between "the brief suggests this" and "we are doing this".
//
// It is deliberately not the ordinary follow-up form with the text typed in
// for you. That form writes a row that looks like something a person wrote
// down; this one carries the brief's origin and its evidence onto the record,
// and asks for the two things a model must not decide — who owns it and when
// it is due — with no default for either.
import { useId, useRef, useState, useTransition } from "react";
import { Button, control, Field } from "./ui";
import { BriefFollowUpCheck, BriefFollowUpReply, type BriefFollowUpRecord } from "@/lib/meetings/briefFollowUpOutcome";

export type BriefFollowUpEvidence = { label: string; status: "current" | "missing" | "kind_mismatch"; reason: string | null; asOf: string | null };

export function BriefFollowUp({
  action,
  suggestion: currentSuggestion,
  fingerprint: currentFingerprint,
  meetingId,
  owners,
  evidence: currentEvidence,
  needsAck: currentNeedsAck,
  disabledReason,
}: {
  action: (fd: FormData) => Promise<unknown>;
  suggestion: string;
  fingerprint: string;
  meetingId: string;
  owners: Array<{ id: string; name: string }>;
  evidence: BriefFollowUpEvidence[];
  /** The evidence includes a report excerpt nobody has checked against its source. */
  needsAck: boolean;
  disabledReason?: string | null;
}) {
  // An open form reviews one stored brief. An RSC refresh must not silently
  // replace its basis or make recovery check a different brief version.
  const [basis, setBasis] = useState({ suggestion: currentSuggestion, fingerprint: currentFingerprint, evidence: currentEvidence, needsAck: currentNeedsAck });
  const { suggestion, fingerprint, evidence, needsAck } = basis;
  const [unknownDate, setUnknownDate] = useState(false);
  const [open, setOpen] = useState(false);
  type Phase = "ready" | "saving" | "unknown" | "checking" | "absent" | "saved";
  const [phase, setPhase] = useState<Phase>("ready");
  const gate = useRef<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ record: BriefFollowUpRecord; already: boolean } | null>(null);
  const [, start] = useTransition();
  const panelId = useId();
  const locked = phase !== "ready";

  function move(next: Phase) {
    gate.current = next;
    setPhase(next);
  }

  function submit(fd: FormData) {
    if (gate.current !== "ready" || disabledReason) return;
    move("saving");
    setError(null);
    // Keep onSubmit (not a form action): React must not reset uncontrolled
    // fields on refusal or an unknown outcome. Only a validated reply counts.
    start(async () => {
      try {
        const parsed = BriefFollowUpReply.safeParse(await action(fd));
        if (!parsed.success) { move("unknown"); return; }
        if (!parsed.data.ok) {
          setError(parsed.data.error);
          move("ready");
        } else {
          setSaved({ record: parsed.data.record, already: parsed.data.status === "already" });
          move("saved");
        }
      } catch {
        move("unknown");
      }
    });
  }

  async function recheck() {
    if (gate.current !== "unknown" && gate.current !== "absent") return;
    move("checking");
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/brief-follow-up?fingerprint=${encodeURIComponent(fingerprint)}`, {
        method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      });
      if (!response.ok) throw new Error("Recheck failed");
      const parsed = BriefFollowUpCheck.safeParse(await response.json());
      if (!parsed.success || parsed.data.fingerprint !== fingerprint) throw new Error("Unrecognized outcome");
      if (parsed.data.status === "found") {
        setSaved({ record: parsed.data.record, already: true });
        move("saved");
      } else {
        move("absent");
      }
    } catch {
      setError("The outcome could not be checked. Keep this form open and check again.");
      move("unknown");
    }
  }

  if (!open && disabledReason) return <p className="text-label text-ink-muted" data-testid="brief-follow-up-stale">{disabledReason}</p>;
  if (!open) return <Button variant="quiet" onClick={() => {
    if (gate.current === "ready") setBasis({ suggestion: currentSuggestion, fingerprint: currentFingerprint, evidence: currentEvidence, needsAck: currentNeedsAck });
    setOpen(true);
  }} aria-expanded={false} aria-controls={panelId} data-testid="brief-follow-up-open">Make this a follow-up</Button>;
  return (
    <form
      id={panelId}
      data-testid="brief-follow-up"
      onSubmit={(e) => { e.preventDefault(); if (gate.current === "ready") submit(new FormData(e.currentTarget)); }}
      className="animate-rise mt-3 space-y-3 rounded-lg border border-line bg-surface-sunk p-3"
    >
      {disabledReason && <p className="text-label text-ink-muted" data-testid="brief-follow-up-stale">{disabledReason} Your input is retained below.</p>}
      <fieldset disabled={locked || !!disabledReason} className="space-y-3">
      <input type="hidden" name="brief_fingerprint" value={fingerprint} />
      <p className="text-micro text-ink-muted">
        This is the brief&rsquo;s suggestion, written by the model. Nothing is recorded until you press Create, and what is recorded says it came from the brief.
      </p>
      <Field label="What we will do" hint="Edit it into your own words if it is not quite right." wide>
        <textarea name="text" defaultValue={suggestion} rows={3} required maxLength={1000} className={control} data-testid="brief-follow-up-text" />
      </Field>
      <Field label="Owner" hint="Nobody is assigned by the brief. Pick one of us, or say it is undecided.">
        <select name="owner_choice" required defaultValue="" className={control} data-testid="brief-follow-up-owner">
          <option value="" disabled>
            choose
          </option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="unassigned">Nobody yet — undecided</option>
        </select>
      </Field>
      <Field label="Due" hint="A date you have agreed, or say there is not one yet.">
        <input type="date" name="due" disabled={unknownDate} className={control} data-testid="brief-follow-up-due" />
      </Field>
      <label className="flex items-center gap-1.5 text-label">
        <input type="checkbox" name="due_unknown" checked={unknownDate} onChange={(e) => setUnknownDate(e.target.checked)} className="size-4 accent-accent" data-testid="brief-follow-up-no-date" />
        No date agreed yet
      </label>
      <div className="basis-full">
        <p className="text-micro font-medium text-ink-muted">What this will cite</p>
        {evidence.length === 0 ? (
          <p className="text-micro text-ink-muted" data-testid="brief-follow-up-evidence-none">
            The brief cites no record for this next step. The follow-up will record that it came from the brief, and nothing more.
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {evidence.map((e, i) => (
              <li key={i} className="text-micro text-ink-muted" data-testid="brief-follow-up-evidence">
                {e.status === "current" ? `${e.label}${e.asOf ? ` (${e.asOf})` : ""}` : (e.reason ?? "evidence unavailable")}
              </li>
            ))}
          </ul>
        )}
      </div>
      {needsAck && (
        <label className="flex basis-full items-start gap-1.5 text-micro text-ink-muted" data-testid="brief-follow-up-ack-row">
          <input type="checkbox" name="ack_evidence" className="mt-0.5 size-4 accent-accent" data-testid="brief-follow-up-ack" />
          One of the sources behind this is an excerpt from the generated report, not a quotation from the page. I have read the source.
        </label>
      )}
      </fieldset>
      {error && <p role="alert" className="text-micro text-danger">{error}</p>}
      {(phase === "unknown" || phase === "checking" || phase === "absent") && (
        <div role="status" data-testid="brief-follow-up-unknown" className="space-y-2 text-label text-ink-muted">
          <p>The save outcome is unknown. It may have been saved. Your input is retained; do not create another follow-up until it is checked.</p>
          <Button variant="quiet" disabled={phase === "checking"} onClick={recheck} data-testid="brief-follow-up-recheck">
            {phase === "checking" ? "Checking…" : "Check saved outcome"}
          </Button>
          {phase === "absent" && <div className="space-y-2">
            <p>No saved follow-up was found for this brief. Review your retained input before choosing to retry.</p>
            <Button variant="quiet" onClick={() => { if (gate.current === "absent") move("ready"); }} data-testid="brief-follow-up-review-retry">Review input for retry</Button>
          </div>}
        </div>
      )}
      {saved && <div role="status" data-testid="brief-follow-up-saved" className="text-label text-ink">
        <p>{saved.already ? "An existing follow-up was found. Later edits in this form were not saved." : "Follow-up created."}</p>
        <p data-testid="brief-follow-up-record">{saved.record.text}</p>
        {/* The server names the owner. An id with no name behind it — a login
            since removed — is "one of you", never the raw id. */}
        <p>Owner: {saved.record.owner ?? (saved.record.ownerUserId ? "one of you" : "no owner yet")} · Due: {saved.record.due ?? "no date yet"}</p>
        {saved.record.archivedAt && <p>Archived on {saved.record.archivedAt}. No new follow-up was created.</p>}
      </div>}
      <div className="flex gap-2">
        <Button type="submit" disabled={locked || !!disabledReason} aria-busy={phase === "saving"} data-testid="brief-follow-up-submit">{phase === "saving" ? "Saving…" : "Create follow-up"}</Button>
        <Button variant="quiet" disabled={locked} onClick={() => { if (gate.current === "ready") { setOpen(false); setUnknownDate(false); setError(null); } }}>Cancel</Button>
      </div>
    </form>
  );
}
