"use client";

// Notes and extraction in one control. It used to be two buttons: Save
// notes, then Extract — which was hard-disabled until the notes had made a
// round trip. One intent, one action, and the result appears under the
// button rather than in a section below an eighteen-row textarea.
import { useState, useTransition } from "react";
import { fmtCostNote } from "@/lib/format";
import { followThrough, type followUpGaps } from "@/lib/meetings/followThrough";
import { Button, control } from "./ui";
import { useAiRun } from "./useAiRun";
import { attempt, type ActionResult, type Conflict } from "./attempt";
import { ConflictNotice } from "./ConflictNotice";
import { useFreshnessAdoptions } from "./AccountFreshness";
import { Dictate, joinDictation } from "./Dictate";

type ExtractResult = { proposals?: number; dropped?: string[] };

export function NotesPanel({
  save,
  initial,
  version,
  extractUrl,
  disabledReason,
  hasPending,
  pendingCount = 0,
  followUps,
  readOnlyReason,
}: {
  save: (fd: FormData) => Promise<ActionResult>;
  initial: string;
  // The meeting as this page loaded it. Notes are the one collision history
  // cannot undo: raw_notes is a LARGE_FIELD, so change_log keeps "4.1 KB ->
  // 1.2 KB" and the column is the only copy of the text there has ever been.
  version: number | null;
  extractUrl: string;
  disabledReason?: string | null;
  hasPending: boolean;
  pendingCount?: number;
  followUps?: ReturnType<typeof followUpGaps>;
  readOnlyReason?: string | null;
}) {
  const [value, setValue] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // This panel stays mounted after a successful save, unlike every other form
  // in the app, so the `version` prop goes stale the moment you save once. The
  // action hands back the row's new version and we hold it — otherwise a
  // second save is refused against your own first one, and the notice names
  // you as the other person.
  const [known, setKnown] = useState<number | null>(null);
  // Client-side attempt association only: the server reads its current notes,
  // and the protocol does not return a version/hash proving which text it read.
  const [extracted, setExtracted] = useState<{ url: string; text: string; started: boolean } | null>(null);
  // The version this draft was written against, captured when the meeting
  // loaded. The `version` prop moves with every RSC refresh, so reading it at
  // save time would quietly measure a draft typed against one record against
  // whatever the record says now — which is not preservation, it is the
  // collision check signing its own permission slip.
  const [basisVersion, setBasisVersion] = useState(version);
  const [saving, startSave] = useTransition();
  const { start, state, error: runError, busy } = useAiRun<ExtractResult>();

  // `initial` used to be adopted as the new baseline on every re-render that
  // changed it. A refresh — and one now follows every accepted proposal —
  // could answer with the text from *before* our own save, and adopting that
  // marked saved notes as unsaved: the screen said "Unsaved changes" over
  // notes that were safely on disk, which is the one thing this panel must
  // never get wrong. Nothing in this app proposes a change to raw notes, so
  // there is no server text worth adopting mid-edit.
  //
  // What does have to be adopted is a different meeting: the route changes
  // under a reused component, and the notes must change with it. Updating
  // state during render on a changed prop is the documented way to do that.
  const [loadedFor, setLoadedFor] = useState(extractUrl);
  if (loadedFor !== extractUrl) {
    setLoadedFor(extractUrl);
    setValue(initial);
    setBaseline(initial);
    setKnown(null);
    setBasisVersion(version);
    setConflict(null);
    setError(null);
  }

  const dirty = value !== baseline;
  const tooShort = value.trim().length < 20;

  // An explicit Refresh, and only that, is allowed to bring in notes the other
  // person wrote. A draft is never replaced by it: what is typed here stays,
  // and so does the version it was typed against, so the save that follows is
  // still measured against the record this text was written on top of and is
  // still refused if that record moved.
  const adoptions = useFreshnessAdoptions();
  const [adopted, setAdopted] = useState(adoptions);
  if (adopted !== adoptions) {
    setAdopted(adoptions);
    // `known` outranks the prop: after a save of our own the server may still
    // be rendering the text from before it, and adopting that would mark
    // saved notes unsaved — the one thing this panel must never get wrong.
    if (!dirty && (known === null || (version !== null && version >= known))) {
      setValue(initial);
      setBaseline(initial);
      setKnown(null);
      setBasisVersion(version);
    }
  }

  // `keep` is how a refused save is resolved: "mine" overwrites, "both" asks
  // the server to put the two halves in one document under a line saying
  // whose is whose. Nobody should have to choose between ten minutes of their
  // typing and ten minutes of the other one's.
  async function saveOnly(keep?: "mine" | "both") {
    const fd = new FormData();
    fd.set("raw_notes", value);
    // On a retry the version goes up to date, because the question has been
    // asked and answered; on the first press it is what the page loaded with.
    const base = keep ? (conflict?.currentVersion ?? null) : (known ?? basisVersion);
    if (base !== null) fd.set("base_version", String(base));
    if (keep) fd.set("keep", keep);
    const r = await attempt(() => save(fd));
    if (!r.ok) {
      if (r.conflict) setConflict(r.conflict);
      else setError(r.error);
      return false;
    }
    setConflict(null);
    if (r.ok && r.version !== undefined) setKnown(r.version);
    // "Keep both" produced a document this panel is not holding, so the page
    // has to fetch it rather than pretend the textarea is current.
    if (keep === "both") window.location.reload();
    setBaseline(value);
    return true;
  }

  function keepTheirs() {
    const snapshot = conflict?.notes;
    if (!snapshot || saving || busy) return;
    // Explicitly discard only this notes draft. No server write, extraction,
    // page reload, or refreshed prop can silently rebase another edit.
    setValue(snapshot.text);
    setBaseline(snapshot.text);
    setKnown(snapshot.version);
    setBasisVersion(snapshot.version);
    setConflict(null);
    setError(null);
  }

  function saveAndExtract() {
    setError(null);
    setConflict(null);
    startSave(async () => {
      if (dirty && !(await saveOnly())) return;
      // Invalidate the previous result even when this start is rejected. The
      // shared hook intentionally retains its old terminal state in that case.
      setExtracted({ url: extractUrl, text: value, started: false });
      if (await start(extractUrl)) setExtracted({ url: extractUrl, text: value, started: true });
    });
  }

  const currentAttempt = extracted?.url === extractUrl && extracted.text === value;
  const currentRunError = currentAttempt ? runError : null;
  const failed = !!extracted?.started && state?.status === "failed";
  const result = currentAttempt && extracted?.started && !runError && state?.status === "done" ? state.result : null;
  // Presentation is scoped; locking below continues to use the real busy run.
  const next = followThrough({ dirty, saving, busy: busy && currentAttempt, conflict: !!conflict, error, runError: currentRunError, failed: currentAttempt && failed, hasNotes: value.trim().length > 0, tooShort, pending: pendingCount, gaps: followUps?.items ?? 0, disabledReason, readOnlyReason });
  const historicalFailure = extracted?.url === extractUrl && !currentAttempt && (runError || failed);

  const status: { text: string; tone: "bad" | "good" | "quiet" } | null = (() => {
    if (error) return { text: error, tone: "bad" as const };
    // The conflict block below says it at length; a second line would only
    // repeat it.
    if (conflict) return null;
    if (currentRunError) return { text: currentRunError, tone: "bad" as const };
    if (currentAttempt && failed) return { text: state?.error ?? "The run failed.", tone: "bad" as const };
    if (disabledReason) return { text: disabledReason, tone: "quiet" as const };
    // Progress is not repeated here: the button itself already reads
    // "Saving…" or "Reading the notes…" a few pixels to the left.
    if (saving || busy) return null;
    if (dirty) return value.length > 0 && tooShort ? { text: "A little more to work with first.", tone: "quiet" as const } : { text: "Unsaved changes", tone: "quiet" as const };
    if (result) {
      // The count is not repeated here: the heading on the list directly
      // below is the authoritative one, and the two disagreed the moment a
      // proposal was decided. What this line knows and that one does not is
      // what was thrown away and what it cost.
      const dropped = result.dropped?.length ?? 0;
      return {
        text: `Read${dropped > 0 ? `, ${dropped} claim${dropped === 1 ? "" : "s"} ignored for lacking support in the notes` : ""}${fmtCostNote(state?.cost_cents ?? null, state?.cost_estimated ?? null)}`,
        tone: "good" as const,
      };
    }
    if (value !== "") return { text: "Saved", tone: "good" as const };
    return null;
  })();

  return (
    <div className="flex flex-col gap-3">
      <div data-testid="post-meeting-status" className="border-l-2 border-line pl-3 text-label text-ink">
        <p aria-live="polite">{next.text}</p>
        <p className="mt-1 text-ink-muted">{pendingCount} proposed {pendingCount === 1 ? "change" : "changes"} awaiting explicit review · {followUps?.open ?? 0} recorded open {(followUps?.open ?? 0) === 1 ? "follow-up" : "follow-ups"}</p>
        {next.detail && <p className="text-ink-muted">{next.detail}</p>}
        {historicalFailure && <p className="text-ink-muted">An extraction attempt for earlier notes needs attention; these notes have changed.</p>}
        {!!followUps?.open && <p data-testid="follow-up-gaps" className="text-ink-muted">{followUps.items} {followUps.items === 1 ? "follow-up" : "follow-ups"} missing details ({followUps.owners} missing owner; {followUps.dates} missing date)</p>}
        <a data-testid="post-meeting-next" href={next.href} className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline">{next.label} →</a>
      </div>
      <textarea
        id="notes-editor"
        aria-label="Meeting notes"
        readOnly={!!readOnlyReason}
        name="raw_notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={12}
        placeholder="Paste your raw notes. Anything goes: fragments, who said what, numbers, what you promised."
        className={`${control} notes-editor min-h-56 p-3`}
      />
      <div id="notes-controls" tabIndex={-1} className="flex flex-wrap items-center gap-3">
        <Dictate onText={(said) => setValue((v) => joinDictation(v, said))} disabled={!!readOnlyReason || saving || busy} label="Dictate notes" testId="notes-dictate" />
        <Button onClick={saveAndExtract} disabled={saving || busy || tooShort || !!disabledReason || !!readOnlyReason} aria-busy={saving || busy} title={readOnlyReason ?? disabledReason ?? undefined}>
          {busy ? "Reading the notes…" : saving ? "Saving…" : hasPending ? "Save and extract again" : "Save and extract changes"}
        </Button>
        <Button
          variant="quiet"
          onClick={() =>
            startSave(async () => {
              setError(null);
              setConflict(null);
              await saveOnly();
            })
          }
          disabled={saving || busy || !dirty || !!readOnlyReason}
        >
          Save only
        </Button>
        {/* One status at a time, resolved by priority. These were eight
            independent conditions rendered side by side in the same span, so
            two true at once ran together as "Unsaved changes4 proposed
            changes below". A problem outranks progress, and progress outranks
            a result you have already read. */}
        <span role="status" aria-live="polite" className={`text-micro ${status ? "" : "hidden"}`}>
          <span className={status?.tone === "bad" ? "font-medium text-danger" : status?.tone === "good" ? "font-medium text-positive" : "text-ink-muted"}>
            {status?.text}
          </span>
        </span>
      </div>
      {conflict && (
        <ConflictNotice
          conflict={conflict}
          busy={saving || busy}
          overrideLabel="Keep mine"
          explanation="Your draft is still in the box. Keep theirs replaces your draft with the saved notes below, without changing the server. Keep mine overwrites their saved notes; Keep both combines them."
          details={
            <div className="mt-3 min-w-0 rounded-md border border-line bg-surface p-3">
              <p className="text-label font-semibold">Their saved notes</p>
              {conflict.notes ? (
                <div data-testid="notes-conflict-preview" className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-label">
                  {conflict.notes.text === "" ? <span className="text-ink-muted">No saved notes — they cleared the text.</span> : conflict.notes.text}
                </div>
              ) : (
                <p className="mt-2 text-label text-ink-muted">The notes changed again. Retry Save only to see the latest version before choosing.</p>
              )}
            </div>
          }
          onOverride={() => startSave(async () => void (await saveOnly("mine")))}
        >
          {/* The way out that does not make anyone pick. Only offered here,
              because this is the only field in the app whose old value is
              genuinely gone once it is overwritten. */}
          <Button variant="quiet" onClick={keepTheirs} disabled={saving || busy || !conflict.notes}>
            Keep theirs
          </Button>
          <Button variant="quiet" onClick={() => startSave(async () => void (await saveOnly("both")))} disabled={saving || busy}>
            Keep both
          </Button>
        </ConflictNotice>
      )}
    </div>
  );
}
