// Two people share these accounts, and until now "what did my partner change
// while I was away" had no answer: change_log was read on exactly one screen,
// and Home's window is applied inside the SQL, so a week-old change was never
// selected rather than merely pushed off the list.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { applyEntityChange, acceptProposal, createProposalBatch } from "@/lib/proposals/apply";
import { recentChanges } from "@/lib/queries/today";
import { dayOf } from "@/lib/clock";
import { seedAccount, USER, type Seed } from "./helpers";

const OTHER_USER = "user-2";
let seed: Seed;

// change_log.created_at is set from Date.now(); this ages rows so a window can
// be tested without waiting.
function ageEverythingBy(ms: number) {
  db().prepare(`UPDATE change_log SET created_at = created_at - ?`).run(ms);
}

const DAY = 86_400_000;

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("what changed", () => {
  it("finds a change from last week, which Home's three days never could", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "Jamie agreed the sizing review" },
      actorUserId: OTHER_USER,
    });
    ageEverythingBy(6 * DAY);

    expect(recentChanges(Date.now() - 3 * DAY)).toHaveLength(0);
    const week = recentChanges(Date.now() - 7 * DAY, 200);
    expect(week.length).toBeGreaterThan(0);
    expect(week.some((c) => c.kind === "edit" && c.entityId === seed.dealId)).toBe(true);
  });

  it("says who made each change", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "mine" },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "update",
      entityId: seed.contactId,
      payload: { title: "theirs" },
      actorUserId: OTHER_USER,
    });
    const rows = recentChanges(Date.now() - DAY, 200);
    // The leading name is whoever wrote last, which is what "who changed
    // this" means. The seed created both records, so the contact — created by
    // one of them and edited by the other — carries both names, in that order.
    expect(rows.find((c) => c.kind === "edit" && c.entityId === seed.dealId)?.actors[0]).toBe(USER);
    expect(rows.find((c) => c.kind === "edit" && c.entityId === seed.contactId)?.actors[0]).toBe(OTHER_USER);
  });

  it("collapses an accepted batch to one row and keeps hand edits separate", () => {
    const batch = createProposalBatch(seed.accountId, { kind: "import", id: "doc-1", aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { stage: 4, next_step: "from the report" }, rationale: null, source_ref: null },
      { entity_type: "contact", op: "update", entity_id: seed.contactId, payload: { title: "Director" }, rationale: null, source_ref: null },
    ]);
    for (const pid of batch.ids) acceptProposal(pid, USER);
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { next_step: "typed by hand" },
      actorUserId: USER,
    });

    const rows = recentChanges(Date.now() - DAY, 200);
    const batches = rows.filter((c) => c.kind === "batch");
    expect(batches).toHaveLength(1);
    // Three fields across two records, as one thing that happened.
    expect(batches[0]).toMatchObject({ records: 2, fields: 3 });
    // The hand edit keeps its own row rather than being folded into the
    // batch. (Creating the seed records was also done by hand, so there are
    // other edit rows; what matters is that this one is not lost.)
    const edits = rows.filter((c) => c.kind === "edit");
    const play = edits.find((c) => c.kind === "edit" && c.entityId === seed.playId);
    expect(play).toBeDefined();
    expect(play?.kind === "edit" && play.changes.map((c) => c.field)).toContain("next_step");
  });

  it("says what a field moved from and to, not only that it moved", () => {
    // The page exists to answer "what did my partner do while I was away", and
    // it printed the names of the fields and nothing else: "close_date,
    // tcv_usd". That cannot distinguish pulling a $1K deal into this quarter
    // from pushing it out. change_log has held both values since Phase 1 and
    // the query deliberately did not select them.
    // The seed's own create rows are aged out of today first: a record created
    // and then edited on one day correctly reads "— → the new value", which is
    // true and is not what this is testing.
    ageEverythingBy(2 * DAY);
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { close_date: "2027-03-31", tcv_usd: 1_500 },
      actorUserId: USER,
    });
    const row = recentChanges(Date.now() - DAY, 200).find((c) => c.kind === "edit" && c.entityId === seed.dealId);
    expect(row?.kind).toBe("edit");
    const changes = row?.kind === "edit" ? row.changes : [];
    const close = changes.find((c) => c.field === "close_date");
    expect(close?.from).toBe(JSON.stringify("2026-12-01"));
    expect(close?.to).toBe(JSON.stringify("2027-03-31"));
    const tcv = changes.find((c) => c.field === "tcv_usd");
    expect(tcv?.from).toBe("1000");
    expect(tcv?.to).toBe("1500");
  });

  it("folds two edits to one field on one day into where it started and ended", () => {
    // Otherwise a field touched twice reads as two contradictory lines under
    // the same heading. Rows arrive newest first, so the older row supplies
    // the truer `from` and the newer one keeps its `to`.
    ageEverythingBy(2 * DAY);
    for (const next of ["first go", "second go", "third go"]) {
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "deal",
        op: "update",
        entityId: seed.dealId,
        payload: { next_step: next },
        actorUserId: USER,
      });
    }
    const row = recentChanges(Date.now() - DAY, 200).find((c) => c.kind === "edit" && c.entityId === seed.dealId);
    const changes = row?.kind === "edit" ? row.changes.filter((c) => c.field === "next_step") : [];
    expect(changes).toHaveLength(1);
    expect(changes[0]?.to).toBe(JSON.stringify("third go"));
    // Where it stood at the start of the day, not the intermediate step.
    expect(changes[0]?.from).not.toBe(JSON.stringify("second go"));
    expect(changes[0]?.from).not.toBe(JSON.stringify("first go"));
  });

  it("reports a long value as its size rather than carrying it", () => {
    // /activity renders up to 200 rows; a deal's notes hold 4000 characters
    // and meeting notes are unbounded. The size is what history already shows
    // for a meeting's notes, and it is honest in a way a truncated sentence
    // is not.
    const long = "They walked through the current footprint and where it is short. ".repeat(20);
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { notes: long },
      actorUserId: USER,
    });
    const row = recentChanges(Date.now() - DAY, 200).find((c) => c.kind === "edit" && c.entityId === seed.dealId);
    const notes = row?.kind === "edit" ? row.changes.find((c) => c.field === "notes") : undefined;
    expect(notes?.to).toBeNull();
    expect(notes?.toBytes).toBeGreaterThan(1000);
    // And a short one on the same record still comes through whole.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { owner: "Finley Example" },
      actorUserId: USER,
    });
    const after = recentChanges(Date.now() - DAY, 200).find((c) => c.kind === "edit" && c.entityId === seed.dealId);
    const owner = after?.kind === "edit" ? after.changes.find((c) => c.field === "owner") : undefined;
    expect(owner?.to).toBe(JSON.stringify("Finley Example"));
  });

  // The bug this page shipped with: the SQL grouped on the record alone,
  // across the whole window, so on a thirty-day view two edits to one deal
  // three weeks apart became one row dated the later day. The earlier one did
  // not move down the list — it was not on the page at all.
  it("keeps an edit from three weeks ago under its own day", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "the old one" },
      actorUserId: USER,
    });
    ageEverythingBy(21 * DAY);
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "the new one" },
      actorUserId: USER,
    });

    const month = recentChanges(Date.now() - 30 * DAY, 200);
    const rows = month.filter((c) => c.kind === "edit" && c.entityId === seed.dealId);
    expect(rows).toHaveLength(2);
    // Two different days, so the page's day headings have something to put
    // each of them under.
    expect(new Set(rows.map((c) => dayOf(c.at))).size).toBe(2);
  });

  it("names both people when both edited the same record", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "mine first" },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "theirs second" },
      actorUserId: OTHER_USER,
    });

    const row = recentChanges(Date.now() - DAY, 200).find((c) => c.kind === "edit" && c.entityId === seed.dealId);
    expect(row).toBeDefined();
    // The later writer leads, because "who changed this" means the person
    // whose value is on the record now. MAX() over a uuid answered neither
    // question: it picked whichever id sorted higher.
    expect(row?.actors[0]).toBe(OTHER_USER);
    expect(row?.actors).toHaveLength(2);
    expect(row?.actors).toContain(USER);
  });

  it("narrows to one account", () => {
    const other = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name: "Fabrikam Health" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "here" },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: other,
      entityType: "account",
      op: "update",
      entityId: other,
      payload: { thesis: "there" },
      actorUserId: USER,
    });

    const mine = recentChanges(Date.now() - DAY, 200, seed.accountId);
    expect(mine.every((c) => c.accountId === seed.accountId)).toBe(true);
    expect(mine.some((c) => c.kind === "edit" && c.entityId === seed.dealId)).toBe(true);

    const theirs = recentChanges(Date.now() - DAY, 200, other);
    expect(theirs.every((c) => c.accountId === other)).toBe(true);
  });
});

describe("a record written down for the first time", () => {
  it("says what was filled in rather than diffing every field from nothing", () => {
    // On a create, applyEntityChange writes one row per field with old_value
    // null — so the diff reads "as of — → 2026-10-01; share pct — → 33; value
    // usd — → 100", which is the record's own contents dressed as a
    // change. It costs twice the bytes of the field names and says nothing
    // the record's name did not: /activity went from 306 KB to 726 KB on the
    // committed fixture before this, against DECISIONS #20.
    // The outer beforeEach already seeded one, which is exactly the case:
    // every field of that deal went from nothing to a value, just now.
    const row = recentChanges(Date.now() - DAY, 200).find((c) => c.kind === "edit" && c.entityId === seed.dealId);
    const changes = row?.kind === "edit" ? row.changes : [];
    expect(changes.length).toBeGreaterThan(2);
    expect(changes.every((c) => c.from === null && c.fromBytes === 0)).toBe(true);

    // Edited on a later day, it is a real change again — and one field that
    // was empty at create still reads as filled in rather than as a move from
    // nothing, which is also true.
    ageEverythingBy(2 * DAY);
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { tcv_usd: 1_500, next_step: "Confirm the sizing" },
      actorUserId: USER,
    });
    const after = recentChanges(Date.now() - DAY, 200).find((c) => c.kind === "edit" && c.entityId === seed.dealId);
    const money = after?.kind === "edit" ? after.changes.find((c) => c.field === "tcv_usd") : undefined;
    expect(money?.from).toBe("1000");
    expect(money?.to).toBe("1500");
    expect(after?.kind === "edit" && after.changes.every((c) => c.from === null)).toBe(false);
  });
});
