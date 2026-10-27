import { ButtonLink, Callout, Empty, Section } from "@/components/ui";
import { DOSSIER_TOPICS } from "@/lib/research/coverage";
import { FindingWhen, SourceBadge } from "@/components/FindingList";
import { sourceKind } from "@/lib/research/provenance";
import { todayISO } from "@/lib/clock";

// What we know about the account from kept research (DECISIONS #100): what
// to read first with its source, and how often news is watched for. The full
// dossier and its sources live under More → Research.
export type ResearchPanelView = {
  accountId: string;
  notes: number;
  kept: number;
  latest: string | null;
  drafts: number;
  pendingUpdates: number;
  /** Retained findings per dossier topic, across every accepted note. */
  counts: Record<(typeof DOSSIER_TOPICS)[number], number>;
  /** Retained findings that landed outside the seven dossier topics. Counted, never hidden. */
  other?: number;
  /** What to read first, already chosen (overviewLeads): a reason to act, where we fit, then the newest by topic. */
  leads: Array<{ noteId: string; index: number; label: string; kind: "why" | "fit" | "topic"; text: string; url: string; date: string | null; pageAge?: string; soWhat: string | null }>;
  /** The organisation as research confirmed it. */
  entity?: { name: string; domain: string | null } | null;
  /** Name and confirmed domain, for telling the account's own pages apart. */
  identity?: string | string[];
  today?: string;
  /** Peers and competitors from kept research: names, and the one-line summary. */
  peers?: { names: string[]; summary: string | null } | null;
};

export function ResearchPanel({ view, className = "", children }: { view: ResearchPanelView; className?: string; children?: React.ReactNode }) {
  const { accountId } = view;
  const research = `/accounts/${accountId}/research`;
  return (
    <Section id="research" title="What we know" className={className}>
      {/* What is waiting on a person comes before what is already known: these
          are the two reasons to open the page, and only one of them is
          reading. The suggested-updates line appears only when proposals are
          actually pending — it was an unconditional link, so it advertised a
          review queue that was usually empty. */}
      {view.drafts > 0 && (
        <Callout tone="warning" className="mb-3">
          <p className="mb-2">
            <strong className="tabular-nums">{view.drafts}</strong> draft note{view.drafts === 1 ? "" : "s"} to review.
          </p>
          <ButtonLink href={`${research}#research-review`} size="sm" testId="research-review-findings">
            Review findings
          </ButtonLink>
        </Callout>
      )}
      {view.pendingUpdates > 0 && (
        <Callout tone="warning" className="mb-3">
          <p className="mb-2">
            <strong className="tabular-nums">{view.pendingUpdates}</strong> suggested account update{view.pendingUpdates === 1 ? "" : "s"} to review.
          </p>
          <ButtonLink href={`/inbox?kind=changes&account=${accountId}`} size="sm" variant="quiet" testId="research-review-updates">
            Review suggested updates
          </ButtonLink>
        </Callout>
      )}

      {view.notes === 0 ? (
        view.drafts > 0 ? (
          // The draft above is the next step; a second "run research" here
          // would replace it.
          <p className="text-label text-ink-muted">Nothing kept yet.</p>
        ) : (
        <>
          <Empty>No research kept yet. Review findings before using them in a brief or plan.</Empty>
          <ButtonLink href={research} variant="quiet" size="sm" testId="research-open">
            Run research
          </ButtonLink>
        </>
        )
      ) : (
        <>
          <p className="text-label text-ink-muted" data-testid="research-panel-counts">
            <span className="font-semibold tabular-nums text-ink">{view.kept}</span> retained finding{view.kept === 1 ? "" : "s"} across {view.notes} note
            {view.notes === 1 ? "" : "s"}
          </p>
          {view.latest && (
            <p className="mt-1 whitespace-nowrap text-micro text-ink-muted" data-testid="research-panel-latest">
              Latest note: <time dateTime={view.latest} className="whitespace-nowrap tabular-nums">{view.latest.slice(0, 10)}</time>
            </p>
          )}
          {view.entity && (
            <p className="mt-1 text-micro text-ink-muted" data-testid="research-panel-entity">
              Researched as <span className="font-semibold text-ink">{view.entity.name}</span>
              {view.entity.domain ? ` · ${view.entity.domain}` : ""}
            </p>
          )}
          {/* What to read first: a reason to act, where what the two of you
              sell fits, then the newest by topic. It used to be one finding
              from each of the first three topics in a fixed order, which was
              whatever happened to be first, not what mattered. */}
          {view.leads.length > 0 && (
            <ul className="mt-3 divide-y divide-line border-t border-line" data-testid="research-panel-recent">
              {view.leads.map((f) => (
                <li key={`${f.noteId}#${f.index}`} className="min-w-0 py-3 text-label" data-lead={f.kind}>
                  <span className={f.kind === "why" ? "rounded bg-warning-soft px-1.5 py-px text-micro font-semibold text-warning ring-1 ring-warning-line" : "text-body font-bold text-ink-strong"} data-testid="research-preview-topic">
                    {f.label}
                  </span>
                  <p className="mt-1 line-clamp-2 break-words text-ink">{f.text}</p>
                  {f.soWhat && <p className="mt-1 border-l-2 border-accent pl-2 text-micro text-ink">So what: {f.soWhat}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro">
                    <SourceBadge kind={sourceKind(f.url, view.identity)} />
                    <FindingWhen date={f.date} pageAge={f.pageAge} today={view.today ?? todayISO()} />
                    <a href={`${research}?note=${f.noteId}&finding=${f.index}#finding-${f.noteId}-${f.index}`} className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent sm:min-h-0" aria-label={`Read full finding: ${f.label}`}>
                      Read finding →
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {view.peers && (
            <p className="mt-3 border-t border-line pt-3 text-label text-ink" data-testid="research-panel-peers">
              <span className="font-semibold">Peers and competitors:</span> {view.peers.names.join(", ")}
              {view.peers.summary ? <span className="text-ink-muted">. {view.peers.summary}</span> : null}{" "}
              <a href={`${research}?view=peers`} className="whitespace-nowrap font-semibold text-accent hover:underline">
                See how →
              </a>
            </p>
          )}
          <p className="mt-3 text-micro text-ink-muted">Kept after review; not independently verified.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href={research} variant="quiet" size="sm" testId="research-open">
              Open research
            </ButtonLink>
          </div>
        </>
      )}
      {children && <div className="mt-4 border-t border-line pt-3">{children}</div>}
    </Section>
  );
}
