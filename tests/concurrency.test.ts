// Two people, one record.
//
// Accepting a proposal has always compared before_json against the live row
// and refused when they disagreed. A form save compared nothing: an
// unconditional UPDATE keyed on the primary key, so whoever pressed the button
// second won and the screen said "Saved" in green. change_log holds both sides
// for most fields, so the loss is reconstructible by someone who thinks to
// look. For a meeting's notes it is not: raw_notes is a LARGE_FIELD, history
// records "4.1 KB → 1.2 KB", and the column is the only copy there has ever
// been.
//
// The check is deliberately narrow. A save is refused when the other person
// changed a field this save would also change — not merely because they
// touched the row. Blocking a next-step edit because someone fixed a typo in
// the notes would teach both of them to press Save anyway without reading.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { latestInstallBase } from "@/lib/queries/accounts";
import { applyEntityChange, archiveEntity, ConflictError, restoreEntity } from "@/lib/proposals/apply";
import { seedAccount, USER, type Seed } from "./helpers";

const THEM = "user-2";
let seed: Seed;

// Everything a test writes lands in the same millisecond, which is not a
// situation two people at two keyboards can produce. This pushes what is
// already written into the past, so "since this form was rendered" has a
// boundary to mean something against. It is the test harness standing in for
// elapsed time, not a workaround for the check: the check compares
// change_log.created_at against the updated_at a form carried, and those come
// from the same Date.now() within one write.
function rewind(ms = 2000) {
  const conn = db();
  conn.prepare(`UPDATE change_log SET created_at = created_at - ?`).run(ms);
  for (const table of ["accounts", "contacts", "deals", "install_base", "plays", "meetings", "action_items"]) {
    conn.prepare(`UPDATE ${table} SET updated_at = updated_at - ?`).run(ms);
  }
}

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
  rewind();
});

// What the form would have rendered with: the row as it stands now.
function versionOf(table: string, pk: string, id: string): number {
  return (db().prepare(`SELECT updated_at FROM ${table} WHERE ${pk} = ?`).get(id) as { updated_at: number }).updated_at;
}

const dealVersion = () => versionOf("deals", "deal_id", seed.dealId);
const meetingVersion = () => versionOf("meetings", "id", seed.meetingId);

function editDeal(payload: Record<string, unknown>, actor: string, baseVersion?: number | null) {
  return applyEntityChange({
    accountId: seed.accountId,
    entityType: "deal",
    op: "update",
    entityId: seed.dealId,
    payload,
    actorUserId: actor,
    baseVersion,
  });
}

describe("the second save", () => {
  it("goes through when the two of you touched different fields", () => {
    const mine = dealVersion();
    editDeal({ notes: "Their CFO is new" }, THEM);
    // My form was rendered before that and knows nothing about it — but I am
    // editing the next step, which they did not touch.
    expect(() => editDeal({ next_step: "Book the architecture review" }, USER, mine)).not.toThrow();
    const row = db().prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(seed.dealId) as Record<string, unknown>;
    expect(row.next_step).toBe("Book the architecture review");
    expect(row.notes).toBe("Their CFO is new");
  });

  it("is refused when it would overwrite what the other one just wrote", () => {
    const mine = dealVersion();
    editDeal({ next_step: "Send the sizing document" }, THEM);

    let caught: ConflictError | null = null;
    try {
      editDeal({ next_step: "Book the architecture review" }, USER, mine);
    } catch (e) {
      caught = e instanceof ConflictError ? e : null;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect(caught?.conflicts).toHaveLength(1);
    // Enough to explain it without making anyone go and look: which field,
    // what it says now, and who put it there.
    expect(caught?.conflicts[0]?.field).toBe("next_step");
    expect(caught?.conflicts[0]?.theirs).toContain("Send the sizing document");
    expect(caught?.conflicts[0]?.actorUserId).toBe(THEM);

    // And nothing was written.
    const row = db().prepare(`SELECT next_step FROM deals WHERE deal_id = ?`).get(seed.dealId) as { next_step: string };
    expect(row.next_step).toBe("Send the sizing document");
  });

  it("goes through on the second press, with the version it was told", () => {
    const mine = dealVersion();
    editDeal({ next_step: "Send the sizing document" }, THEM);
    const conflict = (() => {
      try {
        editDeal({ next_step: "Book the architecture review" }, USER, mine);
      } catch (e) {
        return e as ConflictError;
      }
      return null;
    })();
    expect(conflict?.currentVersion).toBe(dealVersion());

    editDeal({ next_step: "Book the architecture review" }, USER, conflict!.currentVersion);
    const row = db().prepare(`SELECT next_step FROM deals WHERE deal_id = ?`).get(seed.dealId) as { next_step: string };
    expect(row.next_step).toBe("Book the architecture review");
  });

  it("is not refused for agreeing with them", () => {
    // Both of you typed the same thing. There is nothing to lose, so there is
    // nothing to stop — this is the same allowance the proposal drift check
    // has always made.
    const mine = dealVersion();
    editDeal({ next_step: "Send the sizing document" }, THEM);
    expect(() => editDeal({ next_step: "Send the sizing document" }, USER, mine)).not.toThrow();
  });

  it("changes nothing for a caller that does not pass a version", () => {
    editDeal({ next_step: "Send the sizing document" }, THEM);
    // Every existing caller — the proposal path above all, which has its own
    // drift check against before_json — keeps the behaviour it had.
    expect(() => editDeal({ next_step: "Book the architecture review" }, USER)).not.toThrow();
  });
});

describe("a meeting's notes", () => {
  const NOTES = "They are midway through the migration. Budget sits with finance until March.";

  it("does not quietly replace ten minutes of someone else's typing", () => {
    const mine = meetingVersion();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { raw_notes: NOTES },
      actorUserId: THEM,
      baseVersion: null,
    });

    expect(() =>
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "meeting",
        op: "update",
        entityId: seed.meetingId,
        payload: { raw_notes: "Ran long on introductions." },
        actorUserId: USER,
        baseVersion: mine,
      }),
    ).toThrow(ConflictError);

    const row = db().prepare(`SELECT raw_notes FROM meetings WHERE id = ?`).get(seed.meetingId) as { raw_notes: string };
    expect(row.raw_notes).toBe(NOTES);
  });

  it("reports the size rather than the text, which is the whole reason this matters", () => {
    const mine = meetingVersion();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { raw_notes: NOTES },
      actorUserId: THEM,
    });
    let caught: ConflictError | null = null;
    try {
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "meeting",
        op: "update",
        entityId: seed.meetingId,
        payload: { raw_notes: "mine" },
        actorUserId: USER,
        baseVersion: mine,
      });
    } catch (e) {
      caught = e as ConflictError;
    }
    // The marker history keeps for a document-sized field. It is not the
    // other person's text, because nothing anywhere has the other person's
    // text once it is overwritten — which is why this is refused and not
    // merely logged.
    expect(caught?.conflicts[0]?.theirs).toMatch(/\d+ B|KB/);
  });
});

describe("a record archived while the form was open", () => {
  it("refuses the save rather than writing to a row nobody can see", () => {
    const mine = dealVersion();
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: THEM });
    expect(() => editDeal({ next_step: "Book the architecture review" }, USER, mine)).toThrow(/was archived while this was open/);
  });

  it("still lets a restore through, by hand or from an import", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: THEM });
    expect(() => restoreEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER })).not.toThrow();

    // The shape an import uses when the report still lists a row someone
    // archived: the restore rides along with the real changes.
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: THEM });
    expect(() => editDeal({ archived_at: null, stage: 4 }, USER)).not.toThrow();
    const row = db().prepare(`SELECT archived_at, stage FROM deals WHERE deal_id = ?`).get(seed.dealId) as {
      archived_at: string | null;
      stage: number;
    };
    expect(row.archived_at).toBeNull();
    expect(row.stage).toBe(4);
  });
});

describe("a blank required field", () => {
  it("leaves the field alone rather than trying to clear it", () => {
    // Zod's .partial() keeps a key whose value is undefined, so
    // `name: str(fd, "name") ?? undefined` — the pattern every action uses to
    // mean "leave this alone" — reached the writer as an explicit null and hit
    // a NOT NULL constraint, discarding the whole form. A single space in a
    // field HTML marks `required` is enough to get there.
    expect(() => editDeal({ name: undefined, next_step: "still saved" }, USER)).not.toThrow();
    const row = db().prepare(`SELECT name, next_step FROM deals WHERE deal_id = ?`).get(seed.dealId) as {
      name: string;
      next_step: string;
    };
    expect(row.name).toBe("EHR Refresh");
    expect(row.next_step).toBe("still saved");
  });

  it("does not count an omitted field as one this save would change", () => {
    const mine = dealVersion();
    editDeal({ name: "Renamed by them" }, THEM);
    // My form sends name: undefined. If that survived into the payload it
    // would look like a field I am changing, and collide with theirs.
    expect(() => editDeal({ name: undefined, next_step: "mine" }, USER, mine)).not.toThrow();
  });
});

describe("an install-base figure, corrected by two people", () => {
  // install_base was the only entity table with no `updated_at` at all, so it
  // was the one record where two people could overwrite each other silently:
  // there was no version for a form to carry and nothing for the check to
  // compare. Migration 013 is what lets it join.
  //
  // `rewind` is load-bearing here rather than decorative. `updated_at` is
  // Date.now(), so two writes inside one millisecond leave the version
  // unchanged and no conflict is detectable — a version of this test without
  // it passed by luck and failed on a later run, which is worse than either.
  beforeEach(() => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      op: "create",
      payload: { product_family: "Compute", value_usd: 4_100_000, share_pct: 34, as_of: "2026-06-30" },
      actorUserId: USER,
    });
    rewind();
  });

  const row = () => latestInstallBase(seed.accountId).rows.find((r) => r.product_family === "Compute")!;

  it("refuses the second save and says what the first one put there", () => {
    const base = row().updated_at;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      entityId: row().id,
      op: "update",
      payload: { value_usd: 4_250_000 },
      actorUserId: USER,
    });
    let refused: unknown = null;
    try {
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "install_base",
        entityId: row().id,
        op: "update",
        payload: { value_usd: 3_000_000 },
        actorUserId: "user-2",
        baseVersion: base,
      });
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).conflicts.map((c) => c.field)).toEqual(["value_usd"]);
    expect(row().value_usd).toBe(4_250_000);
  });

  it("lets a save through that touches a different field", () => {
    // The check is about overlap, not about being behind: correcting the note
    // while the other one corrects the figure is not a collision.
    const base = row().updated_at;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      entityId: row().id,
      op: "update",
      payload: { value_usd: 4_250_000 },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      entityId: row().id,
      op: "update",
      payload: { role_note: "Refresh due next year" },
      actorUserId: "user-2",
      baseVersion: base,
    });
    expect(row()).toMatchObject({ value_usd: 4_250_000, role_note: "Refresh due next year" });
  });
});
