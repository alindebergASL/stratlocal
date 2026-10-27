// What a person's page can answer.
//
// The reverse scan is the whole point: a meeting knows who was in it, and
// until this existed nobody could ask a person what they had been in. That
// makes it the one query worth enumerating — it reads a JSON blob through
// json_each, so a schema the app writes one way and reads another would fail
// silently and show an empty page rather than an error.
import { beforeEach, describe, expect, it } from "vitest";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { mergeContacts } from "@/lib/proposals/merge";
import { getContact } from "@/lib/queries/accounts";
import { meetingsAttendedBy } from "@/lib/queries/meetings";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;

beforeEach(() => {
  seed = seedAccount();
});

function meeting(title: string, heldAt: string, attendees: Array<{ contact_id: string | null; name: string; note?: string | null }>): string {
  return applyEntityChange({
    accountId: seed.accountId,
    entityType: "meeting",
    op: "create",
    payload: { title, held_at: heldAt, attendees: attendees.map((a) => ({ note: null, ...a })) },
    actorUserId: USER,
  }).entityId;
}

describe("every meeting this person was in", () => {
  it("finds the one the seed put them in", () => {
    expect(meetingsAttendedBy(seed.contactId).map((m) => m.id)).toEqual([seed.meetingId]);
  });

  it("orders them newest first, which is the order you want before a call", () => {
    const older = meeting("First call", "2026-06-02", [{ contact_id: seed.contactId, name: "Finley Example" }]);
    const newer = meeting("Follow-up", "2026-11-04", [{ contact_id: seed.contactId, name: "Finley Example" }]);
    expect(meetingsAttendedBy(seed.contactId).map((m) => m.id)).toEqual([newer, seed.meetingId, older]);
  });

  it("does not match someone else who was in the room", () => {
    const other = applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Sam Okafor", org: "customer" },
      actorUserId: USER,
    }).entityId;
    meeting("Architecture session", "2026-10-01", [{ contact_id: other, name: "Sam Okafor" }]);
    expect(meetingsAttendedBy(seed.contactId).map((m) => m.title)).toEqual(["Quarterly review"]);
    expect(meetingsAttendedBy(other).map((m) => m.title)).toEqual(["Architecture session"]);
  });

  it("ignores an attendee written down by name alone", () => {
    // Extraction records someone it could not match with a null contact_id.
    // json_extract returns SQL NULL for that, which must not equal anything.
    meeting("Intro", "2026-08-01", [{ contact_id: null, name: "Someone we have not met" }]);
    expect(meetingsAttendedBy(seed.contactId)).toHaveLength(1);
  });

  it("drops an archived meeting, like every other list", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });
    expect(meetingsAttendedBy(seed.contactId)).toEqual([]);
  });

  it("follows a merge, because the merge rewrites the attendee", () => {
    const dupe = applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "D. Example", org: "customer" },
      actorUserId: USER,
    }).entityId;
    const theirs = meeting("Sizing call", "2026-10-20", [{ contact_id: dupe, name: "D. Example" }]);
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: dupe, actorUserId: USER });
    // The duplicate's meeting now answers under the person who survived, which
    // is the reason a merge is worth doing rather than just archiving.
    expect(meetingsAttendedBy(seed.contactId).map((m) => m.id).sort()).toEqual([theirs, seed.meetingId].sort());
    expect(meetingsAttendedBy(dupe)).toEqual([]);
  });
});

describe("reaching an archived person", () => {
  it("still resolves, so the page can offer Restore", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "contact", entityId: seed.contactId, actorUserId: USER });
    expect(getContact(seed.contactId)?.name).toBe("Finley Example");
    expect(getContact("no-such-person")).toBeNull();
  });
});
