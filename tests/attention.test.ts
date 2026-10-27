import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { listAttention, groupAttention } from "@/lib/queries/attention";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { seedAccount, USER } from "./helpers";

const NOW = new Date("2026-09-12T12:00:00Z");

describe("listAttention", () => {
  beforeEach(() => resetDbForTests());

  it("surfaces an open deal closing this quarter with no next step", () => {
    const s = seedAccount();
    const fq = currentFiscalQuarter(NOW).label;
    applyEntityChange({
      accountId: s.accountId,
      entityType: "deal",
      op: "update",
      entityId: s.dealId,
      payload: { fiscal_quarter: fq, next_step: null },
      actorUserId: USER,
    });
    const items = listAttention(NOW).filter((i) => i.kind === "no_next_step");
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("EHR Refresh");
    // The deal's own page, not an anchor into the account page's list. Every
    // record has a page now, which is what let that list stop rendering the
    // rows it says it is hiding.
    expect(items[0]!.href).toBe(`/accounts/${s.accountId}/deals/${s.dealId}`);

    applyEntityChange({ accountId: s.accountId, entityType: "deal", op: "update", entityId: s.dealId, payload: { next_step: "Book the review" }, actorUserId: USER });
    expect(listAttention(NOW).filter((i) => i.kind === "no_next_step")).toHaveLength(0);
  });

  it("surfaces past due follow-ups and play next steps, and stops once they are done", () => {
    const s = seedAccount();
    const item = applyEntityChange({
      accountId: s.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the sizing doc", due: "2026-09-01", status: "open" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({ accountId: s.accountId, entityType: "play", op: "update", entityId: s.playId, payload: { next_step: "Book the workshop", next_step_due: "2026-08-20" }, actorUserId: USER });

    const overdue = listAttention(NOW).filter((i) => i.kind === "overdue");
    expect(overdue).toHaveLength(2);
    expect(overdue.map((i) => i.text)).toContain("Send the sizing doc");
    expect(overdue.map((i) => i.text)).toContain("EHR platform defense: Book the workshop");

    applyEntityChange({ accountId: s.accountId, entityType: "action_item", op: "update", entityId: item, payload: { status: "done" }, actorUserId: USER });
    applyEntityChange({ accountId: s.accountId, entityType: "play", op: "update", entityId: s.playId, payload: { status: "won" }, actorUserId: USER });
    expect(listAttention(NOW).filter((i) => i.kind === "overdue")).toHaveLength(0);
  });

  it("surfaces a meeting within seven days that has no brief, and only until it has one", () => {
    const s = seedAccount({ heldAt: "2026-09-15" });
    expect(listAttention(NOW).filter((i) => i.kind === "no_brief")).toHaveLength(1);

    applyEntityChange({ accountId: s.accountId, entityType: "meeting", op: "update", entityId: s.meetingId, payload: { brief_json: '{"situation":[]}' }, actorUserId: USER });
    expect(listAttention(NOW).filter((i) => i.kind === "no_brief")).toHaveLength(0);
  });

  it("ignores a meeting that is further out or already past", () => {
    seedAccount({ heldAt: "2026-10-30" });
    expect(listAttention(NOW).filter((i) => i.kind === "no_brief")).toHaveLength(0);
    resetDbForTests();
    seedAccount({ heldAt: "2026-09-01" });
    expect(listAttention(NOW).filter((i) => i.kind === "no_brief")).toHaveLength(0);
  });

  it("counts pending proposals per account and groups the list for the page", () => {
    const s = seedAccount();
    createProposalBatch(s.accountId, { kind: "meeting", id: s.meetingId, aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: s.dealId, payload: { next_step: "Something" } },
    ]);
    const groups = groupAttention(listAttention(NOW));
    expect(groups[0]!.kind).toBe("proposals");
    expect(groups[0]!.items[0]!.text).toBe("1 proposed change");
  });

  it("says a late follow-up is the customer's promise, not our work", () => {
    const s = seedAccount();
    applyEntityChange({
      accountId: s.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the signed order form", owner: "Finley Example", due: "2026-09-01" },
      actorUserId: USER,
    });
    const [late] = listAttention(NOW).filter((i) => i.kind === "overdue");
    expect(late?.promisedBy).toBe("Finley Example");
    expect(late?.detail).toBe("due 2026-09-01 · Finley Example promised this");
  });
});
