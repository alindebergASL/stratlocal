import Link from "next/link";
import type { ReactNode } from "react";
import { ResearchSource, TOPIC_LABELS, TOPICS, type ResearchFinding, type Topic } from "@/lib/research/schema";
import { Chip, Eyebrow } from "./ui";
import { findingSourceIdentity } from "./sourceIdentity";
import { findingAge, sourceKind, type SourceKind } from "@/lib/research/provenance";
import { todayISO } from "@/lib/clock";

// Who said it, before what they said: a filing or the company's own release
// reads differently from an aggregator, and the badge is how you tell at a
// glance. Worked out from the address in code, never by the model.
const KIND_TONE: Record<SourceKind, string> = {
  Filing: "bg-accent-soft text-ink-strong",
  Company: "bg-accent-soft text-ink-strong",
  "Public record": "bg-accent-soft text-ink-strong",
  Press: "bg-surface-sunk text-ink",
  Trade: "bg-surface-sunk text-ink",
  Other: "border border-line text-ink-muted",
};

export function SourceBadge({ kind }: { kind: SourceKind }) {
  return (
    <span data-testid="source-kind" className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-micro font-semibold ${KIND_TONE[kind]}`}>
      {kind}
    </span>
  );
}

/** The date a finding carries, and its age, with anything a year old said plainly. */
export function FindingWhen({ date, today, pageAge }: { date: string | null; today: string; pageAge?: string }) {
  // No date in the text, but the search index had one for the page: shown as
  // the index's, in its own words.
  if (!date && pageAge) {
    const parsed = Date.parse(pageAge);
    const iso = Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
    const age = iso ? findingAge(iso, today) : null;
    return (
      <span className="tabular-nums text-ink-muted" data-testid="finding-age" title="The search index's date for this page">
        {iso ?? pageAge} (indexed){age && <span className={age.stale ? "font-semibold text-warning" : ""}> · {age.label}</span>}
      </span>
    );
  }
  if (!date) return <span className="text-ink-faint" data-testid="finding-age">undated</span>;
  const age = findingAge(date, today);
  return (
    <span className="tabular-nums text-ink-muted" data-testid="finding-age">
      {date}
      {age && <span className={age.stale ? "font-semibold text-warning" : ""}> · {age.label}</span>}
    </span>
  );
}

// One way to render a finding, used by the draft review and by the accepted
// list on the account page. They were two different treatments of the same
// data, which meant a finding read one way while you were deciding on it and
// another way afterwards.
//
// The supporting quote goes behind a disclosure. It is the model's evidence
// that a sentence came from a page it actually read, which matters when you
// doubt a finding and almost never otherwise — at full length under every row
// it said the same thing as the finding, twice.
export function FindingRow({ finding, showTopic = false, anchorId, reading = false, findingHref, accountName, today, extra }: { finding: ResearchFinding; showTopic?: boolean; anchorId?: string; reading?: boolean; findingHref?: string; accountName?: string | string[]; today?: string; extra?: ReactNode }) {
  const source = findingSourceIdentity(finding);
  const kind = sourceKind(finding.url, accountName);
  const evidence = (
      <details className={reading ? "open:basis-full" : "mt-0.5"}>
        <summary className="-mx-1 inline-block cursor-pointer rounded px-1 py-1 text-micro text-ink-muted transition-colors hover:text-ink">{reading ? "▸ Evidence" : "▸ View supporting evidence"}</summary>
        {finding.page_age && finding.date && <p className="mt-1 text-micro text-ink-muted">The search index dates this page {finding.page_age}.</p>}
        <p className="mt-1 text-micro text-ink-muted">
          Model confidence: {finding.confidence} — the model&rsquo;s own estimate, not verification.
        </p>
        <p className="mt-1 border-l-2 border-line pl-2 text-micro text-ink-muted">
          &ldquo;
          {finding.evidence?.kind === "source_excerpt" ? finding.evidence.text : finding.quote}
          &rdquo;
        </p>
        <p className="text-micro text-ink-muted">
          {finding.evidence?.kind === "source_excerpt"
            ? `Source-bound excerpt (${finding.evidence.location ?? "source text"}). Claim not independently verified.`
            : "Unverified: excerpt from the generated report, not an original-source quotation. Review the source before relying on this claim."}
        </p>
        {finding.evidence?.kind === "source_excerpt" && <p className="mt-2 text-micro text-ink-muted">Research report wording (AI-generated): {finding.quote}</p>}
      </details>
  );
  return (
    // `anchorId` is the finding's own address: note id and its stored index,
    // never its position in whatever list is being rendered, so a link to it
    // keeps meaning the same finding after the preview changes shape.
    <div className="min-w-0 break-words" id={anchorId} data-finding-anchor={anchorId}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {showTopic && <Chip>{TOPIC_LABELS[finding.topic as Topic] ?? finding.topic}</Chip>}
        <span className="text-body text-ink-strong">{finding.text}</span>
      </div>
      {/* The finding is the sentence; the source is how you check it. The
          model's own confidence was a coloured pill between the two, repeated
          on every row — the loudest thing in a list of claims, saying only
          what the model thought of itself. It is metadata now, with its label
          and its value intact and a word about what it is not. */}
      <div className={reading ? "mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-label" : "mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-micro"}>
        <SourceBadge kind={kind} />
        {source.href ? (
          <a href={source.href} target="_blank" rel="noreferrer noopener"
            className="-mx-1 min-w-0 max-w-full rounded px-1 py-0.5 font-semibold text-accent hover:underline [overflow-wrap:anywhere]">
            {source.label}
          </a>
        ) : <span className="text-ink-muted">{source.label}</span>}
        <FindingWhen date={finding.date} pageAge={finding.page_age} today={today ?? todayISO()} />
        {extra}
        {/* The value and its label stay on the row; the sentence explaining
            what the value is not moved into the disclosure below. At phone
            width that qualification wrapped to four lines under every single
            finding, so a card of a dozen claims was mostly the same caveat
            repeated — which is how a caveat stops being read. */}
        {reading && findingHref && <Link href={findingHref} className="py-1 text-accent hover:underline">Read finding →</Link>}
        {reading && evidence}
      </div>
      {!reading && evidence}
    </div>
  );
}

/** The findings of one note, in topic order, with the cap already applied. */
export function groupFindings(findings: ResearchFinding[], max?: number) {
  // The cap is applied *after* grouping, not across the flat array. Slicing
  // first took the first N in stored order and pushed the remainder into a
  // second, nested FindingList — which re-printed the topic headings it had
  // already shown, so one topic could appear twice on the same page, once
  // above the fold and once inside it.
  let budget = max ?? findings.length;
  const groups: Array<{ topic: Topic; rows: ResearchFinding[] }> = [];
  for (const topic of TOPICS) {
    if (budget <= 0) break;
    const rows = findings.filter((f) => f.topic === topic).slice(0, budget);
    if (rows.length === 0) continue;
    budget -= rows.length;
    groups.push({ topic: topic as Topic, rows });
  }
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  return { groups, hidden: findings.length - shown };
}

/**
 * A bounded *preview* of every topic, rather than the first topics in full.
 *
 * `groupFindings` spends the whole budget in topic order, which is right for a
 * single list you read top to bottom and wrong for a grid of topic cards: a
 * note with twenty-six organisation findings and a cap of twenty-four filled
 * the first two cards and left leadership, strategy, technology, procurement
 * and risk printing "9 findings" over nothing at all. The count was true, the
 * card was empty, and the per-topic link to the rest was gated on there being
 * at least one row — so the five topics with the most hidden behind them were
 * the five with no way to reach it.
 *
 * Round-robin instead: every topic that has anything gets its first finding
 * before any topic gets its second. The cap still holds exactly, and what a
 * card is not showing is always reachable from that card.
 *
 * `perTopic` is the second half of that. Round-robin alone still spends the
 * whole budget when the findings are all in one topic — twenty-four rows in a
 * single card, which is the page the cards were meant to replace. A preview is
 * a taste of each topic and a way to the rest, so each card shows at most two
 * whatever the distribution is, and the total shown is the honest smaller
 * number rather than the cap.
 */
export function previewByTopic(
  findings: ResearchFinding[],
  max?: number,
  perTopic = 2,
): { rows: Map<string, ResearchFinding[]>; shown: number; hidden: number } {
  const all = new Map<string, ResearchFinding[]>();
  for (const f of findings) all.set(f.topic, [...(all.get(f.topic) ?? []), f]);
  const order = [...TOPICS.filter((t) => all.has(t)), ...[...all.keys()].filter((t) => !TOPICS.includes(t as Topic))];
  if (max === undefined) return { rows: all, shown: findings.length, hidden: 0 };
  const rows = new Map<string, ResearchFinding[]>();
  let budget = Math.max(0, max);
  for (let depth = 0; budget > 0 && depth < Math.max(0, perTopic); depth += 1) {
    let placed = false;
    for (const topic of order) {
      if (budget <= 0) break;
      const next = all.get(topic)?.[depth];
      if (!next) continue;
      rows.set(topic, [...(rows.get(topic) ?? []), next]);
      budget -= 1;
      placed = true;
    }
    if (!placed) break;
  }
  const shown = [...rows.values()].reduce((n, r) => n + r.length, 0);
  return { rows, shown, hidden: findings.length - shown };
}

// Grouped by topic in a fixed order, so two notes about the same account read
// the same way and the eye knows where to go.
//
// `max` and `moreHref` travel together, because a cap with no way to the rest
// is just missing data. The way to the rest is a page or a parameter, never a
// <details> that hides the rows and ships them anyway (DECISIONS #20) — which
// is exactly what the overflow used to be.
export function FindingList({
  findings,
  ...rest
}: { findings: ResearchFinding[] } & ({ max: number; moreHref: string } | { max?: undefined; moreHref?: undefined })) {
  if (findings.length === 0) return <p className="mt-2 text-label text-ink-muted">No findings kept.</p>;
  const { groups, hidden } = groupFindings(findings, rest.max);
  return (
    <div className="mt-3 space-y-3">
      {groups.map(({ topic, rows }) => (
        <div key={topic}>
          <Eyebrow className="mb-1">{TOPIC_LABELS[topic]}</Eyebrow>
          <ul className="space-y-1.5">
            {rows.map((f, i) => (
              <li key={`${f.url}-${i}`}>
                <FindingRow finding={f} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {hidden > 0 && rest.moreHref && (
        <Link href={rest.moreHref} className="inline-block text-label font-semibold text-accent hover:underline">
          {hidden} more finding{hidden === 1 ? "" : "s"} →
        </Link>
      )}
    </div>
  );
}
