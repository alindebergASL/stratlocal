import Link from "next/link";
import { teamPhrase } from "@/lib/team/members";
import { listUsers } from "@/lib/auth";
import type { ReactNode } from "react";
import type { Brief, BriefItem } from "@/lib/research/brief";
import type { ResearchEntity } from "@/lib/research/schema";
import { sourceKind } from "@/lib/research/provenance";
import { RunButton } from "./RunButton";
import { FindingWhen, SourceBadge } from "./FindingList";

// The three questions a seller has before reading any of the detail: why
// this account now, where what we sell fits, and what is new. Each line is a
// kept finding, said with who said it and how old it is; the "so what" under
// a fit is the model's read, and says so.
export function ResearchBrief({
  brief,
  focusAreas,
  accountName,
  today,
  findingHref,
  readUrl,
  unread,
  readDisabled,
  entity = null,
}: {
  entity?: ResearchEntity | null;
  brief: Brief;
  focusAreas: string[];
  accountName: string | string[];
  today: string;
  findingHref: (k: BriefItem) => string;
  readUrl: string;
  unread: number;
  readDisabled: string | null;
}) {
  const Line = ({ k, label, children }: { k: BriefItem; label?: string; children?: ReactNode }) => (
    <li className="py-2" data-testid="brief-line">
      <p className="text-body text-ink-strong">
        {label && <span className="mr-1.5 rounded bg-warning-soft px-1.5 py-px text-micro font-semibold text-warning ring-1 ring-warning-line">{label}</span>}
        <Link href={findingHref(k)} className="hover:underline">{k.finding.text}</Link>
      </p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-micro">
        <SourceBadge kind={sourceKind(k.finding.url, accountName)} />
        <FindingWhen date={k.finding.date} pageAge={k.finding.page_age} today={today} />
        {k.read?.owner && <span className="text-ink-muted">· owner: {k.read.owner}</span>}
      </p>
      {children}
    </li>
  );
  const whyNow = [...brief.events.map((k) => ({ k, label: "Compelling event" })), ...brief.triggers.map((k) => ({ k, label: "Trigger" }))];
  const fitted = brief.fit.filter((f) => f.items.length > 0);
  const unfitted = brief.fit.filter((f) => f.items.length === 0).map((f) => f.area);
  return (
    <section id="research-brief" aria-labelledby="research-brief-h" className="mb-6 rounded-xl border border-line bg-surface p-4 sm:p-5" data-testid="research-brief">
      <h2 id="research-brief-h" className="font-display text-heading font-bold text-ink-strong">The brief</h2>
      <p className="text-micro text-ink-muted">From kept findings only. Which are reasons to act, and where they fit, is the model&rsquo;s read of them.</p>
      {entity && (
        // Which organisation all of this is about, as research confirmed it.
        <p className="mt-2 text-label text-ink" data-testid="research-entity">
          Researched as <strong className="text-ink-strong">{entity.name}</strong>
          {[entity.domain, entity.ticker && `ticker ${entity.ticker}`, entity.parent && `part of ${entity.parent}`, entity.hq].filter(Boolean).map((x) => ` · ${x}`)}
          {entity.url && (
            <>
              {" "}
              <a href={entity.url} target="_blank" rel="noreferrer noopener" className="text-micro text-accent hover:underline">source</a>
            </>
          )}
        </p>
      )}

      <h3 className="mt-4 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">Why now</h3>
      {whyNow.length ? (
        <ul className="divide-y divide-line" data-testid="brief-why-now">
          {whyNow.map(({ k, label }) => <Line key={`${k.noteId}#${k.index}`} k={k} label={label} />)}
        </ul>
      ) : (
        <p className="mt-1 text-label text-ink-muted" data-testid="brief-why-now-empty">
          {brief.read ? "No dated reason to act in what is kept. A run looks for one each time." : "Not read for this yet."}
        </p>
      )}

      <h3 className="mt-4 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">Where we fit</h3>
      {focusAreas.length === 0 ? (
        <p className="mt-1 text-label text-ink-muted">
          Set what {teamPhrase(listUsers().length).all} sell{listUsers().length === 2 ? "" : "s"} in <Link href="/settings/direction" className="font-semibold text-accent hover:underline">Team direction</Link> to see where it fits here.
        </p>
      ) : (
        <>
          {fitted.length > 0 && (
            <ul className="divide-y divide-line" data-testid="brief-fit">
              {fitted.map(({ area, items }) => (
                <li key={area} className="py-2">
                  <p className="text-label font-semibold text-ink-strong">
                    {area} <span className="font-normal text-ink-muted">· {items.length} finding{items.length === 1 ? "" : "s"}</span>
                  </p>
                  <ul>
                    {items.slice(0, 2).map((k) => (
                      <Line key={`${k.noteId}#${k.index}`} k={k}>
                        {k.read?.so_what && <p className="mt-1 border-l-2 border-accent pl-2 text-label text-ink">So what: {k.read.so_what}</p>}
                      </Line>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {unfitted.length > 0 && (
            <p className="mt-1 text-label text-ink-muted" data-testid="brief-fit-gaps">
              {brief.read ? `Nothing kept touches ${unfitted.join(", ")} yet.` : "Not read for this yet."}
            </p>
          )}
        </>
      )}

      {brief.changed !== null && (
        <>
          <h3 className="mt-4 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">
            New since you last looked{brief.since ? ` (${new Date(brief.since).toISOString().slice(0, 10)})` : ""}
          </h3>
          {brief.changed.length ? (
            <ul className="divide-y divide-line" data-testid="brief-changed">
              {brief.changed.slice(0, 5).map((k) => <Line key={`${k.noteId}#${k.index}`} k={k} />)}
              {brief.changed.length > 5 && <li className="py-2 text-micro text-ink-muted">and {brief.changed.length - 5} more, in the topics below.</li>}
            </ul>
          ) : (
            <p className="mt-1 text-label text-ink-muted" data-testid="brief-changed-empty">Nothing new has been kept since.</p>
          )}
        </>
      )}

      {unread > 0 && (
        <div className="mt-4 border-t border-line pt-3" data-testid="brief-read">
          <p className="mb-2 text-label text-ink-muted">
            {unread} kept finding{unread === 1 ? " has" : "s have"} not been read for why now and fit. One pass over their own words, no new searching.
          </p>
          <RunButton url={readUrl} label="Read what we know" busyLabel="Reading…" kind="reads" tone="quiet" disabledReason={readDisabled} />
        </div>
      )}
    </section>
  );
}
