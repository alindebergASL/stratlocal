// What research should look for on an account, from its playbook: the
// archetype's open questions, what qualification still lacks, and whether its
// budget timing is known. It goes to the model that writes the note from
// research already done (Bedrock), never to the web search (DECISIONS #3, #84).
import { getAccount } from "../queries/accounts";
import { currentPlaybook } from "./store";
import { archetypeOf } from "./archetype";
import { qualificationGaps, scorecard } from "./qualification";
import { MEDDPICC_LABELS } from "./schema";

export function researchSteer(accountId: string): string | null {
  const playbook = currentPlaybook({ accountId })?.playbook;
  const account = getAccount(accountId);
  if (!playbook || !account) return null;
  const archetype = archetypeOf(playbook, account.archetype_id ?? null);
  const questions = archetype ? playbook.questions.filter((q) => q.archetypes.includes(archetype.id)).map((q) => q.text).slice(0, 5) : [];
  const gaps = qualificationGaps(scorecard(account)).map((g) => MEDDPICC_LABELS[g]);
  const parts = [
    "The seller's own playbook, as things to look for in the research (steering only, never evidence, never cited):",
    archetype ? `- They believe this organisation is "${archetype.name}": ${archetype.posture || archetype.pain}. Note anything that supports or contradicts that.` : null,
    ...questions.map((q) => `- Open question: ${q}`),
    gaps.length ? `- Still unknown about the deal: ${gaps.join(", ")}. Note anything public that bears on them (who holds the budget, how decisions are made, stated priorities).` : null,
    account.fiscal_year_start_month || account.budget_calendar ? "- Their budget timing is on file; note anything that changes it." : "- Their budget timing is not on file: when their fiscal year starts and when budgets are approved.",
  ].filter((x): x is string => !!x);
  return parts.join("\n");
}
