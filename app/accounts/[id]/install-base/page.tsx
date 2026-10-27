import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listInstallBaseSnapshots } from "@/lib/queries/accounts";
import { fmtMoney } from "@/lib/format";
import { todayISO } from "@/lib/clock";
import { Page } from "@/components/Nav";
import { BaseVersion, Breadcrumb, ButtonLink, control, Empty, Field, PageHeader, Section } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { ArchiveButton } from "@/components/ArchiveButton";
import { archiveRecord, restoreRecord, saveInstallBase } from "@/app/actions";

export const dynamic = "force-dynamic";

// Older snapshots, capped. The newest is the one you curate; the rest are
// there to be read, and a year of quarterly reports is four of them (DECISIONS
// #20 — the way to the rest is a parameter, not a disclosure that ships the
// rows anyway).
const SNAPSHOTS_SHOWN = 4;

// The install base, curated.
//
// This was the last record in the app with no manual path of any kind: no
// form, no server action, no archive. The report import was the only writer,
// so a figure the model misread from a report table was permanent — and the
// trend on the account page is read off it.
//
// It gets a page rather than controls on the account page for the reason the
// play page gives: a closed ActionForm still serialises its children into the
// payload, so a form per row would be paid for on every account-page load by
// everyone who never opens one. Here there is one account's worth of rows on a
// screen whose whole subject is them.
//
// It is also the only place the stored history is visible. The UNIQUE
// constraint has kept a snapshot per date since Phase 1, and the account page
// shows the newest and compares it with the one before — so on an account with
// a year of reports, most of what is on file has never been on a screen.
export default async function InstallBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string; edit?: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();

  const q = await searchParams;
  const showAll = q.all === "1";
  const live = listInstallBaseSnapshots(id);
  // One snapshot carries the edit forms, and it is the newest unless you say
  // otherwise.
  //
  // Measured before this was a parameter: a form per row on every snapshot put
  // this page at 570 KB against a fixture of twenty snapshots of twenty-five
  // families, which is the heaviest page in the app — because a closed
  // ActionForm still serialises its children into the payload. That is the
  // exact cost this page exists to keep off the account page, reproduced one
  // level down. Editable is now bounded by the number of families in one
  // snapshot rather than by the whole history (DECISIONS #20).
  const editable = q.edit && live.some((s) => s.asOf === q.edit) ? q.edit : (live[0]?.asOf ?? null);
  const archived = listInstallBaseSnapshots(id, { includeArchived: true })
    .flatMap((s) => s.rows)
    .filter((r) => r.archived_at != null);
  const shown = showAll ? live : live.slice(0, SNAPSHOTS_SHOWN);
  const hidden = live.length - shown.length;
  const today = todayISO();

  return (
    <Page user={user}>
      <Breadcrumb accountId={id} accountName={account.name} page="Install base" />
      <PageHeader
        title="Install base"
        sub={
          live.length === 0
            ? "What they already own, by product family. A snapshot arrives with an imported report, or you can write one down here."
            : `What they already own, by product family, in ${live.length} dated snapshot${live.length === 1 ? "" : "s"}. The newest is what the account page compares against.`
        }
      />

      <Section
        title="Add a line"
        aside={<span className="text-micro text-ink-muted">Dated, because the trend is read off the date</span>}
      >
        <ActionForm
          action={saveInstallBase.bind(null, id, null)}
          testId="install-base-new"
          trigger="Add a line"
          className="animate-rise flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunk p-3"
        >
          {/* Defaulting to the newest snapshot's date makes the common case —
              a family the report missed — one action, and starting a snapshot
              by hand the same control with a different date. */}
          <Field label="Snapshot date">
            <input name="as_of" type="date" required defaultValue={live[0]?.asOf ?? today} max={today} className={control} data-testid="ib-as-of" />
          </Field>
          <Field label="Product family" wide>
            <input name="product_family" required className={control} data-testid="ib-family" />
          </Field>
          <Field label="Value">
            <input name="value_usd" placeholder="4.1M" className={control} data-testid="ib-value" />
          </Field>
          <Field label="Share %">
            <input name="share_pct" placeholder="34" className={control} data-testid="ib-share" />
          </Field>
          <Field label="Note" wide>
            <input name="role_note" className={control} />
          </Field>
        </ActionForm>
      </Section>

      {live.length === 0 ? (
        <Section title="Snapshots">
          <Empty>Nothing on file yet.</Empty>
        </Section>
      ) : (
        shown.map((snap, i) => (
          <Section
            key={snap.asOf}
            title={snap.asOf}
            aside={
              <span className="tabular-nums">
                {snap.rows.length} famil{snap.rows.length === 1 ? "y" : "ies"} · {fmtMoney(snap.rows.reduce((n, r) => n + (r.value_usd ?? 0), 0))}
                {i === 0 ? " · newest" : ""}
                {snap.asOf !== editable && (
                  <Link
                    href={`/accounts/${id}/install-base?${showAll ? "all=1&" : ""}edit=${snap.asOf}`}
                    className="font-semibold text-accent hover:underline"
                    data-testid={`ib-edit-snapshot-${snap.asOf}`}
                  >
                    Correct this one
                  </Link>
                )}
              </span>
            }
          >
            <ul className="divide-y divide-line">
              {snap.rows.map((r) => (
                <li key={r.id} className="py-2" data-testid="ib-row">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{r.product_family}</div>
                      {r.role_note && <div className="text-micro text-ink-muted">{r.role_note}</div>}
                    </div>
                    <div className="flex items-baseline gap-4 tabular-nums">
                      <span className="font-semibold">{fmtMoney(r.value_usd)}</span>
                      <span className="w-16 text-right text-ink-muted">{r.share_pct === null ? "—" : `${r.share_pct.toFixed(1)}%`}</span>
                    </div>
                  </div>
                  {snap.asOf === editable && (
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <ActionForm
                      action={saveInstallBase.bind(null, id, r.id)}
                      testId={`ib-edit-${r.id}`}
                      trigger="Edit"
                      className="animate-rise flex w-full flex-wrap items-end gap-3 rounded-lg bg-surface-sunk p-3"
                    >
                      <BaseVersion of={r.updated_at} />
                      {/* The date is not editable here. Moving a line from one
                          snapshot to another is not a correction, it is a
                          different claim about when the account looked like
                          that, and it would silently change what the trend
                          compares. A line filed under the wrong date is
                          archived and added again under the right one. */}
                      <Field label="Product family" wide>
                        <input name="product_family" defaultValue={r.product_family} required className={control} />
                      </Field>
                      <Field label="Value">
                        <input name="value_usd" defaultValue={r.value_usd ?? ""} className={control} />
                      </Field>
                      <Field label="Share %">
                        <input name="share_pct" defaultValue={r.share_pct ?? ""} className={control} />
                      </Field>
                      <Field label="Note" wide>
                        <input name="role_note" defaultValue={r.role_note ?? ""} className={control} />
                      </Field>
                    </ActionForm>
                    <ArchiveButton what={`${r.product_family} on ${r.as_of}`} size="sm" action={archiveRecord.bind(null, "install_base", r.id)} />
                  </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}

      {hidden > 0 && (
        <p className="mt-3 text-label">
          <ButtonLink href={`/accounts/${id}/install-base?all=1`} variant="quiet" data-testid="ib-all">
            {hidden} older snapshot{hidden === 1 ? "" : "s"}
          </ButtonLink>
        </p>
      )}

      {archived.length > 0 && (
        <Section title="Archived lines" aside={<span className="tabular-nums">{archived.length}</span>}>
          <ul className="divide-y divide-line">
            {archived.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span className="text-ink-muted">
                  {r.product_family} · {r.as_of} · {fmtMoney(r.value_usd)}
                </span>
                <ArchiveButton mode="restore" size="sm" action={restoreRecord.bind(null, "install_base", r.id)} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
