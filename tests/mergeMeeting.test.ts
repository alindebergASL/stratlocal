// Two records of one call — the same conversation written down twice, usually
// because both of us made a meeting for it.
//
// Nothing in the app matches a meeting by its content, so unlike a play this
// cannot be resurrected by an importer. What it can be is half-undone: the
// Archived block offers Restore for every archived row, and a restored loser
// would come back with its follow-ups and attendees now answering to the
// keeper. That is the same half a record `restoreEntity` already refuses for a
// merged-away deal, which is why a meeting gets the pointer too.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type ActionItemRow, type MeetingRow } from "@/lib/db";
import { applyEntityChange, archiveEntity, createProposalBatch, restoreEntity } from "@/lib/proposals/apply";
import { mergeMeetings, previewMeetingMerge } from "@/lib/proposals/merge";
import { entityHistory, entityHistoryFor, mergedMeetingIds } from "@/lib/queries/accounts";
import { likelyDuplicateMeetings, listArchived, listMeetings } from "@/lib/queries/meetings";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;
let loserId: string;
let otherContactId: string;

function meeting(id: string): MeetingRow {
  return db().prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as MeetingRow;
}
function items(accountId: string): ActionItemRow[] {
  return db().prepare(`SELECT * FROM action_items WHERE account_id = ?`).all(accountId) as ActionItemRow[];
}

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
  otherContactId = applyEntityChange({
    accountId: seed.accountId,
    entityType: "contact",
    op: "create",
    payload: { name: "Avery Example", org: "customer" },
    actorUserId: USER,
  }).entityId;

  // The keeper has the notes one of us typed and no summary. The loser is the
  // same call, written down by the other one, with a different attendee, its
  // own half of the notes, a summary and a brief.
  applyEntityChange({
    accountId: seed.accountId,
    entityType: "meeting",
    op: "update",
    entityId: seed.meetingId,
    payload: { raw_notes: "Mine: they want the refresh done before the fiscal year ends." },
    actorUserId: USER,
  });
  loserId = applyEntityChange({
    accountId: seed.accountId,
    entityType: "meeting",
    op: "create",
    payload: {
      title: "Quarterly review (Avery's notes)",
      held_at: "2026-09-15",
      held_time: "14:00",
      attendees: [{ contact_id: otherContactId, name: "Avery Example", note: null }],
      raw_notes: "Theirs: budget sits with the CFO until November.",
      summary: "Refresh is funded; timing is the open question.",
      brief_json: JSON.stringify({ situation: [] }),
    },
    actorUserId: USER,
  }).entityId;
});

describe("merging two records of one meeting", () => {
  it("unions the attendees, keeps both sets of notes, and archives the loser", () => {
    const followUp = applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Confirm the CFO date", meeting_id: loserId },
      actorUserId: USER,
    }).entityId;

    const result = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });

    const keeper = meeting(seed.meetingId);
    const attendees = JSON.parse(keeper.attendees_json) as Array<{ contact_id: string | null }>;
    expect(attendees.map((a) => a.contact_id).sort()).toEqual([seed.contactId, otherContactId].sort());

    // Keep both, the Phase 7 answer: raw_notes is a large field, so history
    // holds its size and not its text and the column is the only copy there is.
    expect(keeper.raw_notes).toContain("they want the refresh done");
    expect(keeper.raw_notes).toContain("budget sits with the CFO");
    expect(keeper.raw_notes).toContain("Quarterly review (Avery's notes)");

    // A blank summary is an omission and gets filled; a brief is a dated
    // document and is never merged — but the merge says so rather than
    // leaving you to notice.
    expect(keeper.summary).toBe("Refresh is funded; timing is the open question.");
    expect(keeper.held_time).toBe("14:00");
    expect(result.notCopied.join(" ")).toMatch(/brief/i);

    expect(items(seed.accountId).find((i) => i.id === followUp)?.meeting_id).toBe(seed.meetingId);
    expect(result.followUpsRelinked).toBe(1);

    expect(meeting(loserId).archived_at).not.toBeNull();
    expect(meeting(loserId).merged_into).toBe(seed.meetingId);
    expect(listMeetings(seed.accountId).map((m) => m.id)).toEqual([seed.meetingId]);
    // The loser's own notes are still readable on its own page. Nothing is
    // deleted here either.
    expect(meeting(loserId).raw_notes).toContain("budget sits with the CFO");
  });

  it("keeps the keeper's notes when there is nothing to add", () => {
    const bare = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Duplicate with nothing in it", held_at: "2026-09-15", attendees: [] },
      actorUserId: USER,
    }).entityId;
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: bare, actorUserId: USER });
    expect(meeting(seed.meetingId).raw_notes).toBe("Mine: they want the refresh done before the fiscal year ends.");
  });

  it("refuses the ways a merge would lose something", () => {
    expect(() => mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: seed.meetingId, actorUserId: USER })).toThrow(
      /same meeting/i,
    );
    const other = seedAccount({ name: "Other Synthetic Account", dealId: "SYN-DEAL-900" });
    expect(() => mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: other.meetingId, actorUserId: USER })).toThrow(
      /same account/i,
    );
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });
    expect(() => mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER })).toThrow(/archived/i);
  });

  it("rejects what was still proposed for the loser, including when it was archived by hand first", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: loserId, actorUserId: USER });
    const batch = createProposalBatch(seed.accountId, { kind: "meeting", id: loserId, aiRunId: null }, [
      { entity_type: "meeting", op: "update", entity_id: loserId, payload: { summary: "Something proposed" }, rationale: "x", source_ref: null },
    ]);
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    const status = db().prepare(`SELECT status FROM proposals WHERE id = ?`).pluck().get(batch.ids[0]!);
    expect(status).toBe("rejected");
  });

  it("is a tombstone, not something to restore", () => {
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    expect(() => restoreEntity({ accountId: seed.accountId, entityType: "meeting", entityId: loserId, actorUserId: USER })).toThrow(
      /merged into/i,
    );
    expect(listArchived(seed.accountId).meetings.map((m) => m.id)).not.toContain(loserId);
  });

  it("history resolves across the pair", () => {
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    expect(mergedMeetingIds(seed.meetingId)).toEqual([loserId]);
    const both = entityHistoryFor("meeting", [seed.meetingId, ...mergedMeetingIds(seed.meetingId)], 200);
    expect(both.some((h) => h.entity_id === loserId)).toBe(true);
    expect(both.some((h) => h.field === "merged_from")).toBe(true);
    expect(entityHistory("meeting", loserId, 50).some((h) => h.field === "merged_into")).toBe(true);
  });

  it("offers the duplicate by day, and stops offering it once merged", () => {
    expect(likelyDuplicateMeetings(seed.accountId, seed.meetingId).map((m) => m.id)).toEqual([loserId]);
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    expect(likelyDuplicateMeetings(seed.accountId, seed.meetingId)).toEqual([]);
  });
});

describe("the caps that would otherwise throw from inside the transaction", () => {
  it("keeps what fits and says what it could not carry", () => {
    // MeetingPatch caps attendees at 50 and longText at 200k. A union past
    // either must not become a ZodError that loses the whole merge —
    // DECISIONS #27, the same half Phase 17 applied to the handoff.
    const many = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({ contact_id: null, name: `${prefix} ${i}`, note: null }));
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { attendees: many(40, "Ours"), raw_notes: "m".repeat(150_000) },
      actorUserId: USER,
    });
    const big = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "The other write-up", held_at: "2026-09-15", attendees: many(30, "Theirs"), raw_notes: "t".repeat(150_000) },
      actorUserId: USER,
    }).entityId;

    const result = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: big, actorUserId: USER });
    const keeper = meeting(seed.meetingId);
    expect(JSON.parse(keeper.attendees_json)).toHaveLength(50);
    expect(keeper.raw_notes).toBe("m".repeat(150_000));
    expect(result.notCopied.join(" ")).toMatch(/attendee/i);
    expect(result.notCopied.join(" ")).toMatch(/notes/i);
  });
});

// ---- the audit finding: an unreadable list is not an empty one -------------

describe("a merge does not lose what it could not read", () => {
  it("leaves the keeper's attendees alone when its own list will not parse", () => {
    // Only a hand-edited database or a schema change gets here. It is in
    // because `[]` from a failed parse reads exactly like "nobody was there",
    // so the union wrote the loser's list over a list it had simply failed to
    // read — the one shape this app is built never to do quietly.
    db().prepare(`UPDATE meetings SET attendees_json = ? WHERE id = ?`).run("{not json", seed.meetingId);
    const result = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    expect(meeting(seed.meetingId).attendees_json).toBe("{not json");
    expect(result.notCopied.join(" ")).toMatch(/could not be read/);
  });

  it("says so when it is the loser's list that will not parse", () => {
    db().prepare(`UPDATE meetings SET attendees_json = ? WHERE id = ?`).run("{not json", loserId);
    const before = meeting(seed.meetingId).attendees_json;
    const result = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    expect(meeting(seed.meetingId).attendees_json).toBe(before);
    expect(result.notCopied.join(" ")).toMatch(/could not be read/);
  });

  it("carries the other record's attendee across an equal-length union", () => {
    // The same length-versus-membership defect the play links had. Two of us
    // ticking the same person leaves the keeper's stored list holding them
    // twice, which is schema-valid, and the deduped union was then compared to
    // that raw list by length: two in, two out, no patch, and the person only
    // the other record remembered was dropped as that record was archived as
    // merged.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: {
        attendees: [
          { contact_id: seed.contactId, name: "Finley Example", note: null },
          { contact_id: seed.contactId, name: "Finley Example", note: null },
        ],
      },
      actorUserId: USER,
    });

    const preview = previewMeetingMerge({ accountId: seed.accountId, keeperId: seed.meetingId, loserId });
    expect(preview.ok && preview.preview.attendeesAdded).toBe(1);

    const result = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    const after = JSON.parse(meeting(seed.meetingId).attendees_json) as Array<{ contact_id: string | null }>;
    expect(after.map((a) => a.contact_id)).toEqual([seed.contactId, otherContactId]);
    expect(result.notCopied.join(" ")).not.toMatch(/attendees/);
  });

  it("leaves a keeper's duplicate alone when the other record names nobody new", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: {
        attendees: [
          { contact_id: seed.contactId, name: "Finley Example", note: null },
          { contact_id: seed.contactId, name: "Finley Example", note: null },
        ],
      },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: loserId,
      payload: { attendees: [{ contact_id: seed.contactId, name: "Finley Example", note: null }] },
      actorUserId: USER,
    });

    const before = meeting(seed.meetingId).attendees_json;
    const result = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    expect(meeting(seed.meetingId).attendees_json).toBe(before);
    expect(result.fieldsFilled).not.toContain("attendees");
  });

  it("counts what fits and says what did not, when the union runs past the cap", () => {
    // The keeper holds 50 rows naming 49 people, so its duplicate is inside
    // the cap; the loser names two more. One fits, one does not, and the
    // disclosure has to be the arithmetic the write actually did.
    const mine = Array.from({ length: 49 }, (_, i) => ({ contact_id: null, name: `Synthetic Person ${i}`, note: null }));
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { attendees: [...mine, { contact_id: null, name: "Synthetic Person 0", note: null }] },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: loserId,
      payload: {
        attendees: [
          { contact_id: null, name: "Synthetic Person 90", note: null },
          { contact_id: null, name: "Synthetic Person 91", note: null },
        ],
      },
      actorUserId: USER,
    });

    const preview = previewMeetingMerge({ accountId: seed.accountId, keeperId: seed.meetingId, loserId });
    expect(preview.ok && preview.preview.attendeesAdded).toBe(1);
    const result = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    const after = JSON.parse(meeting(seed.meetingId).attendees_json) as Array<{ name: string }>;
    expect(after).toHaveLength(50);
    expect(after.map((a) => a.name)).toContain("Synthetic Person 90");
    expect(after.map((a) => a.name)).not.toContain("Synthetic Person 91");
    expect(result.notCopied.join(" ")).toMatch(/1 attendees past the 50/);
  });

  it("an empty list is still an empty list, and unions normally", () => {
    // The distinction has to cut both ways or it is just a refusal to merge.
    db().prepare(`UPDATE meetings SET attendees_json = ? WHERE id = ?`).run("[]", seed.meetingId);
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId, actorUserId: USER });
    const after = JSON.parse(meeting(seed.meetingId).attendees_json) as Array<{ contact_id: string | null }>;
    expect(after.map((x) => x.contact_id)).toEqual([otherContactId]);
  });
});
