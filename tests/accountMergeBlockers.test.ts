// SYNTHETIC ONLY. Account ownership and later person-link decisions survive undo.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { linkPeople, unlinkPerson } from "@/lib/people";
import { mergeAccounts, planAccountUnmerge, unmergeAccount } from "@/lib/proposals/mergeAccount";
import { moveToAccount } from "@/lib/proposals/move";
import { seedAccount, USER } from "./helpers";

const contact = (id: string) => db().prepare("SELECT account_id, person_id FROM contacts WHERE id = ?").get(id) as { account_id: string; person_id: string | null };

it("preserves later link/unlink decisions and their actor/account attribution through account undo", () => {
  const keep = seedAccount();
  const lose = seedAccount({ name: "Synthetic Merge Source", dealId: "SYN-SECOND" });
  const other = seedAccount({ name: "Synthetic Other Customer", dealId: "SYN-THIRD" });
  const { receiptId } = mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });
  linkPeople({ aId: lose.contactId, bId: other.contactId, actorUserId: USER });
  unlinkPerson(lose.contactId, USER);
  const { personId } = linkPeople({ aId: other.contactId, bId: lose.contactId, actorUserId: USER });
  const log = () => db().prepare("SELECT account_id, actor_user_id, old_value, new_value FROM change_log WHERE entity_id = ? AND field = 'person_link' ORDER BY rowid").all(lose.contactId);
  const before = log();
  expect(before).toHaveLength(3);
  expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ account_id: keep.accountId, actor_user_id: USER })]));
  unmergeAccount({ keeperId: keep.accountId, receiptId, actorUserId: USER });
  expect(contact(lose.contactId)).toEqual({ account_id: lose.accountId, person_id: personId });
  expect(contact(other.contactId).person_id).toBe(personId);
  expect(log()).toEqual(before); // History stays where the decision was made.
});

it("does not overwrite an explicit later move away and back when undoing an account merge", () => {
  const keep = seedAccount();
  const lose = seedAccount({ name: "Synthetic Move Source", dealId: "SYN-SECOND" });
  const other = seedAccount({ name: "Synthetic Move Other", dealId: "SYN-THIRD" });
  const { receiptId } = mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });
  const before = planAccountUnmerge(db(), keep.accountId, receiptId);
  // The ownership value ends up identical, but these are later human writes.
  moveToAccount({ entity: "contact", id: lose.contactId, from: keep.accountId, to: other.accountId, actorUserId: USER });
  moveToAccount({ entity: "contact", id: lose.contactId, from: other.accountId, to: keep.accountId, actorUserId: USER });
  const after = planAccountUnmerge(db(), keep.accountId, receiptId);
  expect(after.back).not.toContainEqual(["contact", lose.contactId]);
  expect(after.keptAsIs.join(" ")).toMatch(/moved.*since/i);
  expect(after.digest).not.toBe(before.digest);
  expect(() => unmergeAccount({ keeperId: keep.accountId, receiptId, actorUserId: USER, expect: before.digest })).toThrow(/changed since/);
  unmergeAccount({ keeperId: keep.accountId, receiptId, actorUserId: USER, expect: after.digest });
  expect(contact(lose.contactId).account_id).toBe(keep.accountId);
});
