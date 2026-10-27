// The neutral starter and the fake web research only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedAccount, USER } from "./helpers";
import { getRun } from "@/lib/ai/guard";
import { acceptProposal, applyEntityChange } from "@/lib/proposals/apply";
import { getAccount, listPendingProposals } from "@/lib/queries/accounts";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { researchSteer } from "@/lib/playbook/researchSteer";
import { startResearchRun } from "@/lib/research/run";
import { acceptNote } from "@/lib/research/notes";
import { supersedePendingPlanDrafts } from "@/lib/plan/run";

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

async function research(accountId: string) {
  const runId = startResearchRun({ accountId, userId: USER, focus: null, depth: "standard" });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"), { timeout: 10000 });
  return getRun(runId)!;
}

it("without a playbook, research asks nothing about budgets and proposes no budget timing", async () => {
  const { accountId } = seedAccount();
  const run = await research(accountId);
  expect(JSON.parse(run.input_summary!).budgetTiming).toBe(false);
  // The people it names are offered (DECISIONS #91); budget timing is not.
  expect(listPendingProposals(accountId).filter((p) => p.origin_id !== "research_people")).toEqual([]);
});

it("with a playbook, it asks for budget timing in fixed words, steers the note, and proposes what it finds", async () => {
  savePlaybook({ playbook: { ...STARTER_PLAYBOOK, name: "Synthetic Team Playbook" }, userId: USER, basisId: null });
  const { accountId } = seedAccount();
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: "stuck-in-pilots" }, actorUserId: USER });
  const steer = researchSteer(accountId)!;
  expect(steer).toContain('"Stuck in pilots"');
  expect(steer).toContain("What has stopped your pilots reaching production?");
  expect(steer).toContain("budget timing is not on file");

  const run = await research(accountId);
  const sent = run.input_summary!;
  // What leaves for the web: a yes, never the playbook's words.
  expect(JSON.parse(sent).budgetTiming).toBe(true);
  expect(sent).not.toContain("Synthetic Team Playbook");
  expect(sent).not.toContain("Stuck in pilots");

  const p = listPendingProposals(accountId).find((x) => x.origin_id === "playbook_budget")!;
  expect(JSON.parse(p.payload_json)).toEqual({ fiscal_year_start_month: 7, budget_calendar: expect.stringContaining("board adopts the budget each June") });
  expect(JSON.parse(p.source_ref_json!)).toMatchObject({ kind: "research", finding_index: 1 });
  supersedePendingPlanDrafts(accountId);
  expect(listPendingProposals(accountId).some((x) => x.id === p.id)).toBe(true);
  // It rests on research nobody has kept yet, so it cannot be accepted until
  // the finding is kept.
  const docId = JSON.parse(p.source_ref_json!).id as string;
  expect(() => acceptProposal(p.id, USER)).toThrow(/no longer accepted/);
  acceptNote(docId, [0, 1, 2], USER);
  expect(() => acceptProposal(p.id, USER)).toThrow(/Acknowledge source review/);
  acceptProposal(p.id, USER, { ackEvidence: true });
  expect(getAccount(accountId)).toMatchObject({ fiscal_year_start_month: 7 });

  // Known now, and matching: a second look proposes nothing new.
  await research(accountId);
  expect(listPendingProposals(accountId).filter((x) => x.origin_id === "playbook_budget")).toHaveLength(0);
});
