// Which of the playbook's archetypes an account is, suggested from what is
// on file and kept research, and accepted (or not) by a person. The
// suggestion is an ordinary proposal on the account, so it is reviewed like
// any other change and its history is the account's own (DECISIONS #69).
import { z } from "zod";
import { db } from "../db";
import { BudgetError, runDetached, startRun } from "../ai/guard";
import { runStructured } from "../ai/runStructured";
import { UNTRUSTED_RULES } from "../ai/prompts";
import { createProposalBatch } from "../proposals/apply";
import { getAccount } from "../queries/accounts";
import { buildContextPack, packForPrompt } from "../meetings/contextPack";
import { researchForPrompt } from "../research/notes";
import { currentPlaybook } from "./store";
import type { Playbook } from "./schema";

export const ARCHETYPE_ORIGIN = "playbook_archetype";

const Suggestion = z.object({
  archetype_id: z.string(),
  hypothesis: z.string().trim().min(1).max(600),
  why: z.string().trim().min(1).max(600),
});

export function archetypeOf(playbook: Playbook | null | undefined, id: string | null | undefined) {
  return id ? (playbook?.archetypes.find((a) => a.id === id) ?? null) : null;
}

/** The waiting suggestion for an account, if there is one. */
export function pendingArchetype(accountId: string): { id: string; archetypeId: string; hypothesis: string; why: string | null } | null {
  const r = db()
    .prepare(`SELECT id, payload_json, rationale FROM proposals WHERE account_id = ? AND origin_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)
    .get(accountId, ARCHETYPE_ORIGIN) as { id: string; payload_json: string; rationale: string | null } | undefined;
  if (!r) return null;
  const p = JSON.parse(r.payload_json) as { archetype_id?: string; archetype_hypothesis?: string };
  return p.archetype_id ? { id: r.id, archetypeId: p.archetype_id, hypothesis: p.archetype_hypothesis ?? "", why: r.rationale } : null;
}

/** Moves between archetypes, newest first, from the account's history. */
export function archetypeHistory(accountId: string): Array<{ from: string | null; to: string | null; at: number; by: string | null }> {
  return (
    db()
      .prepare(`SELECT old_value, new_value, created_at, actor_user_id FROM change_log WHERE account_id = ? AND entity_type = 'account' AND field = 'archetype_id' ORDER BY created_at DESC, rowid DESC LIMIT 20`)
      .all(accountId) as Array<{ old_value: string | null; new_value: string | null; created_at: number; actor_user_id: string | null }>
  ).map((r) => ({ from: unquote(r.old_value), to: unquote(r.new_value), at: r.created_at, by: r.actor_user_id }));
}
const unquote = (v: string | null) => {
  if (v == null) return null;
  try {
    const x = JSON.parse(v);
    return typeof x === "string" ? x : null;
  } catch {
    return v;
  }
};

export function startArchetypeSuggestion(accountId: string, userId: string | null, opts: { assistant?: "quarterly_refresh" } = {}): string {
  const account = getAccount(accountId);
  if (!account || account.archived_at) throw new BudgetError("Account missing or archived.");
  const playbook = currentPlaybook({ accountId })?.playbook;
  if (!playbook || playbook.archetypes.length === 0) throw new BudgetError("The playbook has no archetypes yet. Add them on the Playbook page first.");
  if (pendingArchetype(accountId)) throw new BudgetError("A suggestion is already waiting. Accept it or turn it down first.");
  const run = startRun({ role: "plan_draft", kind: "playbook_archetype", accountId, userId, inputSummary: "archetype from records and kept research", assistant: opts.assistant ?? null });
  runDetached(run.id, async (stages) => {
    const ids = new Set(playbook.archetypes.map((a) => a.id));
    const { data } = await runStructured({
      role: "plan_draft",
      stageName: "playbook_archetype",
      schema: Suggestion,
      stages,
      maxTokens: 1500,
      system: `You place one customer account in one of the team's playbook archetypes, and write the team's hypothesis about it: two sentences on what the team believes is true of this account and wants to test. Use only the records and kept research given; say what in them points to the archetype. If they do not support a clear choice, pick the closest and say what is missing. ${UNTRUSTED_RULES}`,
      user: [
        "The playbook's archetypes:",
        ...playbook.archetypes.map((a) => `- ${a.id}: ${a.name}. Posture: ${a.posture} Pain: ${a.pain}`),
        "",
        packForPrompt(buildContextPack(accountId)),
        researchForPrompt(accountId),
      ].join("\n"),
      check: (d) => (ids.has(d.archetype_id) ? [] : [{ path: "archetype_id", message: `Use one of: ${[...ids].join(", ")}` }]),
      fakeContext: { archetype: { id: playbook.archetypes[0]!.id, name: playbook.archetypes[0]!.name } },
    });
    const batch = createProposalBatch(accountId, { kind: "plan_draft", id: ARCHETYPE_ORIGIN, aiRunId: run.id }, [
      { entity_type: "account", op: "update", entity_id: accountId, payload: { archetype_id: data.archetype_id, archetype_hypothesis: data.hypothesis }, rationale: data.why },
    ]);
    return { batchId: batch.batchId, archetypeId: data.archetype_id };
  });
  return run.id;
}
