// What a merge is about to do, said before you press it.
//
// A merge cannot be undone, and the meeting picker offers any record on the
// same day — which is an ordinary false offer in front of an irreversible
// action. The answer is not to gate the picker (a person knows two records are
// one call when no rule ever will) but to say what this particular pair will
// do to each other first.
//
// The invariant this file exists for: the preview and the merge are the same
// computation. A second implementation for the screen is how a sentence and a
// behaviour drift apart, so both come from one planner and this asserts they
// agree — on a pair chosen to exercise every branch at once.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { mergeMeetings, mergePlays, previewMeetingMerge, previewPlayMerge } from "@/lib/proposals/merge";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("what a play merge says it will do is what it does", () => {
  it("agrees with the merge on every count and every sentence", () => {
    const loser = applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "create",
      payload: {
        title: "EHR Platform Defense",
        status: "proposed",
        thesis: "Hold the platform through the refresh",
        owner: "Avery Example",
        contact_ids: [seed.contactId],
      },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the architecture pack", play_id: loser },
      actorUserId: USER,
    });

    const p = previewPlayMerge({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // The numbers a person reads before pressing.
    expect(p.preview.followUps).toBe(1);
    expect(p.preview.peopleAdded).toBe(1);
    expect(p.preview.dealsAdded).toBe(0);
    expect(p.preview.loserLabel).toBe("EHR Platform Defense");

    const done = mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser, actorUserId: USER });
    expect(done.followUpsRelinked).toBe(p.preview.followUps);
    expect(done.fieldsFilled.slice().sort()).toEqual(p.preview.fieldsFilled.slice().sort());
    expect(done.notCopied).toEqual(p.preview.notCopied);
  });

  it("says why it would be refused instead of throwing at the press", () => {
    const loser = applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "create",
      payload: { title: "Another play", status: "proposed" },
      actorUserId: USER,
    }).entityId;
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });
    const p = previewPlayMerge({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser });
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.why).toMatch(/archived/i);
  });
});

describe("what a meeting merge says it will do is what it does", () => {
  it("agrees with the merge, and never carries the notes into the preview", () => {
    const other = applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Avery Example", org: "customer" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { raw_notes: "m".repeat(5000) },
      actorUserId: USER,
    });
    const loser = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "create",
      payload: {
        title: "Quarterly review (Avery's notes)",
        held_at: "2026-09-15",
        attendees: [{ contact_id: other, name: "Avery Example", note: null }],
        raw_notes: "t".repeat(5000),
        summary: "Funded; timing is the question.",
        brief_json: JSON.stringify({ situation: [] }),
      },
      actorUserId: USER,
    }).entityId;

    const p = previewMeetingMerge({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loser });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.preview.attendeesAdded).toBe(1);
    expect(p.preview.notes).toBe("keep-both");
    expect(p.preview.notCopied.join(" ")).toMatch(/brief/i);
    // The preview is rendered inside a closed ActionForm, which serialises its
    // children whether or not anyone opens it. raw_notes is a LARGE_FIELD —
    // putting the joined text in here would ship 10 KB per candidate to draw
    // one sentence, which is the trap this app has fallen into twice.
    expect(JSON.stringify(p.preview).length).toBeLessThan(2000);

    const done = mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loser, actorUserId: USER });
    expect(done.notCopied).toEqual(p.preview.notCopied);
    // Attendees and notes are reported on their own — as a count and as which
    // of the three things it will do with them — so they are deliberately not
    // in `fieldsFilled` as well. Everything the preview does name must be
    // something the merge actually changed: it may say less, never more.
    expect(p.preview.fieldsFilled).toEqual(["summary"]);
    for (const f of p.preview.fieldsFilled) expect(done.fieldsFilled).toContain(f);
    expect(done.fieldsFilled.slice().sort()).toEqual(["attendees", "raw_notes", "summary"]);
  });

  it("leaves nothing behind: a preview is read-only", () => {
    const loser = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Same call", held_at: "2026-09-15", attendees: [] },
      actorUserId: USER,
    }).entityId;
    previewMeetingMerge({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loser });
    previewMeetingMerge({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loser });
    // Nothing archived, nothing pointed anywhere, nothing in history.
    const row = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: loser,
      payload: { summary: "still editable" },
      actorUserId: USER,
    });
    expect(row.changedFields).toEqual(["summary"]);
  });
});
