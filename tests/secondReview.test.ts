// SYNTHETIC ONLY.
//
// A second independent review, of 9bc182b, reproduced six correctness issues
// in how proposals are filed, accepted and re-imported. Accept-all's is in
// acceptAllRoute.test.ts; the other five are here, one block each. Every
// test failed before its fix.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type ContactRow } from "@/lib/db";
import { acceptProposal, applyEntityChange, archiveEntity, captureBaseline, createProposalBatch, rejectProposal, restoreEntity } from "@/lib/proposals/apply";
import { mergeContacts } from "@/lib/proposals/merge";
import { dropRepeatedFollowUps } from "@/lib/meetings/run";
import { diffContacts } from "@/lib/sheet/diffContacts";
import { getAccount, listContacts, listDeals, listPlays } from "@/lib/queries/accounts";
import { seedAccount, USER, type Seed } from "./helpers";
import type { ProposalDraft } from "@/lib/proposals/schema";

let seed: Seed;
beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});
const meetingOrigin = () => ({ kind: "meeting" as const, id: seed.meetingId, aiRunId: null });

describe("a person's edit made while the model was thinking is not the baseline", () => {
  it("makes the model's stale answer a conflict at accept time", () => {
    // The run reads the account (stage 3) …
    const baseline = captureBaseline(seed.accountId);
    // … somebody moves the deal to stage 6 while the model works …
    applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload: { stage: 6 }, actorUserId: "user-2" });
    // … and the model, having seen stage 3, proposes stage 4.
    const { ids } = createProposalBatch(seed.accountId, meetingOrigin(), [{ entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { stage: 4 }, rationale: "synthetic" }], { baseline });
    expect(acceptProposal(ids[0]!, USER).status).toBe("conflict");
    expect((db().prepare("SELECT stage FROM deals WHERE deal_id = ?").get(seed.dealId) as { stage: number }).stage).toBe(6);
  });

  it("still accepts when nothing moved underneath it", () => {
    const baseline = captureBaseline(seed.accountId);
    const { ids } = createProposalBatch(seed.accountId, meetingOrigin(), [{ entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { stage: 4 }, rationale: "synthetic" }], { baseline });
    expect(acceptProposal(ids[0]!, USER).status).toBe("accepted");
  });
});

describe("regenerating a plan does not refuse its own suggestions", () => {
  const draft = (): ProposalDraft[] => [{ entity_type: "play", op: "create", payload: { title: "Synthetic play", status: "proposed" }, rationale: "synthetic" }];
  const planOrigin = { kind: "plan_draft" as const, id: null, aiRunId: null };

  it("files the same suggestion again after it was superseded rather than refused", () => {
    const first = createProposalBatch(seed.accountId, planOrigin, draft());
    // What supersession records: rejected, with nobody deciding.
    db().prepare(`UPDATE proposals SET status = 'rejected', decided_by = NULL, decided_at = ? WHERE id = ?`).run(Date.now(), first.ids[0]);
    expect(createProposalBatch(seed.accountId, planOrigin, draft()).ids).toHaveLength(1);
  });

  it("still does not ask again about one a person turned down", () => {
    const first = createProposalBatch(seed.accountId, planOrigin, draft());
    rejectProposal(first.ids[0]!, USER);
    expect(createProposalBatch(seed.accountId, planOrigin, draft()).ids).toHaveLength(0);
  });
});

describe("extracting the same notes twice makes each follow-up once", () => {
  const followUp = (text: string): ProposalDraft => ({ entity_type: "action_item", op: "create", payload: { text, status: "open", meeting_id: seed.meetingId }, rationale: "synthetic" });

  it("drops a follow-up already on the meeting, and one already pending for it", () => {
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { text: "Send the sizing", status: "done", meeting_id: seed.meetingId }, actorUserId: USER });
    createProposalBatch(seed.accountId, meetingOrigin(), [followUp("Book the review")]);
    const kept = dropRepeatedFollowUps(seed.meetingId, [followUp("  send the SIZING "), followUp("Book the review"), followUp("Something new"), followUp("Something new")]);
    expect(kept.map((d) => d.payload.text)).toEqual(["Something new"]);
  });

  it("leaves other kinds of proposal alone", () => {
    const summary: ProposalDraft = { entity_type: "meeting", op: "update", entity_id: seed.meetingId, payload: { summary: "x" }, rationale: "synthetic" };
    expect(dropRepeatedFollowUps(seed.meetingId, [summary])).toEqual([summary]);
  });
});

describe("a record archived after its proposal was filed is not written to", () => {
  it("makes accepting the summary of an archived meeting a conflict", () => {
    const { ids } = createProposalBatch(seed.accountId, meetingOrigin(), [{ entity_type: "meeting", op: "update", entity_id: seed.meetingId, payload: { summary: "Synthetic summary" }, rationale: "synthetic" }]);
    // Archived with the proposal already filed would reject it; the case is
    // the proposal filed after — so put it back to pending as a late filing.
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });
    db().prepare(`UPDATE proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?`).run(ids[0]);
    expect(acceptProposal(ids[0]!, USER).status).toBe("conflict");
    expect((db().prepare("SELECT summary FROM meetings WHERE id = ?").get(seed.meetingId) as { summary: string | null }).summary).not.toBe("Synthetic summary");
  });

  it("still lets an import restore an archived record it lists", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER });
    const { ids } = createProposalBatch(seed.accountId, { kind: "import", id: "synthetic-doc", aiRunId: null }, [{ entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { archived_at: null, stage: 4 }, rationale: "synthetic" }]);
    expect(acceptProposal(ids[0]!, USER).status).toBe("accepted");
  });
});

describe("re-importing a merged-away person lands on the survivor", () => {
  const state = () => ({
    account: getAccount(seed.accountId)!,
    deals: listDeals(seed.accountId, { includeArchived: true }),
    contacts: listContacts(seed.accountId, { includeArchived: true }) as ContactRow[],
    plays: listPlays(seed.accountId, { includeArchived: true }),
    installBase: [],
  });

  it("does not propose restoring the row the merge archived", () => {
    const loser = applyEntityChange({ accountId: seed.accountId, entityType: "contact", op: "create", payload: { name: "Avery Example-Old", org: "customer" }, actorUserId: USER }).entityId;
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: loser, actorUserId: USER });
    const { drafts } = diffContacts([{ row: 2, name: "Avery Example-Old", title: "Synthetic title" }], state() as never, { documentId: "synthetic-doc" });
    expect(drafts.some((d) => d.entity_id === loser)).toBe(false);
    expect(drafts.some((d) => JSON.stringify(d.payload).includes('"archived_at":null'))).toBe(false);
  });

  it("refuses Restore on it, and keeps it out of the Archived block", async () => {
    const { listArchived } = await import("@/lib/queries/meetings");
    const loser = applyEntityChange({ accountId: seed.accountId, entityType: "contact", op: "create", payload: { name: "Avery Example-Old", org: "customer" }, actorUserId: USER }).entityId;
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: loser, actorUserId: USER });
    expect(() => restoreEntity({ accountId: seed.accountId, entityType: "contact", entityId: loser, actorUserId: USER })).toThrow(/merged into/);
    expect(listArchived(seed.accountId).contacts.map((c) => c.id)).not.toContain(loser);
  });
});

describe("merges made before the pointer existed", () => {
  it("are found from their history lines and pointed at the survivor", async () => {
    const { backfillContactMergePointers } = await import("@/lib/db");
    const loser = applyEntityChange({ accountId: seed.accountId, entityType: "contact", op: "create", payload: { name: "Avery Example-Old", org: "customer" }, actorUserId: USER }).entityId;
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: loser, actorUserId: USER });
    // As a merge from before migration 020 left it: archived, no pointer.
    db().prepare("UPDATE contacts SET merged_into = NULL WHERE id = ?").run(loser);
    expect(backfillContactMergePointers(db())).toBe(1);
    expect((db().prepare("SELECT merged_into FROM contacts WHERE id = ?").get(loser) as { merged_into: string }).merged_into).toBe(seed.contactId);
    // And leaves an ordinary archived person alone.
    const archivedOnly = applyEntityChange({ accountId: seed.accountId, entityType: "contact", op: "create", payload: { name: "Someone Else", org: "customer" }, actorUserId: USER }).entityId;
    archiveEntity({ accountId: seed.accountId, entityType: "contact", entityId: archivedOnly, actorUserId: USER });
    expect(backfillContactMergePointers(db())).toBe(0);
  });
});
