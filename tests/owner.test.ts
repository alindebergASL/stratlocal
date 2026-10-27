// Whose account is it.
//
// Two people run fifteen accounts and nothing in the app knew which of them
// ran which: Home listed all fifteen identically to both, and the only
// "owner" anywhere was a deal's free-text `owner`, written by the CRM report,
// where "Jamie" and "Jamie L." are two different owners and neither is a
// person this app can resolve.
//
// The filter is one clause on accounts.owner_user_id, pushed into SQL rather
// than applied to the rows afterwards — which is the property worth testing,
// because several of these queries carry a LIMIT and a post-filter would
// silently under-report it. So every assertion here goes through a real query
// rather than through the helper that builds the clause.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { listAccountSummaries, listOpenDeals } from "@/lib/queries/accounts";
import { listAttention } from "@/lib/queries/attention";
import { dayCounts, meetingsAwaitingNotes, recentChanges, upcomingMeetings } from "@/lib/queries/today";
import { listMovement, listStalled, quarterRollUp } from "@/lib/queries/movement";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { entityLabels } from "@/lib/queries/labels";
import { ownerLabels, parseOwnerScope, type OwnerFilter } from "@/lib/queries/owner";
import { seedAccount, USER, type Seed } from "./helpers";

const THEM = "user-2";

// The day the fixture's meeting sits on, at an hour where it is still coming
// up rather than awaiting its notes.
const NOW = new Date("2026-09-15T15:00:00Z");

let mine: Seed;
let theirs: Seed;
let shared: Seed;
// The real clock, read once the fixture is written.
//
// The deploy branch found this same bug independently and fixed it by freezing
// Date.now for the whole file. Both work; only one is kept, because two
// mechanisms guarding one property leave the next reader unable to tell which
// is load-bearing — and freezing the clock also gives every seeded row an
// identical timestamp, which would hide an ordering bug rather than expose it.
//
// Everything below is seeded by beforeEach at `Date.now()`, not at NOW, and
// "stalled" is the one surface here that asks whether a deal has *not* changed
// since a moment — so reading its window off the fixed NOW above compared a
// constant against the wall clock. It passed while the real time of day was
// before 15:00 UTC and failed after it: CI ran 44ce53f green at 00:58 and the
// same commit red at 15:04, with nothing in between. The window is taken from
// the fixture instead, which is what the assertion always meant.
let seededAt: number;

function setOwner(accountId: string, ownerUserId: string | null) {
  applyEntityChange({
    accountId,
    entityType: "account",
    op: "update",
    entityId: accountId,
    payload: { owner_user_id: ownerUserId },
    actorUserId: USER,
  });
}

beforeEach(() => {
  resetDbForTests();
  // The test database seeds no users (USER1_EMAIL is unset under vitest), and
  // both halves of this feature are about naming a person, so the two of them
  // are written here.
  const insert = db().prepare(
    `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  insert.run(USER, "alex@example.com", "x", "Alex Calloway", now, now);
  insert.run(THEM, "jamie@example.com", "x", "Jamie Okafor", now, now);
  // Closing inside the fiscal quarter NOW sits in, because that is what
  // listStalled and the quarter roll-up are about — the fixture's default
  // close date is a quarter later and both would be vacuously empty.
  const closeDate = "2026-10-15";
  mine = seedAccount({ name: "Mine Ltd", dealId: "SYN-EXTRA-011", closeDate });
  theirs = seedAccount({ name: "Theirs Ltd", dealId: "SYN-EXTRA-012", closeDate });
  shared = seedAccount({ name: "Shared Ltd", dealId: "SYN-EXTRA-013", closeDate });
  setOwner(mine.accountId, USER);
  setOwner(theirs.accountId, THEM);
  // shared is left alone: null is the default and a real answer, not a gap.
  seededAt = Date.now() + 1;
});

// Every list surface the filter reaches, asked the same question at once —
// the shape tests/archive.test.ts uses, and for the same reason: a filter
// missed at one call site is invisible until the day someone relies on it.
function visible(filter: OwnerFilter): Record<string, string[]> {
  const scope = parseOwnerScope(filter, USER);
  const quarter = currentFiscalQuarter(NOW);
  const since = NOW.getTime() - 30 * 86_400_000;
  const names = (ids: string[]) =>
    ids
      .map((id) => (db().prepare(`SELECT name FROM accounts WHERE id = ?`).get(id) as { name: string } | undefined)?.name ?? id)
      .sort();
  return {
    accounts: listAccountSummaries(scope).map((a) => a.name).sort(),
    deals: names(listOpenDeals({ scope }).map((d) => d.account_id)),
    upcoming: names(upcomingMeetings(NOW, 7, scope).map((m) => m.accountId)),
    awaiting: names(meetingsAwaitingNotes(new Date("2026-09-16T20:00:00Z"), 7, scope).map((m) => m.accountId)),
    attention: [...new Set(listAttention(NOW, scope).map((a) => a.accountName))].sort(),
    changes: [...new Set(recentChanges(since, 200, null, scope).map((c) => c.accountName))].sort(),
    movement: [...new Set(listMovement(since, { scope }).map((m) => m.accountName))].sort(),
    // A different window on purpose, and one taken from the fixture rather
    // than from NOW: "stalled" means nothing changed since, and every row here
    // was written moments ago at the real clock. The thirty-day window above
    // would make this vacuously empty; a fixed NOW made it depend on the hour
    // of day the suite happened to run at.
    stalled: [...new Set(listStalled(seededAt, quarter, { scope }).map((s) => s.accountName))].sort(),
  };
}

describe("the filter reaches every list", () => {
  it("shows everything by default", () => {
    const all = visible("all");
    for (const [surface, rows] of Object.entries(all)) {
      expect({ surface, rows }).toEqual({ surface, rows: ["Mine Ltd", "Shared Ltd", "Theirs Ltd"] });
    }
  });

  it("narrows to one person, and to what they share", () => {
    expect(visible("mine")).toEqual({
      accounts: ["Mine Ltd"],
      deals: ["Mine Ltd"],
      upcoming: ["Mine Ltd"],
      awaiting: ["Mine Ltd"],
      attention: ["Mine Ltd"],
      changes: ["Mine Ltd"],
      movement: ["Mine Ltd"],
      stalled: ["Mine Ltd"],
    });
    expect(visible("theirs")).toEqual({
      accounts: ["Theirs Ltd"],
      deals: ["Theirs Ltd"],
      upcoming: ["Theirs Ltd"],
      awaiting: ["Theirs Ltd"],
      attention: ["Theirs Ltd"],
      changes: ["Theirs Ltd"],
      movement: ["Theirs Ltd"],
      stalled: ["Theirs Ltd"],
    });
    // The one that would be wrong if null were treated as missing data rather
    // than as its own answer: an account the two of them run together.
    expect(visible("shared")).toEqual({
      accounts: ["Shared Ltd"],
      deals: ["Shared Ltd"],
      upcoming: ["Shared Ltd"],
      awaiting: ["Shared Ltd"],
      attention: ["Shared Ltd"],
      changes: ["Shared Ltd"],
      movement: ["Shared Ltd"],
      stalled: ["Shared Ltd"],
    });
  });

  it("counts what it lists, so no total describes a set nobody can see", () => {
    // The stat strip is a separate set of queries from the lists under it, and
    // a page whose headline number disagreed with its rows would be worse than
    // one with no filter at all.
    expect(dayCounts(NOW, parseOwnerScope("all", USER)).noNextStep).toBe(
      listOpenDeals({ scope: parseOwnerScope("all", USER) }).filter((d) => !d.next_step && d.fiscal_quarter === currentFiscalQuarter(NOW).label)
        .length,
    );
    const minedCounts = dayCounts(NOW, parseOwnerScope("mine", USER));
    expect(minedCounts.meetingsToday).toBe(1);
    expect(dayCounts(NOW, parseOwnerScope("all", USER)).meetingsToday).toBe(3);
  });

  it("keeps the roll-up and the rows the same set", () => {
    // quarterRollUp reads the deals table itself for "what is in the quarter
    // now", so it has its own copy of the clause. It being wrong would show as
    // a total over three accounts above a list of one.
    const quarter = currentFiscalQuarter(NOW);
    const since = NOW.getTime() - 30 * 86_400_000;
    const scope = parseOwnerScope("mine", USER);
    const roll = quarterRollUp(since, quarter, { scope });
    const openMine = listOpenDeals({ scope }).filter((d) => d.fiscal_quarter === quarter.label);
    expect(roll.inNowCount).toBe(openMine.length);
    expect(roll.inNowUsd).toBe(openMine.reduce((s, d) => s + (d.tcv_usd ?? 0), 0));
    expect(quarterRollUp(since, quarter).inNowCount).toBe(3);
  });
});

describe("the field itself", () => {
  it("is a change like any other, so a handover has a dated line", () => {
    const rows = db()
      .prepare(`SELECT old_value, new_value FROM change_log WHERE entity_type = 'account' AND entity_id = ? AND field = 'owner_user_id'`)
      .all(mine.accountId) as Array<{ old_value: string | null; new_value: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.new_value).toBe(JSON.stringify(USER));
  });

  it("renders as a name rather than a uuid", () => {
    // change_log holds the id, and both owner fields in this app — a
    // follow-up's since migration 007 and an account's since 009 — showed a
    // raw uuid in history and on /activity, on the two fields whose entire
    // purpose is naming a person.
    expect(entityLabels(mine.accountId)[USER]).toBeTruthy();
    expect(entityLabels(mine.accountId)[THEM]).toBe("Jamie Okafor");
  });

  it("names the other person on the filter rather than saying “theirs”", () => {
    const labels = ownerLabels([{ id: USER, display_name: "Alex Calloway" }, { id: THEM, display_name: "Jamie Okafor" }], USER);
    expect(labels.theirs).toBe("Jamie Okafor");
    expect(labels.mine).toBe("Mine");
    // With nobody else to name, the generic word is the honest one.
    expect(ownerLabels([{ id: USER, display_name: "Alex Calloway" }], USER).theirs).toBe("Theirs");
  });

  it("falls back to everything for a value nobody offered", () => {
    expect(parseOwnerScope("whoever", USER).filter).toBe("all");
    expect(parseOwnerScope(undefined, USER).filter).toBe("all");
  });

  it("matches nothing rather than everything when there is no signed-in id", () => {
    // "Mine" with no `me` is a question with no answer, and answering it with
    // the unfiltered list would put every account under a heading claiming
    // they are one person's.
    expect(listAccountSummaries(parseOwnerScope("mine", null))).toHaveLength(0);
    expect(listAccountSummaries(parseOwnerScope("theirs", null)).map((a) => a.name).sort()).toEqual(["Mine Ltd", "Theirs Ltd"]);
  });
});
