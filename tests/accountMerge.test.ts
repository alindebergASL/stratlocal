// SYNTHETIC ONLY.
//
// Two account records for one customer, made one — and taken apart again.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyEntityChange, createProposalBatch, restoreEntity } from "@/lib/proposals/apply";
import { mergeAccounts, planAccountUnmerge, previewAccountMerge, previewAccountUnmerge, unmergeAccount } from "@/lib/proposals/mergeAccount";
import { listMergeReceipts } from "@/lib/proposals/unmerge";
import { accountRevision } from "@/lib/queries/freshness";
import { seedAccount, USER } from "./helpers";

const accountOf = (table: string, key: string, id: string) => (db().prepare(`SELECT account_id FROM ${table} WHERE ${key} = ?`).get(id) as { account_id: string }).account_id;
const acct = (id: string) => db().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as { archived_at: string | null; merged_into: string | null; crm_id: string | null; thesis: string | null };

function pair() {
  const keep = seedAccount({ name: "Synthetic Keep Lab" });
  const lose = seedAccount({ name: "Synthetic Keep Laboratory", dealId: "SYN-DEAL-100" });
  applyEntityChange({ accountId: lose.accountId, entityType: "account", op: "update", entityId: lose.accountId, payload: { crm_id: "SYN-CRM-9", thesis: "Their own thesis" }, actorUserId: USER });
  applyEntityChange({ accountId: keep.accountId, entityType: "account", op: "update", entityId: keep.accountId, payload: { thesis: "Kept thesis" }, actorUserId: USER });
  return { keep, lose };
}

it("says before the press what moves, what fills and what is not carried", () => {
  const { keep, lose } = pair();
  const p = previewAccountMerge(keep.accountId, lose.accountId);
  if (!p.ok) throw new Error(p.why);
  expect(p.counts.map((c) => `${c.n} ${c.noun}`)).toEqual(["1 person", "1 deal", "1 play", "1 meeting"]);
  expect(p.fills).toContain("CRM ID");
  expect(p.notCarried.join(" ")).toMatch(/thesis/);
  // The seed puts a person of the same name on both.
  expect(p.samePeople).toEqual(["Finley Example"]);
  expect(previewAccountMerge(keep.accountId, keep.accountId)).toMatchObject({ ok: false });
});

it("moves every record, fills blanks, archives the other and points it at the kept one", () => {
  const { keep, lose } = pair();
  const pending = createProposalBatch(lose.accountId, { kind: "meeting", id: lose.meetingId, aiRunId: null }, [{ entity_type: "deal", op: "update", entity_id: lose.dealId, payload: { next_step: "Call" } }]);
  const loserBefore = accountRevision(lose.accountId);
  const keeperBefore = accountRevision(keep.accountId);

  const r = mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });

  expect(r.moved).toBe(4);
  expect(accountOf("deals", "deal_id", lose.dealId)).toBe(keep.accountId);
  expect(accountOf("contacts", "id", lose.contactId)).toBe(keep.accountId);
  expect(accountOf("plays", "id", lose.playId)).toBe(keep.accountId);
  expect(accountOf("meetings", "id", lose.meetingId)).toBe(keep.accountId);
  expect(acct(keep.accountId)).toMatchObject({ crm_id: "SYN-CRM-9", thesis: "Kept thesis" });
  expect(acct(lose.accountId).archived_at).not.toBeNull();
  expect(acct(lose.accountId).merged_into).toBe(keep.accountId);
  expect((db().prepare("SELECT status FROM proposals WHERE id = ?").get(pending.ids[0]) as { status: string }).status).toBe("rejected");
  // Both accounts' open pages learn that something happened.
  expect(accountRevision(lose.accountId)).not.toBe(loserBefore);
  expect(accountRevision(keep.accountId)).not.toBe(keeperBefore);
  // It cannot be restored by hand: only the undo brings it back with its records.
  expect(() => restoreEntity({ accountId: lose.accountId, entityType: "account", entityId: lose.accountId, actorUserId: USER })).toThrow(/merged/);
  expect(listMergeReceipts(keep.accountId).map((m) => m.entityType)).toContain("account");
});

it("undoes: the records go back, the filled field is cleared, the account is live again", () => {
  const { keep, lose } = pair();
  const { receiptId } = mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });
  const p = previewAccountUnmerge(keep.accountId, receiptId);
  if (!p.ok) throw new Error(p.why);
  expect(p.returns).toBe(4);

  unmergeAccount({ keeperId: keep.accountId, receiptId, actorUserId: USER, expect: p.digest });

  expect(accountOf("deals", "deal_id", lose.dealId)).toBe(lose.accountId);
  expect(accountOf("meetings", "id", lose.meetingId)).toBe(lose.accountId);
  expect(acct(lose.accountId)).toMatchObject({ archived_at: null, merged_into: null });
  expect(acct(keep.accountId).crm_id).toBeNull();
  expect(listMergeReceipts(keep.accountId).filter((m) => m.entityType === "account")).toHaveLength(0);
});

it("leaves what has been tied to the kept account since, and says so", () => {
  const { keep, lose } = pair();
  const { receiptId } = mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });
  // After the merge, the kept account's own play takes on the moved deal.
  applyEntityChange({ accountId: keep.accountId, entityType: "play", op: "update", entityId: keep.playId, payload: { deal_ids: [keep.dealId, lose.dealId] }, actorUserId: USER });
  const plan = planAccountUnmerge(db(), keep.accountId, receiptId);
  expect(plan.back.map(([e]) => e)).not.toContain("deal");
  expect(plan.keptAsIs.join(" ")).toMatch(/Deal .* is now linked/);
  // A digest from before that change is refused.
  expect(() => unmergeAccount({ keeperId: keep.accountId, receiptId, actorUserId: USER, expect: "stale" })).toThrow(/changed since/);
});
