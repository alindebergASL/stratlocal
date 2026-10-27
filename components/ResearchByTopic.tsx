import type { ReactNode } from "react";
import Link from "next/link";
import { TOPICS, TOPIC_LABELS, type ResearchFinding, type Topic } from "@/lib/research/schema";
import { newestFirst } from "@/lib/research/provenance";
import { findingAnchor } from "@/lib/research/anchor";
import { FindingRow } from "./FindingList";

// One kept finding, wherever it was found: the note and stored index are its
// address, the note's date stands in when the finding carries none.
export type KeptFinding = { noteId: string; noteTitle: string; index: number; finding: ResearchFinding; asOf: string };

/** Kept findings grouped by topic, newest first within each. */
export function byTopic(items: KeptFinding[]): Array<{ topic: Topic; rows: KeptFinding[] }> {
  const sorted = [...items].sort((a, b) => newestFirst({ date: a.finding.date, asOf: a.asOf }, { date: b.finding.date, asOf: b.asOf }));
  return TOPICS.map((topic) => ({ topic, rows: sorted.filter((k) => k.finding.topic === topic) })).filter((g) => g.rows.length > 0);
}

type Links = {
  topicHref: (topic: string) => string;
  findingHref: (k: KeptFinding) => string;
  noteHref: (noteId: string) => string;
};

// What we know, by topic, across every run.
//
// It used to be one note at a time — "Choose a saved note" — so with four
// runs the leadership facts were spread over four places and the first thing
// on the page was whichever run happened to be newest. A seller asks "what do
// we know about their leadership", not "what did run three find". Each topic
// is one row, short by default: its newest finding with who said it and how
// old it is, and a way to the rest at its own address.
export function ResearchByTopic({ items: all, runs, today, accountName, aside, exclude = [], ...links }: { items: KeptFinding[]; runs: number; today: string; accountName: string | string[]; aside?: ReactNode; exclude?: Topic[] } & Links) {
  // Topics another tab shows (peers) are left out here, gaps included.
  const items = all.filter((k) => !exclude.includes(k.finding.topic));
  const groups = byTopic(items);
  const empty = TOPICS.filter((t) => t !== "other" && !exclude.includes(t) && !groups.some((g) => g.topic === t));
  const newest = groups.flatMap((g) => g.rows[0]?.finding.date ?? []).sort().at(-1);
  return (
    <section id="research-notes" aria-labelledby="research-known" className="mb-6 min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5" data-testid="research-by-topic">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="research-known" className="font-display text-heading font-bold text-ink-strong">What we know</h2>
        {aside}
      </div>
      <p className="mt-0.5 text-micro text-ink-muted">
        {items.length} kept finding{items.length === 1 ? "" : "s"} from {runs} run{runs === 1 ? "" : "s"}{newest ? `, newest dated ${newest}` : ""}. Newest first in each topic.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {groups.map(({ topic, rows }) => {
          const lead = rows[0]!;
          return (
            <li key={topic} className="py-3" data-testid="research-topic-row" data-topic={topic}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">{TOPIC_LABELS[topic]}</h3>
                {rows.length > 1 ? (
                  <Link href={links.topicHref(topic)} className="inline-flex min-h-11 shrink-0 items-center text-label font-semibold text-accent hover:underline sm:min-h-0" data-testid="research-topic-more">
                    All {rows.length} →
                  </Link>
                ) : (
                  <span className="text-micro text-ink-faint">1 finding</span>
                )}
              </div>
              <div className="mt-1">
                <FindingRow reading finding={lead.finding} accountName={accountName} today={today} anchorId={findingAnchor(lead.noteId, lead.index)} findingHref={links.findingHref(lead)} />
              </div>
            </li>
          );
        })}
      </ul>
      {empty.length > 0 && (
        <p className="mt-2 border-t border-line pt-3 text-label text-ink-muted" data-testid="research-topic-gaps">
          Nothing kept yet on {list(empty.map((t) => TOPIC_LABELS[t].replace(/^The /, "the ")))}.
        </p>
      )}
    </section>
  );
}

// One topic, every kept finding in it, newest first, each with the run it
// came from. The address is `?topic=` on its own; with `&note=` it is still
// one topic inside one note.
export function TopicAcrossRuns({ topic, items, today, accountName, backHref, ...links }: { topic: string; items: KeptFinding[]; today: string; accountName: string | string[]; backHref: string } & Links) {
  const rows = byTopic(items).find((g) => g.topic === topic)?.rows ?? [];
  const label = TOPIC_LABELS[topic as Topic] ?? topic;
  return (
    <section id="research-notes" className="mb-6 min-w-0 max-w-3xl" data-testid="research-topic">
      <Link href={backHref} className="inline-flex min-h-11 items-center text-label font-semibold text-accent hover:underline sm:min-h-0">
        ← What we know
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-heading font-bold tracking-tight text-ink-strong">{label}</h2>
        <span className="text-micro tabular-nums text-ink-muted">
          {rows.length} kept finding{rows.length === 1 ? "" : "s"}, newest first
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-label text-ink-muted">Nothing is kept under {label} yet. Review may have declined what a run found, or no run has looked.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {rows.map((k) => (
            <li key={`${k.noteId}#${k.index}`}>
              <FindingRow
                reading
                finding={k.finding}
                accountName={accountName}
                today={today}
                anchorId={findingAnchor(k.noteId, k.index)}
                findingHref={links.findingHref(k)}
                extra={
                  <Link href={links.noteHref(k.noteId)} className="py-1 text-micro text-ink-muted hover:text-ink hover:underline">
                    from {k.noteTitle}
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function list(words: string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}
