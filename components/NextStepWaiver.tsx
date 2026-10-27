import Link from "next/link";
import { addDays, todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { waiverActive, type WaivableDeal } from "@/lib/deals/nextStep";
import { clearWaiverAction, waiveNextStepAction } from "@/app/deals/actions";
import { ActionForm } from "./ActionForm";
import { ResultButton } from "./ResultButton";
import { Field, control } from "./ui";

type Deal = WaivableDeal & { deal_id: string; next_step_waived_reason?: string | null };

// "Not needed…" beside a missing next step: a reason, and either until a day
// (it asks again then) or informational while the deal stands (it asks again
// when the deal moves). Shown as acknowledged, with Undo, once set.
export function NextStepWaiver({ accountId, deal, compact = false, link = false }: { accountId: string; deal: Deal; compact?: boolean; link?: boolean }) {
  const today = todayISO();
  if (deal.status !== "open" || deal.next_step?.trim()) return null;
  if (waiverActive(deal, today)) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-ink-muted" data-testid="next-step-waived">
        <span>
          No next step needed{deal.next_step_waived === "until" && deal.next_step_waived_until ? ` until ${fmtDay(deal.next_step_waived_until)}` : " while it stands"}
          {deal.next_step_waived_reason ? `: ${deal.next_step_waived_reason}` : ""}
        </span>
        {!compact && <ResultButton run={clearWaiverAction.bind(null, accountId, deal.deal_id)} testId="next-step-waiver-undo">Undo</ResultButton>}
      </span>
    );
  }
  // In a long list, a link to the deal's own form: a form on every row is
  // most of the page's weight and is used on one row at a time.
  if (link)
    return (
      <Link href={`/accounts/${accountId}/deals/${encodeURIComponent(deal.deal_id)}#next-step`} className="text-micro font-semibold text-accent hover:underline" data-testid="next-step-waive-link">
        Not needed…
      </Link>
    );
  return (
    <ActionForm action={waiveNextStepAction.bind(null, accountId, deal.deal_id)} trigger="Not needed…" submitLabel="Acknowledge" testId={compact ? undefined : "next-step-waive"}>
      <Field label="Why no next step is needed" wide>
        <input name="reason" required maxLength={300} className={control} placeholder="e.g. waiting on their budget vote" />
      </Field>
      <fieldset className="basis-full space-y-1 text-label">
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="until" defaultChecked className="accent-accent" /> Until
          <input type="date" name="until" defaultValue={addDays(today, 30)} min={today} className={`${control} w-auto`} />
          <span className="text-micro text-ink-muted">then it asks again</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="info" className="accent-accent" /> Informational: don&rsquo;t ask while the deal stands
        </label>
        <p className="text-micro text-ink-muted">Either way it asks again if the stage, close date or status changes.</p>
      </fieldset>
    </ActionForm>
  );
}
