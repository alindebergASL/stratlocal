"use client";
import Link from "next/link";
import { Button, ButtonLink, Callout } from "@/components/ui";
import { useAiRun } from "@/components/useAiRun";
import type { InitialRun } from "@/lib/ai/runState";
import type { WithheldSuggestion } from "@/lib/research/updates";

// What a finished run says it did.
//
// Everything past `batchId` is optional on purpose: a run stored before this
// existed has only the first four fields in its `result_json`, and reopening
// that account must not print "0 suggestions withheld" over a number nobody
// recorded. An older result is read as what it is — a count of proposals — and
// says nothing about the rest.
type Result = {
  proposals: number;
  included: number;
  omitted: number;
  batchId: string;
  suggestions?: number;
  unchanged?: number;
  withheld?: WithheldSuggestion[];
};

// The failures that are decided before a batch can exist: the account gate,
// the selection gate, the schema/evidence checks on the model's answer and the
// re-read that catches evidence moving underneath it. Everything else — and
// anything unrecognised — is an outcome this screen does not know.
const PRE_WRITE_FAILURES = [
  /supplied evidence_id/i,
  /unknown evidence id/i,
  /supporting evidence changed during generation/i,
  /no retained research evidence/i,
  /account missing or archived/i,
  /already await review/i,
  /daily .*cap|budget/i,
];
export function preWriteFailure(error: string | null | undefined): boolean {
  return !!error && PRE_WRITE_FAILURES.some((r) => r.test(error));
}

// What the suggestions lean towards, which the page used to ask for in a box.
const FOCUS = "people technology strategy";

export function ResearchUpdates({
  accountId,
  disabledReason,
  initialRun,
  included,
  total,
  pending = 0,
}: {
  accountId: string;
  disabledReason?: string | null;
  initialRun?: InitialRun<Result> | null;
  included: number;
  total: number;
  /** Proposals from research actually waiting for a decision, right now. */
  pending?: number;
}) {
  const { start, state, error, busy } = useAiRun<Result>(initialRun);
  const result = state?.status === "done" ? state.result : null;
  const withheld = result?.withheld ?? [];
  const detailed = !!result && result.suggestions !== undefined;
  return (
    <div className="space-y-3" data-testid="research-updates">
      {/* Pending work, counted on the server from the proposal rows, and from
          nothing else. This used to fall back to the last run's `proposals`
          when the server count was zero — so an account whose suggestions had
          all been accepted or rejected went on offering "Review 2 pending
          suggestions", and the queue it led to was empty. The run result is a
          record of what one attempt prepared, not of what is left. When a run
          finishes, `useAiRun` refreshes the route and this number arrives with
          it. */}
      {pending > 0 ? (
        <ButtonLink href={`/inbox?kind=changes&account=${accountId}`} variant="quiet" size="sm" testId="research-updates-review">
          Review {pending} pending suggestion{pending === 1 ? "" : "s"} →
        </ButtonLink>
      ) : null}
      {/* One line on what it does and what it reads. There was a free-text
          "Focus" box here, prefilled with three words that nobody changed,
          and a selection count written as an audit line. */}
      <p data-testid="research-updates-what">
        Suggest people, account facts and follow-ups from {included === total ? `all ${total}` : `${included} of ${total}`} kept findings. You accept each one.
      </p>
      {/* Preparing suggestions and reviewing them are two acts, and this button
          used to be labelled with the second one — so pressing "Review
          suggested account updates" spent money on a model call. */}
      <Button
        onClick={() => void start(`/api/accounts/${accountId}/research-updates`, { focus: FOCUS })}
        disabled={!!disabledReason || busy}
        aria-busy={busy}
        data-testid="research-updates-run"
      >
        {busy ? "Preparing suggestions…" : "Prepare suggestions"}
      </Button>
      {disabledReason && <p className="text-micro text-ink-muted">{disabledReason}</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {state?.status === "running" && <p role="status">Reading saved evidence. Progress survives a page reload.</p>}
      {state?.status === "failed" && (
        <Callout tone="warning" testId="research-updates-failed">
          <p role="alert" className="font-semibold text-danger">
            {state.error}
          </p>
          {/* What can honestly be said depends on which failure it was. A
              refusal raised while checking the model's answer happens before
              anything is proposed, so "no new batch" is a fact. Any other
              error — a crash, a lost connection, something unrecognised —
              stopped at an unknown point, and this used to tell everybody that
              nothing had been written. The run itself, its cost and its usage
              are recorded either way. */}
          {preWriteFailure(state.error) ? (
            <p className="mt-1">
              No new batch of suggestions was created: the answer was refused before anything was proposed. No account record changed. Read the retained findings above to check the
              evidence this would have used, then prepare suggestions again.
            </p>
          ) : (
            <p className="mt-1">
              How far this attempt got is not established here. No account record is changed by preparing suggestions — applying is a separate decision — but whether a batch of
              suggestions was created is not something this message can tell you. Check the pending suggestions above before preparing again. The run, its cost and its usage were
              recorded.
            </p>
          )}
        </Callout>
      )}
      {result && (
        <div role="status" data-testid="research-updates-result" className="space-y-2">
          {/* What the last preparation did, which is history the moment it is
              stored. It is not the state of the review queue: accept or reject
              those two suggestions and this paragraph still says two were
              prepared, because two were. What is waiting now is the line at the
              top, counted on the server. */}
          <p className="text-micro font-medium uppercase tracking-[0.06em] text-ink-muted">Last preparation on this account</p>
          <p>
            {result.proposals > 0
              ? `${result.proposals} suggestion${result.proposals === 1 ? "" : "s"} prepared for review`
              : detailed && result.suggestions === 0
                ? "The model found nothing to suggest from this evidence"
                : detailed && withheld.length > 0 && withheld.length === result.suggestions
                  ? "Nothing was proposed: every suggestion was withheld"
                  : "Nothing new to review: what the model suggested is already on file or already proposed"}
            {detailed && (result.unchanged ?? 0) > 0 ? ` · ${result.unchanged} changed nothing on file` : ""}
            {detailed && withheld.length > 0 ? ` · ${withheld.length} withheld` : ""}.
          </p>
          <p className="text-micro text-ink-muted">
            Read from {result.included} retained finding{result.included === 1 ? "" : "s"}; {result.omitted} omitted from this extraction — omitted from the selection this run
            read, not removed from the research.
          </p>
          {withheld.length > 0 && (
            <ul className="space-y-2" data-testid="research-withheld">
              {withheld.map((w, i) => (
                <li key={`${w.evidenceId}-${i}`} className="rounded-lg border border-line bg-surface-sunk p-3 text-label">
                  <p className="font-semibold text-ink-strong">Withheld · {w.what}</p>
                  <p className="text-ink-muted">{w.reason}</p>
                  <p className="mt-1">{w.next}</p>
                  {/* The evidence it cited, so the sentence can be read rather
                      than guessed at. A suggestion whose evidence id we cannot
                      resolve to a note says so instead of linking nowhere. */}
                  {w.noteId ? (
                    // The finding, not the note: this used to open the note's
                    // re-review checklist and leave you to find the sentence
                    // among fifty. `finding=` is the stored index, so the link
                    // still means this finding after a re-review — and says so
                    // honestly if the note no longer keeps it.
                    <Link
                      href={
                        w.findingIndex !== null
                          ? `/accounts/${accountId}/research?note=${w.noteId}&finding=${w.findingIndex}#finding-${w.noteId}-${w.findingIndex}`
                          : `/accounts/${accountId}/research?read=${w.noteId}#research-${w.noteId}`
                      }
                      className="text-micro font-semibold text-accent hover:underline"
                    >
                      Open the cited finding →
                    </Link>
                  ) : (
                    <span className="text-micro text-ink-muted">Cited evidence {w.evidenceId}, which is no longer in the selection.</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
