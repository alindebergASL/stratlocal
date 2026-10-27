// SYNTHETIC ONLY.
//
// Moving a record to another account is one function with one set of rules,
// whatever is being moved: the target must be live, a stale version is
// refused, what was still proposed for the record is rejected, and the move
// is written into both accounts' history.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { archiveEntity, createProposalBatch } from "@/lib/proposals/apply";
import { moveToAccount } from "@/lib/proposals/move";
import { moveDeal } from "@/lib/proposals/merge";
import { seedAccount, USER } from "./helpers";

const history = (entityId: string) =>
  db().prepare("SELECT account_id FROM change_log WHERE entity_id = ? AND field = 'account_id' ORDER BY account_id").all(entityId) as Array<{ account_id: string }>;

it("moves a record, rejects what was proposed for it, and writes history on both accounts", () => {
  const a = seedAccount({ name: "Synthetic Move From" });
  const b = seedAccount({ name: "Synthetic Move To", dealId: "SYN-DEAL-002" });
  const batch = createProposalBatch(a.accountId, { kind: "meeting", id: a.meetingId, aiRunId: null }, [{ entity_type: "contact", op: "update", entity_id: a.contactId, payload: { title: "Head of platform" } }]);
  const before = (db().prepare("SELECT updated_at FROM contacts WHERE id = ?").get(a.contactId) as { updated_at: number }).updated_at;

  const { version } = moveToAccount({ entity: "contact", id: a.contactId, from: a.accountId, to: b.accountId, actorUserId: USER, baseVersion: before });

  expect((db().prepare("SELECT account_id FROM contacts WHERE id = ?").get(a.contactId) as { account_id: string }).account_id).toBe(b.accountId);
  expect(version).toBeGreaterThan(before);
  expect((db().prepare("SELECT status FROM proposals WHERE id = ?").get(batch.ids[0]) as { status: string }).status).toBe("rejected");
  expect(history(a.contactId).map((r) => r.account_id).sort()).toEqual([a.accountId, b.accountId].sort());
});

it("refuses a stale version, a record not on that account, and an archived target", () => {
  const a = seedAccount({ name: "Synthetic Move Guard" });
  const b = seedAccount({ name: "Synthetic Move Target", dealId: "SYN-DEAL-003" });
  expect(() => moveToAccount({ entity: "play", id: a.playId, from: a.accountId, to: b.accountId, actorUserId: USER, baseVersion: 1 })).toThrow(/changed since/);
  expect(() => moveToAccount({ entity: "play", id: a.playId, from: b.accountId, to: a.accountId, actorUserId: USER })).toThrow(/not on that account/);
  archiveEntity({ accountId: b.accountId, entityType: "account", entityId: b.accountId, actorUserId: USER });
  expect(() => moveToAccount({ entity: "play", id: a.playId, from: a.accountId, to: b.accountId, actorUserId: USER })).toThrow(/archived/);
});

it("is what moving a deal uses: unlinked from the old account's plays, history on both", () => {
  const a = seedAccount({ name: "Synthetic Deal From" });
  const b = seedAccount({ name: "Synthetic Deal To", dealId: "SYN-DEAL-004" });
  const result = moveDeal({ dealId: a.dealId, fromAccountId: a.accountId, toAccountId: b.accountId, actorUserId: USER });
  expect(result.unlinkedFromPlays).toBe(1);
  expect(history(a.dealId).map((r) => r.account_id).sort()).toEqual([a.accountId, b.accountId].sort());
});
