import { parseReport } from "@/lib/ask/report";
import { isCustomerDoc } from "@/lib/documents/customer";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listUsers, requirePageUser } from "@/lib/auth";
import { getAccount, installBaseTrend, listAccountChoices, listArchivedDocuments, listDeals, listDocuments, listPlays } from "@/lib/queries/accounts";
import { previewAccountMerge, previewAccountUnmerge } from "@/lib/proposals/mergeAccount";
import type { DocumentRow } from "@/lib/db";
import { listArchived } from "@/lib/queries/meetings";
import { listMergeReceipts, previewUnmerge } from "@/lib/proposals/unmerge";
import { fmtMoney, fmtMoneyShort, fmtWhen } from "@/lib/format";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionForm } from "@/components/ActionForm";
import { ArchiveButton } from "@/components/ArchiveButton";
import { ArchivedBlock, type ArchivedGroup } from "@/components/ArchivedBlock";
import { BaseVersion, Button, Chip, control, Empty, Field, Section, Stat } from "@/components/ui";
import { archiveDocumentRecord, archiveRecord, restoreRecord, updateAccount } from "@/app/actions";
import { mergeAccountsAction, unmergeAccountAction, unmergeAction } from "@/app/mergeActions";

export const dynamic = "force-dynamic";

// A research note's own title if it has one, the filename otherwise.
function documentLabel(d: DocumentRow): string {
  if (d.kind === "research_note" && d.meta_json) {
    try {
      const title = (JSON.parse(d.meta_json) as { title?: string }).title;
      if (title) return title;
    } catch {
      // A meta blob that will not parse just means we show the filename.
    }
  }
  return d.filename;
}

const MERGE_NOUN: Record<string, string> = { contact: "Person", deal: "Deal", play: "Play", meeting: "Meeting", account: "Account" };

// Everything about the account that is reference rather than work: what
// they run, what was imported, what was archived or merged, and the
// account's own fields.
export default async function AccountDetailsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ merge?: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  if (account.kind === "own_work") redirect("/follow-ups");
  const mergeWith = (await searchParams).merge ?? null;
  const isArchived = account.archived_at != null;
  const installBase = installBaseTrend(id);
  const documents = listDocuments(id, { kinds: ["agent_report", "handoff", "other"] });
  const archived = listArchived(id);
  const archivedDocuments = listArchivedDocuments(id);
  const owners = listUsers().map((u) => ({ id: u.id, name: u.display_name }));
  const merges = isArchived
    ? []
    : listMergeReceipts(id).map((r) => {
        if (r.entityType !== "account") return { ...r, preview: previewUnmerge({ accountId: id, receiptId: r.id }), undo: unmergeAction.bind(null, id, r.id) };
        const p = previewAccountUnmerge(id, r.id);
        // The same shape as a record merge's preview, said for an account.
        const preview = p.ok ? { ok: true as const, loserReturns: true, restores: p.returns, keptAsIs: p.keptAsIs, digest: p.digest } : p;
        return { ...r, preview, undo: unmergeAccountAction.bind(null, id, r.id) };
      });
  const others = isArchived ? [] : listAccountChoices().filter((a) => a.id !== id);
  const mergePreview = mergeWith && !isArchived ? previewAccountMerge(id, mergeWith) : null;
  const openDeals = listDeals(id).filter((d) => d.status === "open");
  const openPipeline = openDeals.reduce((s, d) => s + (d.tcv_usd ?? 0), 0);
  const noThesisOrPlays = !account.thesis && listPlays(id).length === 0;
  const archivedGroups: ArchivedGroup[] = [
    { kind: "deal", label: "Deals", items: archived.deals },
    { kind: "contact", label: "Contacts", items: archived.contacts },
    { kind: "play", label: "Plays", items: archived.plays },
    { kind: "meeting", label: "Meetings", items: archived.meetings },
    { kind: "action_item", label: "Follow-ups", items: archived.action_items },
    { kind: "document", label: "Documents", items: archivedDocuments.map((d) => ({ id: d.id, label: documentLabel(d) })) },
  ];

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="details" />

      <Section id="account-details" title="Account details">
        {/* Auto-fit rather than a fixed number of columns, so a label never
            breaks mid-word in a narrow column. */}
        <dl className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-4">
          <Stat label="CRM ID" value={account.crm_id ?? "—"} size="text" />
          <Stat label="Open pipeline" value={fmtMoneyShort(openPipeline)} sub={`${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"}`} />
          <Stat label="Legal entity" value={account.legal_entity ?? "—"} size="text" />
          <Stat label="Headquarters" value={account.hq ?? "—"} size="text" />
        </dl>
        <ActionForm action={updateAccount.bind(null, id)} testId="account-edit" trigger="Edit account" open={noThesisOrPlays}>
          <BaseVersion of={account.updated_at} />
          <Field label="Name">
            <input name="name" defaultValue={account.name} required className={control} />
          </Field>
          <Field label="CRM ID">
            <input name="crm_id" defaultValue={account.crm_id ?? ""} className={control} />
          </Field>
          <Field label="Legal entity">
            <input name="legal_entity" defaultValue={account.legal_entity ?? ""} className={control} />
          </Field>
          <Field label="Region">
            <input name="region" defaultValue={account.region ?? ""} className={control} />
          </Field>
          <Field label="Segment">
            <input name="segment" defaultValue={account.segment ?? ""} className={control} />
          </Field>
          <Field label="HQ">
            <input name="hq" defaultValue={account.hq ?? ""} className={control} />
          </Field>
          {/* Blank is a real answer and the default: an account the two of
              you work together is common. */}
          <Field label="Runs this account">
            <select name="owner_user_id" defaultValue={account.owner_user_id ?? ""} className={control}>
              <option value="">Both of us</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account thesis (where we are, where we want to be)" wide>
            <textarea name="thesis" defaultValue={account.thesis ?? ""} rows={3} className={control} />
          </Field>
        </ActionForm>
        {!isArchived && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <ArchiveButton size="md" label="Archive this account" action={archiveRecord.bind(null, "account", id)} />
            <span className="text-micro text-ink-muted">Hides it everywhere and rejects anything still proposed for it. Nothing is deleted.</span>
          </div>
        )}
      </Section>

      <Section
        id="install-base"
        title="Install base"
        aside={
          <>
            {installBase.asOf && (
              <span>
                as of {installBase.asOf}
                {installBase.previousAsOf ? ` · was ${installBase.previousAsOf}` : ""}
              </span>
            )}
            {/* Editing lives on its own page: a closed form still ships its
                children, and a form per family would be paid for by everyone. */}
            <Link href={`/accounts/${id}/install-base`} className="font-semibold text-accent hover:underline" data-testid="install-base-page">
              Edit or add a line
            </Link>
          </>
        }
      >
        {installBase.rows.length === 0 ? (
          <Empty>
            No install base yet. It arrives with an imported report, or{" "}
            <Link href={`/accounts/${id}/install-base`} className="font-semibold text-accent hover:underline">
              write one down
            </Link>
            .
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {installBase.rows.map((r) => {
              const delta = r.previous_value_usd === null || r.value_usd === null ? null : r.value_usd - r.previous_value_usd;
              const shareMoved = r.previous_share_pct !== null && r.share_pct !== null && Math.abs(r.share_pct - r.previous_share_pct) >= 0.05;
              return (
                <li key={r.id} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-baseline">
                  <div>
                    <div className="font-medium text-ink">
                      {r.product_family}
                      {r.gone && <span className="ml-2 text-micro font-normal text-ink-muted">not in this report</span>}
                    </div>
                    {r.role_note && <div className="text-micro text-ink-muted">{r.role_note}</div>}
                  </div>
                  {/* A family the latest report does not list is unknown, not
                      zero: its last reported value, greyed, with no change. */}
                  <div className={`tabular-nums sm:text-right ${r.gone ? "text-ink-faint" : "font-semibold"}`}>{r.gone ? fmtMoney(r.previous_value_usd) : fmtMoney(r.value_usd)}</div>
                  <div className={`w-24 tabular-nums sm:text-right ${r.gone || delta === null || delta === 0 ? "text-ink-faint" : delta > 0 ? "text-positive" : "text-danger"}`}>
                    {r.gone ? "last reported" : delta === null ? (installBase.previousAsOf ? "new" : "") : delta === 0 ? "—" : `${delta > 0 ? "+" : "−"}${fmtMoney(Math.abs(delta))}`}
                  </div>
                  <div className="w-28 tabular-nums text-ink-muted sm:text-right">
                    {r.share_pct === null ? (
                      "—"
                    ) : shareMoved ? (
                      <>
                        <span className="text-ink-faint">{r.previous_share_pct!.toFixed(1)}%</span>
                        <span aria-hidden className="mx-1 text-ink-faint">
                          →
                        </span>
                        <span className={r.share_pct >= r.previous_share_pct! ? "text-positive" : "text-danger"}>{r.share_pct.toFixed(1)}%</span>
                      </>
                    ) : (
                      `${r.share_pct.toFixed(1)}%`
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        id="documents"
        title="Documents"
        aside={
          <>
            <Link href={`/accounts/${id}/import`} className="font-semibold text-accent hover:underline">
              Import a report or document
            </Link>
            <Link href={`/accounts/${id}/import-sheet`} className="font-semibold text-accent hover:underline">
              Import spreadsheet
            </Link>
          </>
        }
      >
        {documents.length === 0 ? (
          <Empty>No documents yet. Import an account plan report exported from your sales tool.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Chip>{parseReport(d) ? "report" : isCustomerDoc(d) ? "their document" : d.kind.replace("_", " ")}</Chip>
                  {parseReport(d) ? (
                    <Link href={`/reports/${d.id}`} className="truncate font-medium text-ink hover:text-accent">{d.filename}</Link>
                  ) : isCustomerDoc(d) ? (
                    <Link href={`/accounts/${id}/documents/${d.id}`} className="truncate font-medium text-ink hover:text-accent">{d.filename}</Link>
                  ) : (
                    <span className="truncate font-medium text-ink">{d.filename}</span>
                  )}
                  <span className="text-micro tabular-nums text-ink-muted">{fmtWhen(d.created_at)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {d.storage_path && (
                    <a href={`/api/documents/${d.id}/original`} className="text-micro text-accent hover:underline">
                      original
                    </a>
                  )}
                  <ArchiveButton what={documentLabel(d)} action={archiveDocumentRecord.bind(null, d.id)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ArchivedBlock groups={archivedGroups} restore={restoreRecord} />

      {!isArchived && others.length > 0 && (
        <Section id="merge-account" title="Same customer as another account?">
          <p className="mb-3 text-label text-ink-muted">
            Merge another account into this one: its people, deals, plays, meetings, follow-ups, install base and documents move here, blank fields here are filled from it,
            and it is archived and points here. Nothing is overwritten, and it can be undone.
          </p>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <Field label="Account to merge in">
              <select name="merge" defaultValue={mergeWith ?? ""} className={control} required>
                <option value="" disabled>
                  Choose an account
                </option>
                {others.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" variant="quiet" data-testid="account-merge-preview">
              See what it would do
            </Button>
          </form>
          {mergePreview && !mergePreview.ok && (
            <p className="mt-3 text-label text-warning" role="alert">
              {mergePreview.why}
            </p>
          )}
          {mergePreview?.ok && (
            <div className="mt-4 rounded-lg border border-line p-3 text-label" data-testid="account-merge-plan">
              <p className="font-semibold text-ink-strong">Merging &ldquo;{mergePreview.loserName}&rdquo; into {account.name}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>{mergePreview.counts.length ? `Moves ${mergePreview.counts.map((c) => `${c.n} ${c.noun}`).join(", ")}.` : "It has no records to move."}</li>
                {mergePreview.fills.length > 0 && <li>Fills {mergePreview.fills.join(", ")} here, where this account has nothing.</li>}
                {mergePreview.notCarried.map((n) => (
                  <li key={n} className="text-warning">
                    Not carried: {n}.
                  </li>
                ))}
                {mergePreview.samePeople.length > 0 && (
                  <li>
                    {mergePreview.samePeople.join(", ")} {mergePreview.samePeople.length === 1 ? "is" : "are"} on both. They stay as two records; merge them from the person&rsquo;s page if they are the
                    same.
                  </li>
                )}
                <li>Its history stays filed under it, and &ldquo;{mergePreview.loserName}&rdquo; is archived and links here.</li>
              </ul>
              <div className="mt-3">
                <ActionForm action={mergeAccountsAction.bind(null, id, mergeWith!)} trigger={`Merge “${mergePreview.loserName}” into this account`} submitLabel="Merge accounts" testId="account-merge">
                  <p className="basis-full text-label">Everything listed above happens at once. It can be undone from Merges on this page.</p>
                </ActionForm>
              </div>
            </div>
          )}
        </Section>
      )}

      {merges.length > 0 && (
        <Section id="merges" title={`Merges (${merges.length})`}>
          <p className="mb-2 text-label text-ink-muted">
            Undoing a merge puts back what the merge changed. Anything changed since — by either of you, or by a later merge — stays as it is, and is listed before you press.
          </p>
          <ul className="divide-y divide-line" data-testid="merge-list">
            {merges.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-2.5">
                <div className="min-w-0 text-label">
                  <p className="text-ink [overflow-wrap:anywhere]">
                    <span className="text-micro text-ink-muted">{MERGE_NOUN[m.entityType]} · </span>
                    &ldquo;{m.loserLabel}&rdquo; merged into &ldquo;{m.keeperLabel}&rdquo;
                  </p>
                  <p className="text-micro text-ink-muted">
                    {fmtWhen(m.createdAt)}
                    {m.actorUserId ? ` · ${owners.find((o) => o.id === m.actorUserId)?.name ?? "one of you"}` : ""}
                  </p>
                </div>
                {m.preview.ok ? (
                  <ActionForm action={m.undo.bind(null, m.preview.digest)} trigger="Undo merge" submitLabel="Undo merge" testId="unmerge">
                    <p className="basis-full text-label">
                      {m.entityType === "account" ? (
                        <>&ldquo;{m.loserLabel}&rdquo; comes back as its own account, and {m.preview.restores} record{m.preview.restores === 1 ? "" : "s"} go back to it.</>
                      ) : (
                        <>
                          {m.preview.loserReturns ? <>&ldquo;{m.loserLabel}&rdquo; comes back as its own record, and </> : <>&ldquo;{m.loserLabel}&rdquo; was already archived before the merge and stays archived; </>}
                          {m.preview.restores} change{m.preview.restores === 1 ? "" : "s"} the merge made go back.
                        </>
                      )}
                    </p>
                    {m.preview.keptAsIs.length > 0 && (
                      <div className="basis-full text-label text-warning" data-testid="unmerge-kept">
                        <p>Changed since, so left as it is:</p>
                        <ul className="ml-4 list-disc">
                          {m.preview.keptAsIs.slice(0, 8).map((k) => (
                            <li key={k}>{k}</li>
                          ))}
                        </ul>
                        {m.preview.keptAsIs.length > 8 && <p>and {m.preview.keptAsIs.length - 8} more.</p>}
                      </div>
                    )}
                  </ActionForm>
                ) : (
                  <span className="text-micro text-ink-muted">{m.preview.why}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
