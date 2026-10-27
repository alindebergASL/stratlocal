// SYNTHETIC ONLY: invented sandbox ids, people and amounts.
//
// The one path from "the brief suggests this" to a real follow-up. What is
// covered here is everything that would let a model's sentence become a
// business record without a person deciding it, or let it become two.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type ActionItemRow } from "@/lib/db";
import { archiveDocument } from "@/lib/documents";
import { acceptNote } from "@/lib/research/notes";
import { ApplyError, applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { briefFingerprint, briefFollowUps, createFollowUpFromBrief } from "@/lib/meetings/briefFollowUp";
import { seedAccount, USER, type Seed } from "./helpers";
import { insertResearchNote } from "./briefFixtures";

let seed: Seed;

function storeBrief(meetingId: string, over: Record<string, unknown> = {}): string {
  const brief = {
    conversation: {
      purpose: "Settle a date for the technical review.",
      facts: [{ text: "EHR Refresh is at stage 3.", source_refs: [{ kind: "deal", id: seed.dealId }] }],
      hypothesis: null,
      questions: ["Who has to agree before this moves?"],
      connection: { text: "This meeting is about EHR Refresh.", source_refs: [{ kind: "deal", id: seed.dealId }] },
      uncertainty: "Nothing has been confirmed with them since the last meeting.",
    },
    situation: [{ text: "The refresh is the deal that matters.", source_refs: [{ kind: "deal", id: seed.dealId }] }],
    deals_in_play: [],
    attendees: [],
    changes_since_last: [],
    questions: [],
    risks: [],
    proposed_next_step: {
      concern: "The deal has no dated next step.",
      action: "Agree a technical review date before the call ends.",
      owner: "Alex",
      target_date: "2026-10-01",
      blocker: null,
      evidence_ids: [seed.dealId],
    },
    ...over,
  };
  const json = JSON.stringify(brief);
  applyEntityChange({
    accountId: seed.accountId,
    entityType: "meeting",
    op: "update",
    entityId: meetingId,
    payload: { brief_json: json },
    actorUserId: USER,
    sourceRef: { kind: "meeting", id: meetingId },
  });
  return briefFingerprint(json)!;
}

function items(): ActionItemRow[] {
  return db().prepare(`SELECT * FROM action_items WHERE account_id = ?`).all(seed.accountId) as ActionItemRow[];
}

function confirm(fingerprint: string, over: Partial<Parameters<typeof createFollowUpFromBrief>[0]> = {}) {
  return createFollowUpFromBrief({
    accountId: seed.accountId,
    meetingId: seed.meetingId,
    userId: USER,
    fingerprint,
    text: "Agree a technical review date before the call ends.",
    ownerChoice: USER,
    due: "2026-10-01",
    dueUnknown: false,
    ackEvidence: false,
    ...over,
  });
}

beforeEach(() => {
  resetDbForTests();
  // A real login, because "one of us" is checked against the user table: an
  // owner the form offers has to exist.
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(USER, "alex@example.test", "unused", "Alex", 1, 1);
  seed = seedAccount();
});

describe("confirming the brief's next step", () => {
  it("writes nothing until somebody confirms it", () => {
    const fingerprint = storeBrief(seed.meetingId);
    // Reading the brief, resolving its evidence and rendering the form are all
    // reads. The count is the assertion.
    expect(items()).toHaveLength(0);
    expect(briefFollowUps(seed.accountId, seed.meetingId)).toEqual([]);
    confirm(fingerprint);
    expect(items()).toHaveLength(1);
  });

  it("records the owner and date the person chose, on this meeting", () => {
    const fingerprint = storeBrief(seed.meetingId);
    const { status, itemId } = confirm(fingerprint, { ownerChoice: USER, due: "2026-11-03" });
    expect(status).toBe("created");
    const row = items().find((i) => i.id === itemId)!;
    expect(row.owner_user_id).toBe(USER);
    expect(row.due).toBe("2026-11-03");
    expect(row.meeting_id).toBe(seed.meetingId);
    expect(row.status).toBe("open");
  });

  it("keeps the AI origin and the evidence on the record, not a user-authored note", () => {
    const fingerprint = storeBrief(seed.meetingId);
    const { itemId } = confirm(fingerprint);
    const ref = JSON.parse(items().find((i) => i.id === itemId)!.source_ref_json!);
    expect(ref.origin).toBe("ai_generated");
    expect(ref.kind).toBe("ai");
    // The model's own wording survives beside the text that was agreed.
    expect(ref.quote).toContain("Agree a technical review date");
    expect(ref.refs).toContainEqual({ kind: "deal", id: seed.dealId });
    expect(ref.refs).toContainEqual({ kind: "meeting", id: seed.meetingId });
    const readBack = briefFollowUps(seed.accountId, seed.meetingId);
    expect(readBack).toHaveLength(1);
    expect(readBack[0]!.evidence).toContainEqual({ kind: "deal", id: seed.dealId });
  });

  it("takes an edited line, and still cites what the brief cited", () => {
    const fingerprint = storeBrief(seed.meetingId);
    const { itemId } = confirm(fingerprint, { text: "  Book the technical review for the week of the 12th.  " });
    const row = items().find((i) => i.id === itemId)!;
    expect(row.text).toBe("Book the technical review for the week of the 12th.");
    expect(JSON.parse(row.source_ref_json!).refs).toContainEqual({ kind: "deal", id: seed.dealId });
  });

  it("records no owner and no date when that is what was chosen, and invents neither", () => {
    const fingerprint = storeBrief(seed.meetingId);
    const { itemId } = confirm(fingerprint, { ownerChoice: "unassigned", due: null, dueUnknown: true });
    const row = items().find((i) => i.id === itemId)!;
    expect(row.owner_user_id).toBeNull();
    // The brief suggested "Alex" and 2026-10-01. Neither reaches the record.
    expect(row.owner).toBeNull();
    expect(row.due).toBeNull();
  });

  it("refuses a choice of owner or date that was never made", () => {
    const fingerprint = storeBrief(seed.meetingId);
    expect(() => confirm(fingerprint, { ownerChoice: null })).toThrow(/Choose an owner/);
    expect(() => confirm(fingerprint, { ownerChoice: "someone-else" })).toThrow(/not one of us/);
    expect(() => confirm(fingerprint, { due: null, dueUnknown: false })).toThrow(/Pick a date/);
    expect(() => confirm(fingerprint, { due: "2026-10-01", dueUnknown: true })).toThrow(/not both/);
    expect(() => confirm(fingerprint, { due: "2026-02-30" })).toThrow(/not a real day/);
    expect(() => confirm(fingerprint, { text: "   " })).toThrow(/needs something to do/);
    expect(items()).toHaveLength(0);
  });
});

describe("pressing it twice", () => {
  it("makes one follow-up, not two", () => {
    const fingerprint = storeBrief(seed.meetingId);
    const first = confirm(fingerprint);
    // The reply was lost; the same form is submitted again.
    const second = confirm(fingerprint);
    expect(second.status).toBe("already");
    expect(second.itemId).toBe(first.itemId);
    expect(items()).toHaveLength(1);
  });

  it("matches on the line, not on its spacing or case", () => {
    const fingerprint = storeBrief(seed.meetingId);
    confirm(fingerprint);
    expect(confirm(fingerprint, { text: "AGREE a technical   review date before the call ends." }).status).toBe("already");
    expect(items()).toHaveLength(1);
  });
});

describe("what has moved since the brief was written", () => {
  it("refuses a form opened against a brief that has since been regenerated", () => {
    const stale = storeBrief(seed.meetingId);
    storeBrief(seed.meetingId, { proposed_next_step: { concern: "Different now.", action: "Do something else.", owner: null, target_date: null, blocker: null, evidence_ids: [] } });
    expect(() => confirm(stale)).toThrow(/changed since this was opened/);
    expect(items()).toHaveLength(0);
  });

  it("refuses when the research behind the next step is no longer retained", () => {
    const noteId = insertResearchNote(seed.accountId, { sourceExcerpt: true });
    const fingerprint = storeBrief(seed.meetingId, {
      proposed_next_step: { concern: "Their plan runs to 2029.", action: "Ask what the plan funds next year.", owner: null, target_date: null, blocker: null, evidence_ids: [`${noteId}#0`] },
    });
    archiveDocument(noteId, USER);
    expect(() => confirm(fingerprint, { text: "Ask what the plan funds next year." })).toThrow(/no longer current/);
    expect(items()).toHaveLength(0);
  });

  it("asks for an acknowledgment when the evidence is an unverified report excerpt", () => {
    const noteId = insertResearchNote(seed.accountId);
    const fingerprint = storeBrief(seed.meetingId, {
      proposed_next_step: { concern: "Their plan runs to 2029.", action: "Ask what the plan funds next year.", owner: null, target_date: null, blocker: null, evidence_ids: [`${noteId}#0`] },
    });
    const input = { text: "Ask what the plan funds next year." };
    expect(() => confirm(fingerprint, input)).toThrow(/Acknowledge source review/);
    expect(items()).toHaveLength(0);
    expect(confirm(fingerprint, { ...input, ackEvidence: true }).status).toBe("created");
  });

  it("refuses the entire next step when one cited finding was unticked, even with a live deal", () => {
    const noteId = insertResearchNote(seed.accountId, { sourceExcerpt: true });
    const fingerprint = storeBrief(seed.meetingId, {
      proposed_next_step: {
        concern: "Their plan runs to 2029.",
        action: "Ask what the plan funds next year.",
        owner: null,
        target_date: null,
        blocker: null,
        evidence_ids: [`${noteId}#1`, seed.dealId],
      },
    });
    acceptNote(noteId, [0], USER);
    const before = db().prepare("SELECT COUNT(*) AS n FROM proposals").get();
    expect(() => confirm(fingerprint, { text: "Ask what the plan funds next year." })).toThrow(/no longer current/);
    expect(items()).toHaveLength(0);
    expect(db().prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual(before);
  });
});

describe("records that are not there to write to", () => {
  it("refuses a meeting on another account", () => {
    const other = seedAccount({ name: "Synthetic Fernbrook", dealId: "SYN-DEAL-002" });
    const fingerprint = storeBrief(seed.meetingId);
    expect(() => confirm(fingerprint, { meetingId: other.meetingId })).toThrow(/not on this account/);
    expect(items()).toHaveLength(0);
  });

  it("refuses an archived meeting and an archived account", () => {
    const fingerprint = storeBrief(seed.meetingId);
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });
    expect(() => confirm(fingerprint)).toThrow(/archived/);
    archiveEntity({ accountId: seed.accountId, entityType: "account", entityId: seed.accountId, actorUserId: USER });
    expect(() => confirm(fingerprint)).toThrow(/missing or archived/);
    expect(items()).toHaveLength(0);
  });

  it("refuses a meeting with no brief on it", () => {
    expect(() => confirm("nothing")).toThrow(/no brief on this meeting/);
  });

  it("refuses a meeting that does not exist", () => {
    storeBrief(seed.meetingId);
    expect(() => confirm("nothing", { meetingId: "no-such-meeting" })).toThrow(/not on this account/);
  });
});

describe("a brief column that will not parse", () => {
  it("is refused as an application error the action can report, not a SyntaxError it rethrows", () => {
    const fingerprint = storeBrief(seed.meetingId);
    db().prepare("UPDATE meetings SET brief_json = ? WHERE id = ?").run("{not json", seed.meetingId);
    let caught: unknown;
    try { confirm(fingerprint); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApplyError);
    expect((caught as ApplyError).message).toMatch(/cannot be read/);
    expect(items()).toEqual([]);
  });
});
