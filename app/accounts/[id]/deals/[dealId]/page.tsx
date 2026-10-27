import { AskAboutThis } from "@/components/AskAboutThis";
import { InlineField } from "@/components/kit/InlineField";
import Link from "next/link";
import { todayISO } from "@/lib/clock";
import { NextStepWaiver } from "@/components/NextStepWaiver";
import { waiverActive } from "@/lib/deals/nextStep";
import { CommitmentPanel } from "@/components/CommitmentPanel";
import { FollowUpReturn } from "@/components/FollowUpReturn";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import {
  entityHistoryCount,
  entityHistoryFor,
  getAccount,
  getDeal,
  likelyDuplicateDeals,
  listAccountChoices,
  listPendingProposals,
  listPlays,
  mergedDealIds,
} from "@/lib/queries/accounts";
import { getMeeting } from "@/lib/queries/meetings";
import { toProposalViews } from "@/lib/proposals/view";
import { fiscalQuarter } from "@/lib/fiscal";
import { crmIdText, fmtDay, fmtMoney, fmtWhen, logValueText, parseJsonArray, STAGE_LABELS, stageText, historyCountText } from "@/lib/format";
import { DEAL_STATUS_TONE, PLAY_TONE, playStatusLabel } from "@/lib/tone";
import { Page } from "@/components/Nav";
import { BaseVersion, Breadcrumb, Callout, Chip, control, Empty, Eyebrow, Field, Section, Stat, stageTone } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { ArchiveButton } from "@/components/ArchiveButton";
import { ProposalReview } from "@/components/ProposalReview";
import { archiveRecord, mergeDealsAction, moveDealToAccount, restoreRecord, saveDeal } from "@/app/actions";
import { FreshnessBaseline } from "@/components/AccountFreshness";
import { accountRevision } from "@/lib/queries/freshness";

export const dynamic = "force-dynamic";

// Enough to read, bounded because a record's history only grows. The count
// beside the section comes from a COUNT, not from this.
const HISTORY_SHOWN = 200;

// Written by the merge, and statements rather than field changes.
const MERGE_FIELDS = new Set(["merged_from", "merged_into", "merged_not_copied", "unmerged"]);

// The screen the app was missing. Every other deal link in the codebase went
// to an anchor on the account page, where a deal was one row, its history was
// a 256px list inside a table cell, and most of its fields could not be
// edited by hand at all — saveDeal existed but was only ever bound for a
// create, so a close date slipping a quarter had no UI.
export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string; dealId: string }>; searchParams?: Promise<{ returnTo?: string }> }) {
  const user = await requirePageUser();
  const { id, dealId } = await params;
  const deal = getDeal(dealId);
  const account = getAccount(id);
  if (!deal || !account || deal.account_id !== id) notFound();

  // Everything merged into this deal answers here. The rows are not rewritten
  // — an edit made to the other row still reads under the id it was made
  // under — but they are shown together, because "what happened to this deal"
  // is one question.
  const mergedIn = mergedDealIds(dealId);
  const history = entityHistoryFor("deal", [dealId, ...mergedIn], HISTORY_SHOWN);
  const historyTotal = entityHistoryCount("deal", [dealId, ...mergedIn]);
  const mergedInDeals = mergedIn.map((mid) => getDeal(mid)).filter((d): d is NonNullable<typeof d> => d !== null);
  const mergedIntoDeal = deal.merged_into ? getDeal(deal.merged_into) : null;
  const duplicates = likelyDuplicateDeals(id, dealId);
  const plays = listPlays(id, { includeArchived: true }).filter((p) => parseJsonArray(p.deal_ids_json).includes(dealId));
  const pending = listPendingProposals(id).filter((p) => p.entity_id === dealId);
  const derived = deal.close_date ? fiscalQuarter(deal.close_date) : null;

  // Which meetings actually moved this deal, read off the history's source
  // refs. This is the only real link between a deal and a conversation.
  const meetingIds = new Set<string>();
  for (const h of history) {
    if (!h.source_ref_json) continue;
    try {
      const ref = JSON.parse(h.source_ref_json) as { kind?: string; id?: string | null };
      if (ref.kind === "meeting" && ref.id) meetingIds.add(ref.id);
    } catch {
      // A malformed ref just means no link.
    }
  }
  const meetings = [...meetingIds].map((mid) => getMeeting(mid)).filter((m): m is NonNullable<typeof m> => m !== null);

  const proposalViews = toProposalViews(id, pending);

  const edit = saveDeal.bind(null, id, dealId);
  const move = moveDealToAccount.bind(null, id, dealId);
  const merge = mergeDealsAction.bind(null, id, dealId);
  const otherAccounts = listAccountChoices().filter((a) => a.id !== id);
  const isArchived = deal.archived_at != null;

  return (
    <Page user={user}>
      <FreshnessBaseline revision={accountRevision(id)} />
      <FollowUpReturn value={(await searchParams)?.returnTo} />
      <Breadcrumb accountId={id} accountName={account.name} page={deal.name} section={{ label: "Deals", href: `/accounts/${id}/deals` }} />

      {/* A merged-away deal is a tombstone, not an archived record waiting to
          come back, so it says where it went instead of offering Restore. */}
      {mergedIntoDeal ? (
        <Callout tone="neutral" className="mb-4">
          This deal was merged into{" "}
          <Link href={`/accounts/${id}/deals/${encodeURIComponent(mergedIntoDeal.deal_id)}`} className="font-semibold text-accent hover:underline">
            {mergedIntoDeal.name}
          </Link>
          . Everything it linked to lives there now, and its history is shown there beside the rest.
        </Callout>
      ) : (
        isArchived && (
          <Callout tone="neutral" className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span>This deal is archived on {deal.archived_at}. It is hidden from every list and from anything the model reads.</span>
            <ArchiveButton mode="restore" size="md" action={restoreRecord.bind(null, "deal", dealId)} />
          </Callout>
        )
      )}

      {/* Accept all is one press and a rationale under a card is quiet, so the
          pair is offered here too, where the duplicate is looked at. */}
      {duplicates.length > 0 && (
        <Callout tone="warning" className="mb-4">
          <p className="font-semibold">
            {duplicates.length === 1 ? "This looks like the same deal as another row on this account." : "This looks like the same deal as others on this account."}
          </p>
          <p className="mt-1 text-micro">
            {duplicates.map((d) => `${d.name}${crmIdText(d.deal_id) ? ` (${d.deal_id})` : " — added without a CRM id"}`).join(", ")}. Merging keeps the
            row carrying the CRM id, moves the other one's next step, notes and history onto it, and leaves the money alone.
          </p>
          <div className="mt-2">
            <ActionForm action={merge} testId="deal-merge" trigger="Merge them" submitLabel="Merge">
              <Field label={`Merge into ${deal.name}`} hint="The other row is archived. Its plays, history and anything proposed for it come here." wide>
                <select name="loser_id" required defaultValue={duplicates.length === 1 ? duplicates[0]!.deal_id : ""} className={control}>
                  {duplicates.length !== 1 && (
                    <option value="" disabled>
                      pick the duplicate
                    </option>
                  )}
                  {duplicates.map((d) => (
                    <option key={d.deal_id} value={d.deal_id}>
                      {d.name}
                      {crmIdText(d.deal_id) ? ` · ${d.deal_id}` : " · no CRM id"}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </div>
        </Callout>
      )}

      <div className="mb-5">
        <Eyebrow>{crmIdText(deal.deal_id) ? `Deal ${deal.deal_id}` : "Deal · no CRM id yet"}</Eyebrow>
        <h1 className="font-display text-title font-extrabold tracking-tight text-ink-strong sm:text-display">{deal.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip tone={stageTone(deal.stage)}>{stageText(deal.stage, deal.stage_label)}</Chip>
          {!deal.archived_at && <AskAboutThis accountId={id} kind="deal" id={deal.deal_id} />}
          <Chip tone={DEAL_STATUS_TONE[deal.status] ?? "neutral"}>{deal.status}</Chip>
          {deal.competitor && <Chip tone="danger">vs {deal.competitor}</Chip>}
          {deal.partner && <Chip>via {deal.partner}</Chip>}
        </div>
      </div>

      {/* The numbers a review changes, each edited where it is (DECISIONS #96). */}
      <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-5 sm:p-5" data-testid="deal-facts">
        {(() => {
          const edit = (field: string, value: string | number | null, format?: "money" | "day") =>
            deal.archived_at ? (format === "money" ? fmtMoney(value as number | null) : format === "day" ? fmtDay(value as string | null) : (value ?? "—")) : (
              <InlineField accountId={id} entity="deal" id={deal.deal_id} field={field} value={value} version={deal.updated_at} format={format} testId={`deal-${field}`} />
            );
          return (
            <>
              <Stat label="Value" value={edit("tcv_usd", deal.tcv_usd, "money")} tone="accent" />
              <Stat label="Stage" value={edit("stage", deal.stage)} size="text" />
              <Stat label="Close date" value={edit("close_date", deal.close_date, "day")} size="text" sub={deal.fiscal_quarter ?? derived?.label ?? undefined} />
              <Stat label="Status" value={edit("status", deal.status)} size="text" />
              <Stat label="Owner" value={edit("owner", deal.owner)} size="text" />
            </>
          );
        })()}
      </div>

      {pending.length > 0 && (
        <Section title="Waiting on you" aside={<span>{pending.length} proposed</span>}>
          <ProposalReview accountId={id} proposals={proposalViews} />
        </Section>
      )}

      <Section id="next-step" title="Next step">
        <CommitmentPanel accountId={id} kind="deal" sourceId={dealId} source={deal} accountArchived={account.archived_at != null} />
        {deal.next_step ? (
          <div className="text-lead text-ink">
            {deal.archived_at ? deal.next_step : <InlineField accountId={id} entity="deal" id={deal.deal_id} field="next_step" value={deal.next_step} version={deal.updated_at} testId="deal-next_step" />}
          </div>
        ) : (
          <>
            {!waiverActive(deal, todayISO()) && <Empty>No next step agreed. This is the first thing a reviewer will ask about.</Empty>}
            <div className="mt-2">
              <NextStepWaiver accountId={id} deal={deal} />
            </div>
          </>
        )}
        {deal.notes && <p className="mt-3 whitespace-pre-wrap text-label text-ink-muted">{deal.notes}</p>}
      </Section>

      <Section title="Details">
        <ActionForm action={edit} trigger="Edit this deal" testId="deal-edit">
          <BaseVersion of={deal.updated_at} />
          <Field label="Name" wide>
            <input name="name" defaultValue={deal.name} required className={control} />
          </Field>
          <Field label="Stage">
            <select name="stage" defaultValue={deal.stage ?? ""} className={control}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <option key={s} value={s}>
                  {s} · {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={deal.status} className={control}>
              <option value="open">open</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
            </select>
          </Field>
          <Field label="Close date" hint="The quarter follows from this unless you set one.">
            <input name="close_date" type="date" defaultValue={deal.close_date ?? ""} className={control} />
          </Field>
          <Field label="Fiscal quarter">
            <input name="fiscal_quarter" defaultValue={deal.fiscal_quarter ?? ""} className={control} placeholder={derived?.label ?? "FY27 Q2"} />
          </Field>
          <Field label="TCV (USD)">
            <input name="tcv_usd" inputMode="numeric" defaultValue={deal.tcv_usd ?? ""} className={control} />
          </Field>
          <Field label="Owner">
            <input name="owner" defaultValue={deal.owner ?? ""} className={control} />
          </Field>
          <Field label="Competitor">
            <input name="competitor" defaultValue={deal.competitor ?? ""} className={control} />
          </Field>
          <Field label="Partner">
            <input name="partner" defaultValue={deal.partner ?? ""} className={control} />
          </Field>
          {/* Shown in the header, exported to CSV, and until now editable by
              nothing: only the report import could write it, so a value the
              report got wrong could be read and not corrected. */}
          <Field label="Architecture">
            <input name="architecture" defaultValue={deal.architecture ?? ""} className={control} />
          </Field>
          <Field label="Next step" wide>
            <textarea name="next_step" defaultValue={deal.next_step ?? ""} rows={2} className={control} />
          </Field>
          <Field label="Notes" wide>
            <textarea name="notes" defaultValue={deal.notes ?? ""} rows={3} className={control} />
          </Field>
        </ActionForm>
        {!isArchived && (
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
            {/* Until now the only way to correct this was to archive the deal
                and type it in again on the other account, which orphans its
                whole history: change_log is keyed to the deal id, and so is
                every play link and every meeting that cited it. */}
            {otherAccounts.length > 0 && (
              <ActionForm action={move} testId="deal-move" trigger="Move to another account" submitLabel="Move it">
                <Field label="Move this deal to" hint="Its id, its history and anything proposed for it come too. Plays on this account that cover it are unlinked." wide>
                  <select name="to_account_id" required defaultValue="" className={control}>
                    <option value="" disabled>
                      pick an account
                    </option>
                    {otherAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <ArchiveButton size="md" label="Archive this deal" what={deal.name} action={archiveRecord.bind(null, "deal", dealId)} />
              <span className="text-micro text-ink-muted">Hides it everywhere and rejects anything still proposed for it. The history below survives.</span>
            </div>
          </div>
        )}
      </Section>

      <Section id="plays" title="Plays that cover this" aside={<span>{plays.length}</span>}>
        {plays.length === 0 ? (
          <Empty>No play links to this deal yet. Draft a plan on the account, or link it from a play.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {plays.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0">
                  <Link href={`/accounts/${id}/plays/${p.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                    {p.title}
                  </Link>
                  {p.next_step && <span className="ml-2 text-micro text-ink-muted">{p.next_step}</span>}
                </span>
                <Chip tone={PLAY_TONE[p.status] ?? "neutral"}>{p.archived_at ? "archived" : playStatusLabel(p.status)}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="meetings" title="Meetings that moved it" aside={<span>{meetings.length}</span>}>
        {meetings.length === 0 ? (
          <Empty>Nothing on this deal has come out of a meeting's notes yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {meetings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <Link href={`/accounts/${id}/meetings/${m.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {m.title}
                </Link>
                <span className="text-micro tabular-nums text-ink-muted">{fmtDay(m.held_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {mergedInDeals.length > 0 && (
        <Section title="Merged in" aside={<span>{mergedInDeals.length}</span>}>
          <ul className="divide-y divide-line">
            {mergedInDeals.map((d) => (
              <li key={d.deal_id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                <Link href={`/accounts/${id}/deals/${encodeURIComponent(d.deal_id)}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {d.name}
                </Link>
                <span className="text-micro tabular-nums text-ink-muted">{crmIdText(d.deal_id) ?? "no CRM id"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="history" title="History" aside={<span>{historyCountText(history.length, historyTotal)}</span>}>
        {history.length === 0 ? (
          <Empty>Nothing has changed since this deal was created.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-baseline">
                <div className="text-label font-medium text-ink">{h.field.replace(/_/g, " ")}</div>
                <div className="min-w-0 text-label">
                  {/* The merge rows are statements, not before-and-after. */}
                  {MERGE_FIELDS.has(h.field) ? (
                    <span className="text-ink">{h.new_value}</span>
                  ) : (
                    <>
                      <span className="text-ink-faint line-through">{logValueText(h.old_value)}</span>
                      <span aria-hidden className="mx-1.5 text-ink-faint">
                        →
                      </span>
                      <span className="text-ink">{logValueText(h.new_value)}</span>
                    </>
                  )}
                </div>
                <div className="text-micro tabular-nums text-ink-muted sm:text-right">
                  {fmtWhen(h.created_at)}
                  {h.proposal_id ? " · accepted" : ""}
                  {h.entity_id !== dealId ? ` · as ${h.entity_id}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
