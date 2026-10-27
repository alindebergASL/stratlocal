"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { TOPICS, TOPIC_LABELS, type FindingRead, type ResearchFinding, type Topic } from "@/lib/research/schema";
import { rankChanges } from "@/lib/research/rank";
import { Button, Eyebrow } from "@/components/ui";
import { FindingRow } from "@/components/FindingList";
import { ResearchReportView } from "@/components/ResearchReportView";

export type NoteView = {
  id: string;
  title: string;
  summary: string;
  prose: string;
  sources: string[];
  findings: ResearchFinding[];
  openQuestions: string[];
  generatedAt: string;
  accountName?: string | string[];
  /** The run's read of each finding, by index: event, trigger, fit. */
  reads?: Record<string, FindingRead>;
  today?: string;
  focus: string | null;
  depth: string;
  dropped: string[];
  acceptedIndexes?: number[];
  /** Account watch wrote it: what touches a play starts ticked, the rest unticked. */
  fromWatch?: boolean;
  /** Per finding index, the plays it shares words with, and the words. */
  touches?: Record<number, Array<{ playId: string; playTitle: string; words: string[] }>>;
};

export function NoteReview({ note, coverage }: { note: NoteView; coverage?: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Kept findings are tracked by position. The checkbox used to be keyed on
  // the URL, so two findings citing the same page shared one tick: unticking
  // either dropped both.
  const [keep, setKeep] = useState<Set<number>>(
    new Set(note.acceptedIndexes ?? note.findings.map((_, i) => i).filter((i) => !note.fromWatch || (note.touches?.[i]?.length ?? 0) > 0)),
  );
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` because they are different claims: one is the
  // server refusing and saying why, the other is not knowing what the server
  // did. The selection is untouched by either.
  const [unknown, setUnknown] = useState<string | null>(null);

  // Grouped by *index*, not by finding, because the tick state is keyed on a
  // finding's original position — two findings citing the same page once
  // shared one checkbox, and unticking either dropped both. Reordering for
  // display must not put that back.
  const grouped = TOPICS.map((topic) => ({
    topic: topic as Topic,
    rows: note.findings.flatMap((f, i) => (f.topic === topic ? [i] : [])),
  })).filter((g) => g.rows.length > 0);

  function toggle(i: number) {
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function send(action: "accept" | "discard") {
    setError(null);
    setUnknown(null);
    const uncertain = (why: string) =>
      setUnknown(
        `${why} Whether this ${action === "accept" ? "selection was saved" : "note was discarded"} is not known from here, and it may have been. Your ticks below are as you left them. Saving is locked until you reload this page and see what the server has.`,
      );
    start(async () => {
      let res: Response;
      try {
        res = await fetch(`/api/research-notes/${note.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action === "accept" ? { action, keep: [...keep] } : { action }),
        });
      } catch {
        // There was no transport catch here at all: a dropped connection
        // rejected inside the transition and the screen said nothing, with
        // the save possibly having landed.
        uncertain("The reply never arrived.");
        return;
      }
      const body = (await res.json().catch(() => null)) as { status?: unknown; error?: unknown } | null;
      if (!res.ok) {
        const message = typeof body?.error === "string" ? body.error.trim() : "";
        // A 5xx or a gateway giving up can follow a save the server had
        // already committed, and a timeout says nothing either way. Only an
        // explained 4xx is the server refusing.
        if (res.status >= 500 || res.status === 408 || !message) {
          uncertain(`The server answered ${res.status} without saying what it did.`);
          return;
        }
        // A refusal the server explained: nothing was saved, and the
        // selection stays exactly as it is so it can be sent again.
        setError(`${message} Nothing was saved; your selection is unchanged. You can save it again.`);
        return;
      }
      // A 200 is not a save. `POST /api/research-notes/:id` answers with the
      // status it performed; an empty or unrecognised body is the same
      // not-knowing as a dropped reply, and must not clear or refresh
      // anything.
      if (body?.status !== (action === "accept" ? "accepted" : "discarded")) {
        uncertain("The server answered without an outcome this screen can read.");
        return;
      }
      router.refresh();
    });
  }

  const allIndexes = note.findings.map((_, i) => i);
  // Locked while the last save's outcome is unknown: sending the same save
  // again is how a possibly-saved note gets saved twice, and the ticks are
  // kept exactly so nothing is lost by waiting for the reload.
  const actions = (acceptId: string) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="positive" data-testid={acceptId} onClick={() => send("accept")} disabled={pending || !!unknown} aria-busy={pending}>
        {pending ? "Saving…" : unknown ? "Locked until checked" : `${note.acceptedIndexes ? "Save selections:" : "Accept"} ${keep.size} of ${note.findings.length}`}
      </Button>
      <Button variant="quiet" data-testid={acceptId === "note-accept" ? "note-discard" : "note-discard-top"} onClick={() => send("discard")} disabled={pending || !!unknown}>
        Discard the note
      </Button>
    </span>
  );

  return (
    <div className="">
      {/* One honest line, where there were three disclaimers stacked above
          the first finding. */}
      <p className="mb-3 text-label text-ink" data-testid="review-intro">
        {note.acceptedIndexes ? (
          <>Change what this note keeps. Saving updates future briefs and suggestions; it does not undo records already applied.</>
        ) : (
          <>
            <strong className="text-ink-strong">New from this run: {note.findings.length} finding{note.findings.length === 1 ? "" : "s"}.</strong> Keep the ones that are right and untick anything wrong or stale. Keeping a finding is not verifying it: each one&rsquo;s source and excerpt are under it.
          </>
        )}
      </p>
      <h3 className="font-display text-heading font-bold tracking-tight text-ink-strong">{note.title}</h3>
      <p className="mt-1 text-micro text-ink-muted">
        {note.generatedAt} · {note.depth === "deep" ? "thorough" : "quick"}
        {note.focus ? ` · asked: ${note.focus}` : ""}
      </p>
      {!note.acceptedIndexes && <p className="mt-2 whitespace-pre-wrap text-ink">{note.summary}</p>}
      {coverage && <div className="mt-2">{coverage}</div>}

      {note.fromWatch && <WatchChanges note={note} />}

      {/* Everything starts ticked, which is the right default — a note is
          reviewed by dropping what is wrong, not by re-picking what is right —
          but it left a fifty-finding note with fifty individual unticks and no
          count of where you had got to. Neither control saves anything: what
          is ticked here reaches the server only when Save is pressed, and
          keeping a finding is not verifying it. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface-sunk px-3 py-2" data-testid="review-bar">
        <span data-testid="selection-count" className="text-label font-semibold text-ink">
          {keep.size} of {note.findings.length} finding{note.findings.length === 1 ? "" : "s"} selected
        </span>
        <Button
          variant="quiet"
          size="sm"
          data-testid="select-all"
          disabled={pending || keep.size === note.findings.length}
          onClick={() => setKeep(new Set(allIndexes))}
        >
          Select all
        </Button>
        <Button variant="quiet" size="sm" data-testid="clear-selection" disabled={pending || keep.size === 0} onClick={() => setKeep(new Set())}>
          Clear selection
        </Button>
        <span className="text-micro text-ink-muted">Nothing is saved until you press {note.acceptedIndexes ? "Save selections" : "Accept"}.</span>
        <span className="basis-full sm:basis-auto sm:ml-auto">{actions("note-accept-top")}</span>
      </div>

      {/* Grouped by topic, in the same fixed order the note is read in
          afterwards. This was the one research surface that listed findings
          flat in model order, so the screen where you decide read differently
          from the screen where you read — fifty unbroken rows with a topic
          pill on each, rather than the seven headings the dossier has. */}
      <div className="mt-4 space-y-4">
        {grouped.map(({ topic, rows }) => (
          <div key={topic}>
            <Eyebrow className="mb-1">
              {TOPIC_LABELS[topic]} · {rows.filter((i) => keep.has(i)).length} of {rows.length} kept
            </Eyebrow>
            <ul className="space-y-2">
              {rows.map((i) => {
                const f = note.findings[i]!;
                return (
                  <li key={i} className={`flex items-start gap-3 rounded-lg border border-line p-3 ${keep.has(i) ? "" : "opacity-50"}`}>
                    <input
                      type="checkbox"
                      data-testid="keep-finding"
                      checked={keep.has(i)}
                      onChange={() => toggle(i)}
                      // While a save is in flight the selection it carries
                      // must not move under it.
                      disabled={pending}
                      aria-label={`Keep: ${f.text.slice(0, 80)}`}
                      className="mt-1 size-4 shrink-0 accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      {note.fromWatch && (
                        <p className="mb-1 flex flex-wrap gap-1.5 text-micro" data-testid="finding-touch">
                          {(note.touches?.[i] ?? []).length > 0 ? (
                            note.touches![i]!.map((t) => (
                              <span key={t.playId} className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent" title={`Shares: ${t.words.join(", ")}`}>
                                Touches {t.playTitle} · {t.words.join(", ")}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-ink-muted">Not about any play</span>
                          )}
                        </p>
                      )}
                      <ReadChips read={note.reads?.[String(i)]} />
                      <FindingRow finding={f} accountName={note.accountName} today={note.today} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {!note.acceptedIndexes && note.openQuestions.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Still open</Eyebrow>
          <ul className="mt-1 list-disc pl-5 text-ink">
            {note.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {note.dropped.length > 0 && (
        <details className="mt-4 rounded-lg border border-line bg-surface-sunk p-3">
          <summary className="cursor-pointer text-micro font-semibold text-ink-muted hover:text-ink">
            {note.dropped.length} claim{note.dropped.length === 1 ? "" : "s"} dropped before you saw them
          </summary>
          <ul className="mt-2 list-disc pl-5 text-micro text-ink-muted">
            {note.dropped.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <p role="alert" className="mt-3 font-medium text-danger">
          {error}
        </p>
      )}
      {unknown && (
        <div role="alert" data-testid="note-unknown-outcome" className="mt-3 rounded-lg border border-warning-line bg-warning-soft/60 p-2.5 text-label text-ink">
          <p>
            <span className="font-semibold">Outcome unknown.</span> {unknown}
          </p>
          <div className="mt-2">
            {/* A real reload of the page. `router.refresh()` leaves this
                component — and the uncertainty it is holding — mounted, so it
                could never settle the question it was offered for. */}
            <Button variant="quiet" size="sm" data-testid="note-reload" onClick={() => window.location.reload()}>
              Reload the page and check what was saved
            </Button>
          </div>
        </div>
      )}
      {/* Only while this is a draft: the model's whole report, after the
          findings it was cut into rather than before them. Re-reviewing an
          accepted note happens inside that note's block, which already
          carries the report. */}
      {!note.acceptedIndexes && <ResearchReportView text={note.prose} sources={note.sources} />}
      {/* At the top beside the count, and again at the end. This used to be
          one bar stuck to the bottom of the screen, where it sat over the
          first finding on a desktop and over the title on a phone. */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        {actions("note-accept")}
        <span className="text-micro text-ink-muted">
          {unknown ? "Reload the page above before saving or discarding again." : "Discarding archives it; you can bring it back below."}
        </span>
      </div>
    </div>
  );
}

// The run's read of a finding, shown where it is decided on: whether it is a
// reason to act and which focus area it touches. The model's, and labelled
// in the brief as such.
function ReadChips({ read }: { read?: FindingRead }) {
  if (!read || (!read.signal && read.fits.length === 0)) return null;
  return (
    <p className="mb-1 flex flex-wrap gap-1.5 text-micro" data-testid="finding-read">
      {read.signal && (
        <span className="rounded bg-warning-soft px-1.5 py-px font-semibold text-warning ring-1 ring-warning-line">{read.signal === "compelling_event" ? "Compelling event" : "Trigger"}</span>
      )}
      {read.fits.map((a) => (
        <span key={a} className="rounded bg-accent-soft px-1.5 py-px font-semibold text-ink">{a}</span>
      ))}
    </p>
  );
}

// What Account watch found, as a difference worth reading rather than a fresh
// note: the items that matter, most important first, each with why.
function WatchChanges({ note }: { note: NoteView }) {
  const ranked = rankChanges(note.findings, note.reads, note.touches, note.today ?? new Date().toISOString().slice(0, 10)).slice(0, 5);
  return (
    <div className="mt-4 rounded-lg border border-line p-3" data-testid="watch-changes">
      <p className="text-label font-semibold text-ink-strong">What changed, most important first</p>
      {ranked.length === 0 ? (
        <p className="mt-1 text-label text-ink-muted">Nothing new is a reason to act or touches a play; what is below is background.</p>
      ) : (
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-label text-ink">
          {ranked.map((r) => (
            <li key={r.index}>
              {note.findings[r.index]!.text} <span className="text-micro text-ink-muted">({r.reasons.join("; ")})</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
