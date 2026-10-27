// Budget timing found by research, offered as a change to the account's
// fiscal year and budget calendar. A proposal like any other: it quotes the
// finding it rests on and changes nothing until a person accepts it.
import { createProposalBatch } from "../proposals/apply";
import { getAccount } from "../queries/accounts";
import type { ResearchNote } from "../research/schema";

export const BUDGET_ORIGIN = "playbook_budget";

export function proposeBudgetTiming(accountId: string, documentId: string, note: ResearchNote): number {
  const b = note.budget;
  const account = getAccount(accountId);
  if (!b || !account) return 0;
  const finding = note.findings[b.finding];
  if (!finding) return 0;
  const payload: Record<string, unknown> = {};
  if (b.fiscal_year_start_month && b.fiscal_year_start_month !== account.fiscal_year_start_month) payload.fiscal_year_start_month = b.fiscal_year_start_month;
  if (b.calendar && b.calendar.trim() !== (account.budget_calendar ?? "").trim()) payload.budget_calendar = b.calendar.trim();
  if (!Object.keys(payload).length) return 0;
  const batch = createProposalBatch(accountId, { kind: "plan_draft", id: BUDGET_ORIGIN, aiRunId: null }, [
    {
      entity_type: "account",
      op: "update",
      entity_id: accountId,
      payload,
      rationale: "Research found when their money is set.",
      source_ref: { kind: "research", id: documentId, quote: finding.quote.slice(0, 1000), finding_index: b.finding },
    },
  ]);
  return batch.ids.length;
}
