import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { todayISO } from "@/lib/clock";
import { needsNextStep, waiverActive } from "@/lib/deals/nextStep";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listDeals } from "@/lib/queries/accounts";
import { fmtMoneyShort, STAGE_LABELS } from "@/lib/format";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionForm } from "@/components/ActionForm";
import { DealTable } from "@/components/DealTable";
import { ExportCsv } from "@/components/ExportCsv";
import { control, Field, Section } from "@/components/ui";
import { saveDeal } from "@/app/actions";

export const dynamic = "force-dynamic";

// Caps, not pagination: the rest are one link away on the pipeline, which
// lists every deal of an account with the same rows (DECISIONS #20).
const DEALS_SHOWN = 50;
const CLOSED_DEALS_SHOWN = 10;

export default async function AccountDealsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ next?: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  if (account.kind === "own_work") redirect("/follow-ups");
  const nextFilter = (await searchParams).next;
  const onlyBare = nextFilter === "none";
  const onlyAck = nextFilter === "ack";
  const today = todayISO();

  const deals = listDeals(id);
  const open = deals.filter((d) => d.status === "open");
  const closed = deals.filter((d) => d.status !== "open");
  const bare = open.filter((d) => needsNextStep(d, today));
  const acknowledged = open.filter((d) => !d.next_step?.trim() && waiverActive(d, today));
  const shown = onlyBare ? bare : onlyAck ? acknowledged : open;
  const total = open.reduce((s, d) => s + (d.tcv_usd ?? 0), 0);
  const base = `/accounts/${id}/deals`;

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="deals" />

      <Section
        id="deals"
        title={onlyBare ? "Open deals with no next step" : onlyAck ? "Open deals where no next step is needed" : "Open deals"}
        aside={
          <>
            <span className="font-semibold tabular-nums text-ink">{fmtMoneyShort(total)}</span>
            <span>{open.length} open</span>
            <span>
              {open.length - bare.length - acknowledged.length} of {open.length} with a next step
            </span>
            {acknowledged.length > 0 && (
              <Link href={onlyAck ? base : `${base}?next=ack`} className="font-semibold text-accent hover:underline" data-testid="deals-filter-ack">
                {onlyAck ? "Show all" : `${acknowledged.length} acknowledged`}
              </Link>
            )}
            {bare.length > 0 && (
              <Link href={onlyBare ? base : `${base}?next=none`} className="font-semibold text-accent hover:underline" data-testid="deals-filter-bare">
                {onlyBare ? "Show all" : `Only the ${bare.length} without one`}
              </Link>
            )}
            {/* Beside the export, because they are the same door in two
                directions and this is the list the rows land in. */}
            <Link href={`/accounts/${id}/import-sheet`} className="text-micro font-semibold text-accent hover:underline" data-testid="import-sheet">
              Import CSV
            </Link>
            <ExportCsv accountId={id} what="deals" />
          </>
        }
      >
        <DealTable accountId={id} deals={shown} max={DEALS_SHOWN} moreHref={`/pipeline?account=${id}`} />
        {closed.length > 0 && (
          <details id="closed-deals" className="mt-4">
            <summary className="cursor-pointer text-label text-ink-muted hover:text-ink">Won and lost ({closed.length})</summary>
            <div className="mt-2">
              {/* The list that only ever grows: capped, with the rest on the
                  pipeline, where closed deals have somewhere real to go. */}
              <DealTable accountId={id} deals={closed} max={CLOSED_DEALS_SHOWN} moreHref={`/pipeline?account=${id}&status=closed`} moreLabel={(n) => `${n} more won and lost`} />
            </div>
          </details>
        )}
        <div className="mt-4">
          <ActionForm action={saveDeal.bind(null, id, null)} testId="deal-new" trigger="Add deal" submitLabel="Add deal">
            {/* Not required: the import matches deals by id alone, so an
                invented id became a second row when the real one arrived. */}
            <Field label="Deal ID" hint="The CRM opportunity id. Leave it blank if you do not have one yet — importing the report will bring it." wide>
              <input name="deal_id" className={control} placeholder="blank is fine" />
            </Field>
            <Field label="Name" wide>
              <input name="name" required className={control} />
            </Field>
            <Field label="Stage">
              <select name="stage" className={control} defaultValue="">
                <option value="">—</option>
                {[1, 2, 3, 4, 5, 6].map((s) => (
                  <option key={s} value={s}>
                    {s} · {STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Close date">
              <input name="close_date" type="date" className={control} />
            </Field>
            <Field label="TCV (USD)">
              <input name="tcv_usd" inputMode="numeric" className={control} />
            </Field>
            <Field label="Competitor">
              <input name="competitor" className={control} />
            </Field>
            <Field label="Partner">
              <input name="partner" className={control} />
            </Field>
            <Field label="Owner">
              <input name="owner" className={control} />
            </Field>
            <Field label="Next step" wide>
              <input name="next_step" className={control} />
            </Field>
          </ActionForm>
        </div>
      </Section>
    </Page>
  );
}
