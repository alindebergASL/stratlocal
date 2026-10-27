// Synthetic data only.
import { expect, it, vi } from "vitest";
import { seedAccount, USER } from "./helpers";
import { acceptProposal, applyEntityChange, createProposalBatch, getProposal } from "@/lib/proposals/apply";
import { undoAccepted } from "@/lib/proposals/undo";
import { inboxCount, inboxSummary } from "@/lib/inbox/query";
import { snoozeItem, snoozeDays, wakeItem } from "@/lib/inbox/snooze";
import { getDeal, listContacts } from "@/lib/queries/accounts";
import { editedValue } from "@/components/ChangeDeck";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("undo puts back what nobody changed since, keeps what they did, and leaves it to decide again", () => {
  const { accountId, dealId, meetingId } = seedAccount({ name: "Synthetic Undo Co" });
  const before = getDeal(dealId)!;
  const { ids } = createProposalBatch(accountId, { kind: "meeting", id: meetingId, aiRunId: null }, [
    { entity_type: "deal", op: "update", entity_id: dealId, payload: { stage: 5, next_step: "Synthetic workshop" }, rationale: "said so" },
  ]);
  expect(acceptProposal(ids[0]!, USER).status).toBe("accepted");
  // Someone writes the next step afterwards: undo must not take that away.
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { next_step: "Synthetic call Tuesday" }, actorUserId: USER });
  expect(undoAccepted(ids[0]!, USER)).toEqual({ reverted: ["stage"], kept: ["next_step"] });
  const after = getDeal(dealId)!;
  expect(after.stage).toBe(before.stage);
  expect(after.next_step).toBe("Synthetic call Tuesday");
  expect(getProposal(ids[0]!)).toMatchObject({ status: "pending", decided_by: null });
  expect(getProposal(ids[0]!)!.undone_at).toBeTruthy();
});

it("undo of a created record archives it", () => {
  const { accountId, meetingId } = seedAccount({ name: "Synthetic Undo Create" });
  const { ids } = createProposalBatch(accountId, { kind: "meeting", id: meetingId, aiRunId: null }, [
    { entity_type: "contact", op: "create", payload: { name: "Synthetic Undone Person", org: "customer" }, rationale: "named" },
  ]);
  acceptProposal(ids[0]!, USER);
  expect(listContacts(accountId).some((c) => c.name === "Synthetic Undone Person")).toBe(true);
  undoAccepted(ids[0]!, USER);
  expect(listContacts(accountId).some((c) => c.name === "Synthetic Undone Person")).toBe(false);
  expect(getProposal(ids[0]!)).toMatchObject({ status: "pending", entity_id: null });
});

it("an edit before accepting may correct a proposed value but never add one", () => {
  const { accountId, dealId, meetingId } = seedAccount({ name: "Synthetic Edit Co" });
  const { ids } = createProposalBatch(accountId, { kind: "meeting", id: meetingId, aiRunId: null }, [
    { entity_type: "deal", op: "update", entity_id: dealId, payload: { tcv_usd: 900000 }, rationale: "quoted" },
    { entity_type: "deal", op: "update", entity_id: dealId, payload: { close_date: "2027-01-31" }, rationale: "quoted" },
  ]);
  expect(() => acceptProposal(ids[0]!, USER, { edits: { stage: 6 } })).toThrow(/not proposed/);
  expect(acceptProposal(ids[0]!, USER, { edits: { tcv_usd: editedValue(900000, "1.2m") } }).status).toBe("accepted");
  expect(getDeal(dealId)!.tcv_usd).toBe(1200000);
  const row = getProposal(ids[0]!)!;
  expect(JSON.parse(row.proposed_json!)).toEqual({ tcv_usd: 900000 });
  expect(JSON.parse(row.payload_json)).toEqual({ tcv_usd: 1200000 });
  // Undo drops the edit too: what comes back is what was proposed.
  undoAccepted(ids[0]!, USER);
  expect(JSON.parse(getProposal(ids[0]!)!.payload_json)).toEqual({ tcv_usd: 900000 });
  expect(editedValue("2027-01-31", " ")).toBeNull();
  expect(editedValue(0.5, "0.75")).toBe(0.75);
});

it("snoozing takes an item out of the Inbox and its count, for that person only, until the day", () => {
  const { accountId, meetingId } = seedAccount({ name: "Synthetic Snooze Co" });
  createProposalBatch(accountId, { kind: "meeting", id: meetingId, aiRunId: null }, [
    { entity_type: "action_item", op: "create", payload: { text: "Synthetic send it" }, rationale: "agreed" },
  ]);
  const has = () => inboxSummary(USER, "2026-10-24").changes.some((c) => c.accountId === accountId);
  const count = inboxCount(USER, "2026-10-24");
  expect(has()).toBe(true);
  const { tomorrow, nextWeek } = snoozeDays("2026-10-24");
  expect([tomorrow, nextWeek]).toEqual(["2026-10-25", "2026-10-26"]);
  snoozeItem(USER, `changes:${accountId}`, tomorrow);
  expect(has()).toBe(false);
  expect(inboxCount(USER, "2026-10-24")).toBe(count - 1);
  expect(inboxSummary(USER, "2026-10-24").snoozed).toEqual([expect.objectContaining({ key: `changes:${accountId}`, until: tomorrow })]);
  expect(inboxSummary("someone-else", "2026-10-24").changes.some((c) => c.accountId === accountId)).toBe(true);
  // On the day it is back.
  expect(inboxSummary(USER, tomorrow).changes.some((c) => c.accountId === accountId)).toBe(true);
  wakeItem(USER, `changes:${accountId}`);
  expect(has()).toBe(true);
  expect(() => snoozeItem(USER, "anything", tomorrow)).toThrow();
});
