import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { buildContextPack, evidenceIds, evidenceIndex } from "@/lib/meetings/contextPack";
import { seedAccount, USER } from "./helpers";

describe("buildContextPack", () => {
  beforeEach(() => resetDbForTests());

  it("carries the records a meeting prompt may cite, with their ids", () => {
    const s = seedAccount();
    const pack = buildContextPack(s.accountId);
    expect(pack.account.name).toBe("Synthetic Orchard Lab");
    expect(pack.deals.map((d) => d.deal_id)).toEqual([s.dealId]);
    expect(pack.deals[0]).toMatchObject({ stage: 3, tcv_usd: 1000, fiscal_quarter: "FY27 Q2" });
    expect(pack.plays[0]).toMatchObject({ id: s.playId, deal_ids: [s.dealId] });
    expect(pack.contacts.map((c) => c.id)).toEqual([s.contactId]);
    expect(pack.research).toEqual([]);
  });

  it("excludes the meeting being worked on and meetings without a summary", () => {
    const s = seedAccount();
    const other = applyEntityChange({
      accountId: s.accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Kickoff", held_at: "2026-08-01", summary: "We agreed to scope the refresh." },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({ accountId: s.accountId, entityType: "meeting", op: "update", entityId: s.meetingId, payload: { summary: "This one." }, actorUserId: USER });

    const pack = buildContextPack(s.accountId, { excludeMeetingId: s.meetingId });
    expect(pack.recent_meetings.map((m) => m.id)).toEqual([other]);
  });

  it("evidence ids cover every citable record and nothing else", () => {
    const s = seedAccount();
    const item = applyEntityChange({
      accountId: s.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the sizing doc", status: "open" },
      actorUserId: USER,
    }).entityId;
    const pack = buildContextPack(s.accountId);
    const ids = evidenceIds(pack);
    expect(ids.has(s.dealId)).toBe(true);
    expect(ids.has(s.playId)).toBe(true);
    expect(ids.has(s.contactId)).toBe(true);
    expect(ids.has(item)).toBe(true);
    expect(ids.has(s.accountId)).toBe(true);
    expect(ids.has("made-up-id")).toBe(false);

    const index = evidenceIndex(pack);
    expect(index.get(s.dealId)).toEqual({ kind: "deal", label: "EHR Refresh" });
    expect(index.get(s.contactId)).toEqual({ kind: "contact", label: "Finley Example" });
  });

  it("a done action item is not offered as evidence", () => {
    const s = seedAccount();
    const item = applyEntityChange({
      accountId: s.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Already handled", status: "open" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({ accountId: s.accountId, entityType: "action_item", op: "update", entityId: item, payload: { status: "done" }, actorUserId: USER });
    expect(evidenceIds(buildContextPack(s.accountId)).has(item)).toBe(false);
  });
});
