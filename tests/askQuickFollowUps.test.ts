// Synthetic accounts and follow-ups only.
import { expect, it } from "vitest";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { createProposalBatch } from "@/lib/proposals/apply";
import { acceptQuickFollowUps, askOrigin, quickFollowUps } from "@/lib/ask/propose";
import type { ProposalDraft } from "@/lib/proposals/schema";

const followUp = (text: string, extra: Partial<ProposalDraft> = {}): ProposalDraft => ({ entity_type: "action_item", op: "create", payload: { text, status: "open", due: "2026-11-01" }, rationale: "synthetic", ...extra }) as ProposalDraft;
const batch = (accountId: string, drafts: ProposalDraft[]) => createProposalBatch(accountId, { kind: "plan_draft", id: askOrigin("t-synthetic"), aiRunId: null }, drafts);

it("offers one tap only when every waiting change is a new follow-up, and adds them through the ordinary accept", () => {
  const { accountId } = seedAccount();
  const { batchId } = batch(accountId, [followUp("Synthetic send the pack"), followUp("Synthetic book the call")]);
  expect(quickFollowUps(batchId)?.map((f) => [f.text, f.due])).toEqual([["Synthetic send the pack", "2026-11-01"], ["Synthetic book the call", "2026-11-01"]]);
  expect(acceptQuickFollowUps(batchId, USER)).toEqual({ accepted: 2, failed: [] });
  const texts = (db().prepare("SELECT text FROM action_items WHERE account_id = ? ORDER BY text").all(accountId) as Array<{ text: string }>).map((r) => r.text);
  expect(texts).toEqual(expect.arrayContaining(["Synthetic book the call", "Synthetic send the pack"]));
  // Nothing is left waiting, so nothing is offered again.
  expect(quickFollowUps(batchId)).toBeNull();
});

it("leaves anything that edits a record, or rests on public research, to the review page", () => {
  const seed = seedAccount();
  const mixed = batch(seed.accountId, [followUp("Synthetic one"), { entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { next_step: "Synthetic" }, rationale: "synthetic" } as ProposalDraft]);
  expect(quickFollowUps(mixed.batchId)).toBeNull();
  expect(() => acceptQuickFollowUps(mixed.batchId, USER)).toThrow(/review page/);
  const researched = batch(seed.accountId, [followUp("Synthetic two", { source_ref: { kind: "research", id: "note#0" } } as Partial<ProposalDraft>)]);
  expect(quickFollowUps(researched.batchId)).toBeNull();
});
