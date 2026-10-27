// SYNTHETIC ONLY: invented account, meetings, plays and follow-ups.
//
// A follow-up's `meeting_id` and `play_id` are operational links: every screen
// reads them as where this piece of work belongs now. A merge relinks the ones
// that exist when it runs, and a proposal written before the merge still
// carries the id of the record that lost — so accepting it afterwards hung a
// live follow-up off a tombstone, which no list shows and `restoreEntity`
// refuses to bring back (DECISIONS #33). Nothing between the proposal and the
// row it wrote looked, because the check belongs at the one writer.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type ActionItemRow } from "@/lib/db";
import { acceptProposal, applyEntityChange, archiveEntity, createProposalBatch } from "@/lib/proposals/apply";
import { mergeMeetings, mergePlays } from "@/lib/proposals/merge";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;
let loserMeeting: string;
let loserPlay: string;

function item(id: string): ActionItemRow {
  return db().prepare(`SELECT * FROM action_items WHERE id = ?`).get(id) as ActionItemRow;
}

/** One pending proposal, accepted, the way the review screen does it. */
function proposeAndAccept(draft: Parameters<typeof createProposalBatch>[2][number], accountId = seed.accountId): string {
  const batch = createProposalBatch(accountId, { kind: "meeting", id: null, aiRunId: null }, [draft]);
  expect(batch.ids).toHaveLength(1);
  const result = acceptProposal(batch.ids[0]!, USER);
  expect(result.status).toBe("accepted");
  return result.entityId!;
}

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
  loserMeeting = applyEntityChange({
    accountId: seed.accountId,
    entityType: "meeting",
    op: "create",
    payload: { title: "Quarterly review (second record)", held_at: "2026-09-15" },
    actorUserId: USER,
  }).entityId;
  loserPlay = applyEntityChange({
    accountId: seed.accountId,
    entityType: "play",
    op: "create",
    payload: { title: "EHR Platform Defense", status: "proposed" },
    actorUserId: USER,
  }).entityId;
});

describe("a follow-up proposed against a record that is merged away before it is accepted", () => {
  it("lands on the meeting that survived, not on the tombstone", () => {
    const draft = {
      entity_type: "action_item" as const,
      op: "create" as const,
      payload: {
        text: "Confirm the CFO date",
        meeting_id: loserMeeting,
        // Kept on the row: which conversation this sentence was said in.
        source_ref: { kind: "meeting", id: loserMeeting, quote: "the CFO decides in November" },
      },
    };
    const batch = createProposalBatch(seed.accountId, { kind: "meeting", id: null, aiRunId: null }, [draft]);
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loserMeeting, actorUserId: USER });

    const accepted = acceptProposal(batch.ids[0]!, USER);
    expect(accepted.status).toBe("accepted");
    expect(item(accepted.entityId!).meeting_id).toBe(seed.meetingId);
    // Provenance is a different question from where the work belongs: the
    // quote came from that record, on that day, and rewriting the ref would be
    // forging it.
    expect(JSON.parse(item(accepted.entityId!).source_ref_json ?? "null")).toMatchObject({ id: loserMeeting });
  });

  it("lands on the play that survived", () => {
    const batch = createProposalBatch(seed.accountId, { kind: "meeting", id: null, aiRunId: null }, [
      { entity_type: "action_item", op: "create", payload: { text: "Send the architecture pack", play_id: loserPlay } },
    ]);
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loserPlay, actorUserId: USER });
    const accepted = acceptProposal(batch.ids[0]!, USER);
    expect(item(accepted.entityId!).play_id).toBe(seed.playId);
  });

  it("resolves an update proposal too, and does not report a drift it invented", () => {
    const followUp = applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Walk the site with operations" },
      actorUserId: USER,
    }).entityId;
    const batch = createProposalBatch(seed.accountId, { kind: "meeting", id: null, aiRunId: null }, [
      { entity_type: "action_item", op: "update", entity_id: followUp, payload: { play_id: loserPlay, meeting_id: loserMeeting } },
    ]);
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loserPlay, actorUserId: USER });
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loserMeeting, actorUserId: USER });

    expect(acceptProposal(batch.ids[0]!, USER).status).toBe("accepted");
    expect(item(followUp).play_id).toBe(seed.playId);
    expect(item(followUp).meeting_id).toBe(seed.meetingId);
  });

  it("follows a chain of merges to the record that answers for all of them", () => {
    const middle = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Quarterly review (third record)", held_at: "2026-09-15" },
      actorUserId: USER,
    }).entityId;
    // A into B, B into C.
    mergeMeetings({ accountId: seed.accountId, keeperId: middle, loserId: loserMeeting, actorUserId: USER });
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: middle, actorUserId: USER });

    const id = proposeAndAccept({ entity_type: "action_item", op: "create", payload: { text: "Confirm the CFO date", meeting_id: loserMeeting } });
    expect(item(id).meeting_id).toBe(seed.meetingId);
  });

  it("writes the id unchanged when nothing was merged", () => {
    const id = proposeAndAccept({ entity_type: "action_item", op: "create", payload: { text: "Confirm the CFO date", meeting_id: seed.meetingId, play_id: seed.playId } });
    expect(item(id).meeting_id).toBe(seed.meetingId);
    expect(item(id).play_id).toBe(seed.playId);
  });

  it("still lets a follow-up sit on an archived record that was never merged", () => {
    // Archiving hides a record; it does not move its work somewhere else, and
    // a follow-up on a call that has been put away is an ordinary state. Only
    // a merge changes where the link should point.
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: loserMeeting, actorUserId: USER });
    const id = applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "File the notes", meeting_id: loserMeeting },
      actorUserId: USER,
    }).entityId;
    expect(item(id).meeting_id).toBe(loserMeeting);
  });
});

describe("a reference the write path cannot resolve fails closed", () => {
  const write = (payload: Record<string, unknown>, accountId = seed.accountId) =>
    applyEntityChange({ accountId, entityType: "action_item", op: "create", payload: { text: "Follow this up", ...payload }, actorUserId: USER });

  it("refuses a meeting or play that does not exist", () => {
    expect(() => write({ meeting_id: "no-such-meeting" })).toThrow(/meeting no-such-meeting does not exist/);
    expect(() => write({ play_id: "no-such-play" })).toThrow(/play no-such-play does not exist/);
  });

  it("refuses a record on another account", () => {
    const other = seedAccount({ name: "Synthetic Second Lab", dealId: "SYN-DEAL-900" });
    expect(() => write({ meeting_id: other.meetingId })).toThrow(/belongs to another account/);
    expect(() => write({ play_id: other.playId })).toThrow(/belongs to another account/);
    // And from the other side: the same id on its own account is fine.
    expect(write({ meeting_id: other.meetingId }, other.accountId).entityId).toBeTruthy();
  });

  it("refuses a pointer that leads to a record that is gone, or round in a circle", () => {
    // Only a hand-edited database gets here — a merge writes the pointer and
    // its own guards refuse both shapes — but a stale or circular pointer must
    // stop the write rather than silently keep the tombstone's id.
    db().prepare(`UPDATE meetings SET merged_into = ? WHERE id = ?`).run("no-such-meeting", loserMeeting);
    expect(() => write({ meeting_id: loserMeeting })).toThrow(/no longer exists/);

    db().prepare(`UPDATE meetings SET merged_into = ? WHERE id = ?`).run(seed.meetingId, loserMeeting);
    db().prepare(`UPDATE meetings SET merged_into = ? WHERE id = ?`).run(loserMeeting, seed.meetingId);
    expect(() => write({ meeting_id: loserMeeting })).toThrow(/cannot be resolved/);
  });

  it("refuses when the record that survived has since been archived", () => {
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loserPlay, actorUserId: USER });
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });
    // Reconnecting to an archived survivor would be as quiet as reconnecting
    // to the loser. It says which record it means and stops.
    expect(() => write({ play_id: loserPlay })).toThrow(/is archived; restore it first/);
  });

  it("refuses the accept rather than writing the tombstone's id", () => {
    const batch = createProposalBatch(seed.accountId, { kind: "meeting", id: null, aiRunId: null }, [
      { entity_type: "action_item", op: "create", payload: { text: "Confirm the CFO date", meeting_id: loserMeeting } },
    ]);
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loserMeeting, actorUserId: USER });
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });
    expect(() => acceptProposal(batch.ids[0]!, USER)).toThrow(/is archived; restore it first/);
    // The proposal is still pending, so it can be accepted once somebody has
    // restored the record or decided where the work belongs.
    expect(db().prepare(`SELECT status FROM proposals WHERE id = ?`).pluck().get(batch.ids[0]!)).toBe("pending");
  });

  it("leaves an explicit unlink alone", () => {
    const id = applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Confirm the CFO date", meeting_id: seed.meetingId },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "update", entityId: id, payload: { meeting_id: null }, actorUserId: USER });
    expect(item(id).meeting_id).toBeNull();
  });
});
