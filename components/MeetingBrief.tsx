import Link from "next/link";
import type { Claim, MeetingBrief as Brief } from "@/lib/meetings/briefSchema";
import { BRIEF_SECTIONS } from "@/lib/meetings/briefSchema";
import { briefEntryGaps, conversationView, readingMinutes, type FactView } from "@/lib/meetings/briefView";
import { refKey, type BriefRefMap } from "@/lib/meetings/briefEvidence";
import { Chip, Eyebrow } from "./ui";

export type { BriefRefMap };

// One citation, said as what it is now rather than as what it was when the
// brief was written. A ref that no longer resolves is printed and explained,
// never dropped: a sentence that quietly loses its evidence reads exactly like
// one that never needed any.
function Ref({ refs, map }: { refs: Array<{ kind: string; id: string }>; map: BriefRefMap }) {
  if (refs.length === 0) return null;
  return (
    <span className="ml-1 text-micro">
      {refs.map((r, i) => {
        const entry = map.get(refKey(r));
        return (
          <span key={`${r.kind}-${r.id}-${i}`}>
            {i > 0 && <span className="text-ink-muted">, </span>}
            {entry?.status === "current" && entry.href ? (
              <Link href={entry.href} className="text-accent hover:underline" data-testid="brief-ref">
                {entry.label}
                {entry.asOf ? <span className="tabular-nums"> ({entry.asOf})</span> : null}
              </Link>
            ) : (
              <span className="text-ink-muted" data-testid="brief-ref-unavailable">
                {entry?.reason ?? "evidence unavailable: this citation no longer resolves"}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function Facts({ facts, map, testId }: { facts: FactView[]; map: BriefRefMap; testId: string }) {
  return (
    <ul className="space-y-2">
      {facts.map((f, i) => (
        <li key={i} className="text-ink" data-testid={testId}>
          {f.text}
          <Ref refs={f.refs} map={map} />
        </li>
      ))}
    </ul>
  );
}

function Claims({ claims, map }: { claims: Claim[]; map: BriefRefMap }) {
  return <Facts facts={claims.map((c) => ({ text: c.text, refs: c.source_refs }))} map={map} testId="brief-detail-claim" />;
}

/** How long the conversation view takes to read, said to the person about to read it. */
export function briefSubtitle(brief: Brief): string {
  const minutes = readingMinutes(conversationView(brief));
  return `For meeting attendees · about ${minutes} minute${minutes === 1 ? "" : "s"} to read`;
}

// This is read in a car park on a phone ten minutes before a call. What it
// leads with is what you would want somebody to tell you on the way in: why
// you are going, the few things that are true, what you are guessing, what to
// ask, and the one thing to land. Everything the brief also says is real and
// is kept — one disclosure below, read-only, in full.
export function MeetingBriefView({ brief, map, nextStepRefs = [] }: { brief: Brief; map: BriefRefMap; nextStepRefs?: Array<{ kind: string; id: string }> }) {
  const view = conversationView(brief);
  const next = view.nextStep;
  const gaps = briefEntryGaps(view);
  const sparse = gaps.length >= 3;
  return (
    <div className="space-y-5" data-testid="brief-conversation">
      {sparse && <p className="rounded-lg border border-line bg-surface-sunk p-3 text-label text-ink-muted" data-testid="brief-gap-summary">Not recorded in this brief: {gaps.join(", ")}. These gaps remain unresolved; the full brief and evidence are below.</p>}
      {(!sparse || view.purpose) && <section>
        <Eyebrow className="mb-1">Why this meeting</Eyebrow>
        <p className="text-ink" data-testid="brief-purpose">
          {view.purpose ?? "Purpose not recorded in this brief."}
        </p>
      </section>}

      {(!sparse || view.facts.length > 0) && <section>
        <Eyebrow className="mb-2">What matters</Eyebrow>
        {view.facts.length === 0 ? (
          <p className="text-ink-muted" data-testid="brief-facts-empty">
            No cited facts recorded in this brief.
          </p>
        ) : (
          <div data-testid="brief-facts">
            <Facts facts={view.facts} map={map} testId="brief-fact" />
            {view.factsSelected && (
              <p className="mt-1.5 text-micro text-ink-muted" data-testid="brief-facts-selected">
                Selected from the full brief.
              </p>
            )}
          </div>
        )}
      </section>}

      {view.hypothesis ? (
        <section className="rounded-lg border border-line bg-surface-sunk p-3.5" data-testid="brief-hypothesis">
          <Chip tone="warning">Hypothesis — not established</Chip>
          <p className="mt-1.5 text-ink">{view.hypothesis.text}</p>
          <p className="mt-1 text-label text-ink-muted" data-testid="brief-hypothesis-unknown">
            Unknown: {view.hypothesis.unknown}
          </p>
          <Ref refs={view.hypothesis.refs} map={map} />
        </section>
      ) : sparse ? null : (
        <p className="text-label text-ink-muted" data-testid="brief-hypothesis-none">
          No hypothesis recorded.
        </p>
      )}

      {(!sparse || view.questions.length > 0) && <section>
        <Eyebrow className="mb-2">What to ask</Eyebrow>
        {view.questions.length === 0 ? (
          <p className="text-ink-muted" data-testid="brief-questions-empty">
            No questions recorded.
          </p>
        ) : (
          <ol className="list-decimal space-y-2 pl-5" data-testid="brief-questions">
            {view.questions.map((q, i) => (
              <li key={i} className="text-ink" data-testid="brief-question">
                {q.text}
                <Ref refs={q.refs} map={map} />
              </li>
            ))}
          </ol>
        )}
      </section>}

      {(!sparse || view.connection) && <section data-testid="brief-connection">
        <Eyebrow className="mb-1">Deal or play this touches</Eyebrow>
        {view.connection ? (
          <p className="text-ink" data-testid="brief-connection-supported">
            {view.connection.text}
            <Ref refs={view.connection.refs} map={map} />
          </p>
        ) : (
          <p className="text-ink-muted" data-testid="brief-connection-none">
            Connection to an existing deal or play is not established in the records.
          </p>
        )}
      </section>}

      <div className="rounded-lg border border-accent-line bg-accent-soft p-4" data-testid="brief-next-step">
        <Eyebrow className="text-accent">Land on this</Eyebrow>
        <p className="mt-1.5 font-display text-heading font-bold tracking-tight text-ink-strong">{next.action}</p>
        <p className="mt-1.5 text-ink">{next.concern}</p>
        <Ref refs={nextStepRefs} map={map} />
        {/* The model does not get to decide who owns this or when it is due, so
            the brief says plainly that neither is settled rather than printing
            a name and a date that nobody agreed to. */}
        <p className="mt-2 text-micro text-ink-muted" data-testid="brief-next-step-meta">
          {next.owner ? `suggested owner ${next.owner} — not assigned` : "no owner agreed yet"} ·{" "}
          {next.target_date ? `suggested date ${next.target_date} — not agreed` : "no date agreed yet"}
          {next.blocker ? ` · blocked by ${next.blocker}` : ""}
        </p>
      </div>

      {view.uncertainty ? (
        <p className="text-label text-ink-muted" data-testid="brief-uncertainty">
          Least certain here: {view.uncertainty}
        </p>
      ) : sparse ? null : (
        <p className="text-label text-ink-muted" data-testid="brief-uncertainty-none">
          No uncertainty note recorded.
        </p>
      )}

      {/* Everything the brief says, kept whole and read-only. Nothing above
          replaces this; it is the same brief, with the conversation on top. */}
      <details className="border-t border-line pt-3" data-testid="brief-details">
        <summary className="cursor-pointer text-label font-semibold text-ink-muted hover:text-ink">Full brief &amp; evidence</summary>
        <div className="mt-3 space-y-5">
          {brief.attendees.length > 0 && (
            <section data-testid="brief-attendees">
              <Eyebrow className="mb-2">Who is in the room</Eyebrow>
              <ul className="space-y-3">
                {brief.attendees.map((a, i) => (
                  <li key={i}>
                    <span className="font-semibold text-ink-strong">{a.name}</span>
                    {a.role_note && <span className="text-ink-muted"> · {a.role_note}</span>}
                    <Ref refs={a.source_refs} map={map} />
                    {a.last_position && <div className="text-ink">Last time: {a.last_position}</div>}
                    {a.cares_about && <div className="text-ink">Cares about: {a.cares_about}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {BRIEF_SECTIONS.map(({ key, label }) =>
            brief[key].length === 0 ? null : (
              <section key={key} data-testid={`brief-section-${key}`}>
                <Eyebrow className="mb-2">{label}</Eyebrow>
                <Claims claims={brief[key]} map={map} />
              </section>
            ),
          )}

          <section data-testid="brief-sources">
            <Eyebrow className="mb-2">Sources cited</Eyebrow>
            {map.size === 0 ? (
              <p className="text-label text-ink-muted">This brief cites no record.</p>
            ) : (
              <ul className="space-y-1.5">
                {[...map.values()].map((entry) => (
                  <li key={refKey(entry.requested)} className="text-label" data-testid="brief-source">
                    {entry.status === "current" && entry.href ? (
                      <Link href={entry.href} className="text-accent hover:underline">
                        {entry.label}
                      </Link>
                    ) : (
                      <span className="text-ink-muted">{entry.label}</span>
                    )}
                    <span className="ml-1.5 text-micro tabular-nums text-ink-muted">
                      {entry.requested.kind.replace(/_/g, " ")}
                      {entry.asOf ? ` · ${entry.asOf}` : entry.status === "current" ? " · no date recorded" : ""}
                      {entry.verification === "report_excerpt" ? " · unverified report excerpt" : ""}
                    </span>
                    {entry.reason && <span className="ml-1.5 text-micro text-ink-muted">{entry.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}
