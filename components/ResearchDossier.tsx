import Link from "next/link";
import { DOSSIER_TOPICS, type ResearchCoverage } from "@/lib/research/coverage";
import { TOPIC_LABELS, type ResearchFinding, type Topic } from "@/lib/research/schema";
import { previewByTopic, FindingRow } from "./FindingList";

// What we know about this account, by topic.
//
// The counts were already computed and already on screen: ResearchCoverageView
// printed "Technology: 9 findings" in a two-column list directly above a list
// of those nine findings, mixed in among forty others. So the number told you
// a topic was covered and then made you go and find it.
//
// Here the count is the card's own heading and the findings are inside it, in
// the fixed topic order every other research surface uses. A topic with
// nothing in it still gets a card, because "we have found nothing about their
// leadership" is the more useful half of coverage and it is the half a list of
// non-zero numbers cannot say.
//
// The finding itself stays a row, not a card. It is one sentence, a confidence
// pill and a source link; fifty bordered boxes is more chrome than content,
// and the review checklist is the one place that boxes each finding and is the
// heaviest surface in the app.
export function ResearchDossier({
  findings,
  coverage,
  max,
  moreHref,
  topicHref,
  anchorFor,
  reading = false,
  findingHref,
  accountName,
}: {
  accountName?: string | string[];
  reading?: boolean;
  findingHref?: (finding: ResearchFinding) => string;
  findings: ResearchFinding[];
  coverage: ResearchCoverage;
  max?: number;
  moreHref?: string;
  /** Where "View all N" goes for one topic. Falls back to `moreHref`, which is the whole dossier. */
  topicHref?: (topic: string) => string;
  /** The finding's own id on the page, so a link can land on the finding rather than near it. */
  anchorFor?: (finding: ResearchFinding) => string | undefined;
}) {
  const { rows: byTopic, shown, hidden } = previewByTopic(findings, max);
  // The seven dossier topics always, in their fixed order, then `other` only
  // when something landed in it — an empty "Other" card is a shrug, not an
  // answer.
  const topics: string[] = [...DOSSIER_TOPICS, ...(findings.some((f) => f.topic === "other") ? ["other"] : [])];
  return (
    <div className="mt-3" data-testid="research-dossier">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {reading ? <p className="text-label text-ink-muted">Showing {shown} of {findings.length} retained finding{findings.length === 1 ? "" : "s"}.</p> : <p className="text-label font-semibold">{coverage.status === "partial" ? "Partial account research" : "Broad topic coverage"}</p>}
        {hidden > 0 && moreHref && (
          <Link href={moreHref} className="text-label font-semibold text-accent hover:underline">
            {hidden} more finding{hidden === 1 ? "" : "s"} →
          </Link>
        )}
      </div>
      {/* Both numbers, from the whole set: what this preview is showing and
          what it is showing it out of. A grid of topic cards can otherwise
          look like the account's whole answer while being a quarter of it. */}
      {!reading && <p className="mt-1 text-micro text-ink-muted">
        Showing {shown} of {findings.length} retained finding{findings.length === 1 ? "" : "s"}. Coverage of extracted findings, not independent verification or proof the account
        is fully researched.
      </p>}
      {reading && coverage.missing.length > 0 && <p className="mt-2 text-label text-ink-muted">No retained findings: {coverage.missing.map((t) => TOPIC_LABELS[t]).join(", ")}.</p>}
      {reading && coverage.reasons.map((r, i) => <p key={i} className="mt-2 text-label text-ink-muted">{r}</p>)}
      {/* `items-start`: without it every card in a row stretches to the
          tallest, so a topic with one line printed a panel the height of a
          topic with six. */}
      <div className={reading ? `mt-3 grid items-start gap-5 ${max !== undefined ? "md:grid-cols-2" : ""}` : "mt-2 grid items-start gap-3 md:grid-cols-2"}>
        {(reading ? topics.filter((topic) => findings.some((f) => f.topic === topic)) : topics).map((topic) => {
          const rows = byTopic.get(topic) ?? [];
          // The count is the note's whole count for the topic, not the number
          // of rows this card happens to be showing: a card that says "3" over
          // three rows while nine exist is the bounded-list lie DECISIONS #20
          // is about.
          //
          // `other` is not a dossier topic, so `coverage.counts` has no entry
          // for it and this used to fall back to `rows.length` — the capped
          // number, which is the lie above, and which also made `total >
          // rows.length` permanently false so the card could never offer a way
          // to the rest. Counted from the findings themselves instead.
          const total =
            topic === "other" ? findings.filter((f) => f.topic === "other").length : coverage.counts[topic as (typeof DOSSIER_TOPICS)[number]];
          return (
            <div key={topic} className={reading ? "research-topic rounded-lg border border-line-strong bg-surface p-3.5 shadow-card" : `rounded-lg border border-line bg-surface-sunk ${total === 0 ? "px-3.5 py-2.5" : "p-3.5"}`}>
              <div className={`${reading ? "research-topic-heading" : ""} flex flex-wrap items-baseline justify-between gap-2`}>
                {reading ? <h3 className="font-display text-lead font-bold tracking-tight text-ink-strong">{TOPIC_LABELS[topic as Topic] ?? topic}</h3> : <h4 className="font-display font-bold tracking-tight text-ink-strong">{TOPIC_LABELS[topic as Topic] ?? topic}</h4>}
                <span className="text-micro tabular-nums text-ink-muted">
                  {total === 0 ? "No findings in this pass" : `${total} finding${total === 1 ? "" : "s"}`}
                </span>
              </div>
              {rows.length > 0 && (
                <ul className={reading ? "mt-3 space-y-4" : "mt-2 space-y-1.5"}>
                  {rows.map((f, i) => (
                    <li key={`${f.url}-${i}`}>
                      <FindingRow finding={f} accountName={accountName} anchorId={anchorFor?.(f)} reading={reading} findingHref={reading ? findingHref?.(f) : undefined} />
                      {!reading && findingHref && <Link href={findingHref(f)} className="inline-block py-1 text-micro text-accent hover:underline">Read finding →</Link>}
                    </li>
                  ))}
                </ul>
              )}
              {/* The link is gated on the topic having more than this card is
                  showing — not on the card showing anything. Gated on `rows`,
                  a card counting nine findings and showing none (which is what
                  a budget spent in topic order produces) offered no way to
                  them at all. */}
              {/* One topic, not the whole dossier. "View all 9" used to go to
                  `?all=1`, which opens every note in full and leaves you to
                  find the nine — the same "here is the number, go and look"
                  the cards exist to end. `topicHref` addresses the topic
                  itself; `moreHref` remains the fallback for a caller that has
                  no topic route. */}
              {total > rows.length && (topicHref?.(topic) ?? moreHref) && (
                <Link href={(topicHref?.(topic) ?? moreHref)!} className="mt-2 inline-block text-micro font-semibold text-accent hover:underline">
                  View all {total} →
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {!reading && coverage.reasons.map((r, i) => (
        <p key={i} className="mt-2 text-micro text-ink-muted">
          {r}
        </p>
      ))}
    </div>
  );
}
