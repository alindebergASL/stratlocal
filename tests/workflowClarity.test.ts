import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests, db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { seedAccount, USER, type Seed } from "./helpers";
import { researchMeetingHref, meetingReturn, researchRefsWithReturn } from "@/lib/researchMeetingReturn";
import { dealCommitmentCounts, followUpLine } from "@/lib/pipelineCommitments";
import { commitmentBasis, createNextStepCommitment } from "@/lib/nextStepCommitments";
import { getDeal } from "@/lib/queries/accounts";
import { fieldLabel } from "@/lib/fieldLabels";
let seed: Seed;
beforeEach(() => {
  resetDbForTests(); seed = seedAccount();
  db().prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,'unused','Synthetic Assignee',1,1)").run(USER, "assignee@example.test");
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, op: "update", actorUserId: USER, payload: { next_step: "Confirm synthetic scope" } });
});
describe("research navigation context never changes evidence identity", () => {
  it("preserves exact note/index/anchor and copies the reference map", () => {
    const href = `/accounts/${seed.accountId}/research?note=note-1&finding=0#finding-note-1-0`;
    const result = researchMeetingHref(href, seed.accountId, "meeting-1");
    expect(result).toBe(href.replace("#finding", "&fromMeeting=meeting-1#finding"));
    const map = new Map([["e", { label: "Retained finding", href, status: "current" as const, requested: {kind: "research", id: "note-1:0"}, asOf: "2026-10-01", reason: null, verification: "report_excerpt" as const }]]);
    const copy = researchRefsWithReturn(map, seed.accountId, "meeting-1");
    expect(copy.get("e")!.href).toBe(result); expect(map.get("e")!.href).toBe(href);
    expect(copy.get("e")!.label).toBe("Retained finding");
  });
  it.each(["https://example.test/source", "/accounts/other/research?note=x", "/accounts/a/research-evil", "//example.test/research"])("does not alter other citation destinations: %s", (href) => {
    expect(researchMeetingHref(href, seed.accountId, "meeting-1")).toBe(href);
  });
  it("rejects malformed, duplicate, missing, moved or merged return context", () => {
    const id = applyEntityChange({ accountId: seed.accountId, entityType: "meeting", op: "create", actorUserId: USER, payload: { title: "Synthetic evidence review", held_at: "2026-10-01" } }).entityId;
    expect(meetingReturn(seed.accountId, id)?.href).toContain(`/meetings/${id}#brief`);
    for (const bad of [[id, id], ` ${id}`, "%2f", "https://example.test", "missing"]) expect(meetingReturn(seed.accountId, bad)).toBeNull();
    expect(meetingReturn(seedAccount({ dealId: "SYN-DEAL-OTHER" }).accountId, id)).toBeNull();
    db().prepare("UPDATE meetings SET archived_at='2026-10-02' WHERE id=?").run(id);
    expect(meetingReturn(seed.accountId, id)?.archived).toBe(true);
    db().prepare("UPDATE meetings SET merged_into='survivor' WHERE id=?").run(id);
    expect(meetingReturn(seed.accountId, id)).toBeNull();
  });
});
describe("manager clarity follows records, not matching words", () => {
  it("has distinct missing, written, linked-open and historical states", () => {
    expect(followUpLine()).toBeNull();
    expect(followUpLine({ open: 0, total: 0 })).toBeNull();
    expect(followUpLine({ open: 1, total: 1 })).toBe("1 open follow-up");
    expect(followUpLine({ open: 0, total: 1 })).toBe("Follow-up history");
  });
  it("counts only explicit same-account deal provenance, including done/archived history", () => {
    const input = { accountId: seed.accountId, kind: "deal" as const, sourceId: seed.dealId, basis: commitmentBasis(getDeal(seed.dealId)!), userId: USER, text: "Synthetic task", assignee: "unassigned", due: "", noDate: true };
    const { id } = createNextStepCommitment(input);
    const query = [{ account_id: seed.accountId, deal_id: seed.dealId }];
    expect(dealCommitmentCounts(query).get(seed.dealId)).toEqual({ open: 1, total: 1 });
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", actorUserId: USER, payload: { text: "Synthetic task" } });
    expect(dealCommitmentCounts(query).get(seed.dealId)?.total).toBe(1);
    db().prepare("UPDATE action_items SET status='done' WHERE id=?").run(id);
    expect(dealCommitmentCounts(query).get(seed.dealId)).toEqual({ open: 0, total: 1 });
    db().prepare("UPDATE action_items SET status='open', archived_at='2026-10-02' WHERE id=?").run(id);
    expect(dealCommitmentCounts(query).get(seed.dealId)).toEqual({ open: 0, total: 1 });
    expect(dealCommitmentCounts([{ account_id: seedAccount({ dealId: "SYN-DEAL-OTHER" }).accountId, deal_id: seed.dealId }]).size).toBe(0);
  });
  it("keeps written ownership distinct from assignment and retains safe fallback", () => {
    expect(fieldLabel("owner_user_id")).toBe("Assigned owner"); expect(fieldLabel("owner")).toBe("Owner"); expect(fieldLabel("__proto__")).toBe("  proto  ");
  });
});
