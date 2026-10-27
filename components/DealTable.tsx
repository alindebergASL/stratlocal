import Link from "next/link";
import type { DealRow } from "@/lib/db";
import { NextStepWaiver } from "./NextStepWaiver";
import { crmIdText, fmtDay, fmtMoney, stageText } from "@/lib/format";
import { ownerNames } from "@/lib/dealOwners";
import { dealCommitmentCounts, followUpLine } from "@/lib/pipelineCommitments";
import { quarterLabel } from "@/lib/fiscal";
import { Chip, Empty, stageTone } from "./ui";
import { DealQuickEdit } from "./DealQuickEdit";

// A grid rather than a <table>, so the same markup can be a row on a laptop
// and a card on a phone. The old table presented about 1000px of columns
// through a 318px window, and ran entityHistory once per row on every page
// load whether or not anyone opened it — that history now lives on the deal's
// own page, where there is room to read it.
const COLS = "sm:grid-cols-[minmax(0,2.2fr)_auto_auto_auto_minmax(0,1.6fr)]";

export function DealTable({
  accountId,
  deals,
  max,
  moreHref,
  moreLabel,
}: {
  accountId: string;
  deals: DealRow[];
} & (
  | { max?: undefined; moreHref?: undefined; moreLabel?: undefined }
  // `moreHref` without `max` was silently inert: nothing is ever hidden, so
  // the link never renders and the page looks correct while the destination it
  // names is unreachable. Required together, so that is a type error.
  | {
      max: number;
      /** Where the rest live. Given one, the tail is not rendered at all. */
      moreHref?: string;
      /** What that destination is, when it is not another list of deals. */
      moreLabel?: (hidden: number) => string;
    }
)) {
  if (deals.length === 0) return <Empty>No deals yet. Import a report or add one below.</Empty>;
  // Ordered by close date, so the cap keeps what is closing soonest — the
  // rows you opened the page for.
  const shown = max === undefined ? deals : deals.slice(0, max);
  const rest = deals.slice(shown.length);
  // The owner as a person confirmed the spelling; the deal keeps the CRM's.
  const owner = ownerNames().nameOf;
  const counts = dealCommitmentCounts(shown.map((d) => ({ account_id: accountId, deal_id: d.deal_id })));
  return (
    <div>
      <div className={`hidden gap-x-4 border-b border-line pb-2 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted sm:grid ${COLS}`}>
        <div>Deal</div>
        <div>Stage</div>
        <div>Close</div>
        <div className="text-right">TCV</div>
        <div>Next step</div>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((d) => (
          <DealRowView key={d.deal_id} accountId={accountId} deal={d} owner={owner(d.owner)} followUps={followUpLine(counts.get(d.deal_id))} />
        ))}
      </ul>
      {/* Every caller passes `moreHref`, so the tail is never rendered here.
          It used to fall back to a <details>, which hides the rows and still
          ships them — right where a link into the tail has to land, and wrong
          when the bytes are the problem. Every deal has its own page now, so
          nothing anchors into this list any more. */}
      {moreHref && rest.length > 0 && (
        <Link href={moreHref} className="mt-3 inline-block text-label text-accent hover:underline">
          {moreLabel ? moreLabel(rest.length) : `${rest.length} more deal${rest.length === 1 ? "" : "s"}`}
        </Link>
      )}
    </div>
  );
}

function DealRowView({ accountId, deal: d, owner, followUps }: { accountId: string; deal: DealRow; owner: string | null; followUps: string | null }) {
  const closed = d.status !== "open";
  return (
    <li className={`grid gap-x-4 gap-y-1.5 py-3 sm:items-baseline ${COLS}`}>
      <div className="min-w-0">
        <Link href={`/accounts/${accountId}/deals/${encodeURIComponent(d.deal_id)}`} className="font-semibold text-ink hover:text-accent hover:underline">
          {d.name}
        </Link>
        <div className="text-micro tabular-nums text-ink-muted">
          {crmIdText(d.deal_id) ?? "no CRM id yet"}
          {owner ? ` · ${owner}` : ""}
          {closed ? ` · ${d.status}` : ""}
          {d.competitor ? ` · vs ${d.competitor}` : ""}
          {d.partner ? ` · via ${d.partner}` : ""}
        </div>
      </div>

      {/* One line of the card on a phone; three columns of the row from sm. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:contents">
        <div>
          <Chip tone={stageTone(d.stage)}>{stageText(d.stage, d.stage_label)}</Chip>
        </div>
        <div className="flex items-baseline gap-2 whitespace-nowrap text-label tabular-nums">
          {fmtDay(d.close_date)}
          {d.fiscal_quarter && <span className="text-micro text-ink-muted">{quarterLabel(d.fiscal_quarter)}</span>}
        </div>
        <div className="whitespace-nowrap font-semibold tabular-nums sm:text-right">{fmtMoney(d.tcv_usd)}</div>
      </div>

      <div className="min-w-0">
        <DealQuickEdit
          accountId={accountId}
          dealId={d.deal_id}
          stage={d.stage}
          nextStep={d.next_step}
          status={d.status}
          closeDate={d.close_date}
          tcvUsd={d.tcv_usd}
          version={d.updated_at}
          linked={followUps ? { label: followUps, href: `/accounts/${accountId}/deals/${encodeURIComponent(d.deal_id)}#commitments` } : null}
        />
        <div className="mt-1">
          <NextStepWaiver accountId={accountId} deal={d} compact link />
        </div>
      </div>
    </li>
  );
}
