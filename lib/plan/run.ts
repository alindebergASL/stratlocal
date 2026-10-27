import { db } from "../db";
import { BudgetError, runDetached, startRun } from "../ai/guard";
import { captureBaseline, createProposalBatch } from "../proposals/apply";
import { buildContextPack, evidenceIds } from "../meetings/contextPack";
import { getAccount, listContacts, listDeals, listPlays } from "../queries/accounts";
import { planReadiness } from "../ai/readiness";
import { researchForPrompt } from "../research/notes";
import { customerDocsForPrompt } from "../documents/customer";
import { generatePlanDraft } from "./draft";
import { directionForPrompt } from "../teamDirection";
import { playbookForPrompt } from "../playbook/prompt";
import { diffPlanDraft } from "./diffPlanDraft";

export type PlanDraftRunResult = {
  batchId: string;
  proposals: number;
  superseded: number;
  attempts: number;
};

export function startPlanDraftRun(accountId: string, userId: string): string {
  const account = getAccount(accountId);
  if (!account) throw new BudgetError("That account no longer exists.");
  // The same check the button uses, so the reason is on screen before the
  // press rather than arriving as a 429 after it.
  const notReady = planReadiness(accountId);
  if (notReady) throw new BudgetError(notReady);

  const run = startRun({
    role: "plan_draft",
    accountId,
    userId,
    inputSummary: `account ${accountId}`,
  });
  runDetached(run.id, async (stages): Promise<PlanDraftRunResult> => {
    const still = getAccount(accountId);
    if (!still) throw new Error("account no longer exists");
    // Before the model reads the account; see captureBaseline.
    const baseline = captureBaseline(accountId);
    const pack = buildContextPack(accountId);
    const { draft, attempts } = await generatePlanDraft(
      {
        pack,
        ids: evidenceIds(pack),
        researchBlock: [researchForPrompt(accountId), customerDocsForPrompt(accountId)].filter(Boolean).join("\n\n"),
        direction: [directionForPrompt(), playbookForPrompt(accountId)].filter(Boolean).join("\n\n"),
      },
      stages,
    );
    const state = {
      account: still,
      // Archived plays included on purpose; see PlanState.
      plays: listPlays(accountId, { includeArchived: true }),
      liveDealIds: new Set(listDeals(accountId).map((d) => d.deal_id)),
      liveContactIds: new Set(listContacts(accountId).map((c) => c.id)),
    };
    const drafts = diffPlanDraft(draft, state);

    // A second draft would otherwise sit beside the first: this diff can see
    // the plays table but not pending create-play proposals, and the
    // rejected-draft dedupe compares payload bytes and only catches rejected
    // ones. Two runs phrased differently would give two plays with one title.
    //
    // Replaced in one transaction, so there is never a moment with the old
    // draft gone and the new one not yet filed.
    const { superseded, batch } = db().transaction(() => ({
      superseded: supersedePendingPlanDrafts(accountId),
      batch: createProposalBatch(accountId, { kind: "plan_draft", id: null, aiRunId: run.id }, drafts, { baseline }),
    }))();
    return {
      batchId: batch.batchId,
      proposals: batch.ids.length,
      superseded,
      attempts,
    };
  });
  return run.id;
}

// Research updates and Ask's proposals are their own batches, not drafts of
// the plan, and a new draft leaves them waiting.
//
// Superseded by a newer draft is not refused by a person. It is recorded with
// no decider, and the "someone already said no to exactly this" dedupe only
// counts a rejection somebody made — otherwise regenerating an unchanged plan
// marked the first draft rejected and then refused every identical
// suggestion in the second as already turned down, leaving nothing.
export function supersedePendingPlanDrafts(accountId: string): number {
  const info = db()
    .prepare(
      `UPDATE proposals SET status = 'rejected', decided_by = NULL, decided_at = ?
       WHERE account_id = ? AND status = 'pending' AND origin_kind = 'plan_draft' AND (origin_id IS NULL OR (origin_id NOT IN ('research_updates', 'research_people') AND origin_id NOT LIKE 'ask:%' AND origin_id NOT LIKE 'mail:%' AND origin_id NOT LIKE 'playbook_%'))`,
    )
    .run(Date.now(), accountId);
  return info.changes;
}

export { BudgetError };
