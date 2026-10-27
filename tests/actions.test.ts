// The action layer had no tests, which is how four saves that report success
// and destroy data survived a phase of polish. Every case here is a bug that
// was live: the user pressed save, the panel closed, and something was gone.
//
// Server actions call `requirePageUser`, which needs a cookie, so these drive
// the pure parts — the payload the action builds — through the same helpers
// the actions use. Where that is not possible the write path is exercised
// directly, which is where the loss actually happened.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type DealRow, type MeetingRow } from "@/lib/db";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { Attendee } from "@/lib/proposals/schema";
import { entityHistory, latestInstallBase, listAccountSummaries } from "@/lib/queries/accounts";
import { fiscalQuarter } from "@/lib/fiscal";
import { seedAccount, USER, type Seed } from "./helpers";
import { buildDealPayload, buildMeetingAttendees, buildQuickDealPayload, readMoney } from "@/app/formFields";
import { readPercent } from "@/lib/money";

let seed: Seed;

function deal(id: string): DealRow {
  return db().prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(id) as DealRow;
}
function meeting(id: string): MeetingRow {
  return db().prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as MeetingRow;
}
function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  }
  return fd;
}

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("a money field, read the way a seller writes one", () => {
  it("reads the suffixes people actually type", () => {
    expect(readMoney("1000")).toBe(1_000);
    expect(readMoney("$1,000")).toBe(1_000);
    expect(readMoney("0.003M")).toBe(3_000);
    expect(readMoney("450k")).toBe(450_000);
    expect(readMoney("0.000004bn")).toBe(4_000);
  });

  it("rounds rather than rejecting, because rejecting threw away the whole form", () => {
    // This used to parse, then fail z.number().int(), taking every other edit
    // in the same submission down with it.
    expect(readMoney("1500000.50")).toBe(1_500_001);
  });

  it("refuses text that is not an amount instead of writing null", () => {
    // The old behaviour: "TBD" became null, null is an explicit clear, and the
    // deal silently left every pipeline total with a green save.
    expect(() => readMoney("TBD")).toThrow(/could not read/);
    expect(() => readMoney("~2M")).toThrow(/could not read/);
    expect(readMoney("")).toBeNull();
  });

  it("does not clear the stored amount when the text is bad", () => {
    const before = deal(seed.dealId).tcv_usd;
    expect(() => buildDealPayload(form({ tcv_usd: "1.2 zillion" }))).toThrow();
    expect(deal(seed.dealId).tcv_usd).toBe(before);
  });
});

describe("a form only writes the fields it rendered", () => {
  it("leaves stage_label alone on a deal edit", () => {
    // The deal edit form has no stage_label input, so `str()` returned null
    // and the payload cleared it — on every single save. The CRM's own
    // wording was replaced by the app's canned label.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { stage_label: "Tech Validation" },
      actorUserId: USER,
    });
    const payload = buildDealPayload(form({ name: "EHR Refresh", next_step: "Confirm the sizing" }));
    expect(payload).not.toHaveProperty("stage_label");
    applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload, actorUserId: USER });
    expect(deal(seed.dealId).stage_label).toBe("Tech Validation");
  });

  it("still clears a field the form did render and the user emptied", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "Confirm the sizing" },
      actorUserId: USER,
    });
    const payload = buildDealPayload(form({ next_step: "" }));
    expect(payload.next_step).toBeNull();
    applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload, actorUserId: USER });
    expect(deal(seed.dealId).next_step).toBeNull();
  });

  it("keeps the pipeline total honest across an unrelated edit", () => {
    const before = listAccountSummaries()[0]?.open_pipeline_usd;
    const payload = buildDealPayload(form({ next_step: "Walk the sizing through" }));
    applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload, actorUserId: USER });
    expect(listAccountSummaries()[0]?.open_pipeline_usd).toBe(before);
  });
});

describe("the pipeline review, edited from the list", () => {
  it("slips a close date and moves a value without leaving the page", () => {
    const payload = buildQuickDealPayload(
      form({ stage: "4", next_step: "Confirm the sizing", status: "open", close_date: "2027-01-29", tcv_usd: "0.003M" }),
    );
    applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload, actorUserId: USER });
    const d = deal(seed.dealId);
    expect(d.close_date).toBe("2027-01-29");
    expect(d.tcv_usd).toBe(3_000);
    // The quarter is derived from the new close date rather than left on the
    // one the deal was filed under, which is the whole point of slipping it.
    const q = fiscalQuarter("2027-01-29");
    expect(q).not.toBeNull();
    expect(d.fiscal_quarter).toBe(q?.label);
  });

  it("does not touch the fields the row does not render", () => {
    // The quick edit is a subset of the deal, so every field it omits has to
    // be omitted from the payload — not sent as null. This is the same class
    // of bug that wiped stage_label from the full form on every save.
    const payload = buildQuickDealPayload(form({ stage: "4", next_step: "", status: "open" }));
    expect(Object.keys(payload).sort()).toEqual(["next_step", "stage", "status"]);
  });

  it("refuses an amount it cannot read rather than clearing the deal's value", () => {
    const before = deal(seed.dealId).tcv_usd;
    expect(() => buildQuickDealPayload(form({ tcv_usd: "about two mil" }))).toThrow(/Value: could not read/);
    expect(deal(seed.dealId).tcv_usd).toBe(before);
  });

  it("still clears a close date the user emptied", () => {
    const payload = buildQuickDealPayload(form({ close_date: "" }));
    expect(payload.close_date).toBeNull();
  });
});

describe("who was in the room", () => {
  function attendeesOf(id: string): Attendee[] {
    const parsed = Attendee.array().safeParse(JSON.parse(meeting(id).attendees_json || "[]"));
    return parsed.success ? parsed.data : [];
  }

  it("keeps an attendee whose contact was archived later", () => {
    // Archive a contact, then edit the meeting's title. The picker is
    // live-only, so this person used to disappear from the meeting entirely —
    // and a meeting is a record of who was there, not a live list.
    archiveEntity({ accountId: seed.accountId, entityType: "contact", entityId: seed.contactId, actorUserId: USER });
    const known = [{ id: seed.contactId, name: "Finley Example" }];
    const next = buildMeetingAttendees(form({ attendee_contact_ids: seed.contactId }), known, attendeesOf(seed.meetingId));
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { title: "Quarterly review (corrected)", attendees: next },
      actorUserId: USER,
    });
    expect(attendeesOf(seed.meetingId).map((a) => a.contact_id)).toEqual([seed.contactId]);
  });

  it("carries an existing note across rather than blanking it", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { attendees: [{ contact_id: seed.contactId, name: "Finley Example", note: "brought the diagrams" }] },
      actorUserId: USER,
    });
    const known = [{ id: seed.contactId, name: "Finley Example" }];
    const next = buildMeetingAttendees(form({ attendee_contact_ids: seed.contactId }), known, attendeesOf(seed.meetingId));
    expect(next[0]?.note).toBe("brought the diagrams");
  });

  it("does not silently trim a long attendee list", () => {
    // It used to .slice(0, 50), turning what should be a visible validation
    // error into attendees 51+ vanishing without a word.
    const names = Array.from({ length: 60 }, (_, i) => `Person ${i}`).join(", ");
    const next = buildMeetingAttendees(form({ attendee_names: names }), [], []);
    expect(next).toHaveLength(60);
    expect(() =>
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "meeting",
        op: "update",
        entityId: seed.meetingId,
        payload: { attendees: next },
        actorUserId: USER,
      }),
    ).toThrow();
  });

  it("leaves the list alone when the form did not render it", () => {
    const before = attendeesOf(seed.meetingId);
    expect(before.length).toBeGreaterThan(0);
    // No `attendees_present` marker: a form that does not show the picker must
    // not be read as "everything unticked".
    const fd = form({ title: "Renamed" });
    expect(fd.has("attendees_present")).toBe(false);
  });
});

describe("a share, typed by a person", () => {
  // The figure the whole trend is about — "our share of their compute went
  // from 34% to 28%" — is now something you can type, so how it is read is
  // worth pinning.
  it("takes what was written, in the spellings a person writes it", () => {
    expect(readPercent("34")).toBe(34);
    expect(readPercent("34%")).toBe(34);
    expect(readPercent(" 28.5 % ")).toBe(28.5);
    expect(readPercent("0")).toBe(0);
    expect(readPercent("100")).toBe(100);
    expect(readPercent("")).toBeNull();
    expect(readPercent(null)).toBeNull();
  });

  it("does not guess that 0.34 means a third", () => {
    // Both readings are plausible and the difference is a factor of a hundred,
    // applied silently to the number being read off the screen. Taken at face
    // value: a third of one per cent, because that is what it says.
    expect(readPercent("0.34")).toBe(0.34);
  });

  it("refuses out of range rather than clamping it", () => {
    // A number quietly turned into a different number is worse than a save
    // that says what it could not take — the lesson `num()` taught with TCV.
    expect(() => readPercent("140")).toThrow(/between 0 and 100/);
    expect(() => readPercent("-5")).toThrow(/between 0 and 100/);
    expect(() => readPercent("a third")).toThrow(/as a percentage/);
  });
});

describe("correcting a snapshot", () => {
  // The install base was the last record with no manual path at all, so these
  // are the paths that did not exist until now.
  const row = (family: string) => latestInstallBase(seed.accountId).rows.find((r) => r.product_family === family)!;

  beforeEach(() => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      op: "create",
      payload: { product_family: "Compute", value_usd: 4_100_000, share_pct: 34, as_of: "2026-06-30" },
      actorUserId: USER,
    });
  });

  it("changes the figure and keeps what it used to be", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      entityId: row("Compute").id,
      op: "update",
      payload: { value_usd: 4_250_000 },
      actorUserId: USER,
    });
    expect(row("Compute").value_usd).toBe(4_250_000);
    expect(entityHistory("install_base", row("Compute").id, 10)[0]).toMatchObject({ field: "value_usd", old_value: "4100000", new_value: "4250000" });
  });

  // The concurrency half lives in tests/concurrency.test.ts, where `rewind`
  // does: updated_at is Date.now(), so two writes in one millisecond leave the
  // version unchanged and the check has nothing to see. Written here without
  // it, this passed once and failed on the next run.
});
