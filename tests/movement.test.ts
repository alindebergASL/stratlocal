// What moved, what slipped, and what nobody has touched.
//
// Everything here is enumeration over data change_log has held since the first
// commit, so it is exactly the kind of thing that is cheap to test and
// expensive to be wrong about: a forecast list that cries slip on a two-day
// date change, or that reports an import restating the CRM as though someone
// had decided something, is a list people stop reading.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyEntityChange, acceptProposal, createProposalBatch } from "@/lib/proposals/apply";
import { listMovement, listStalled, quarterRollUp, type Movement } from "@/lib/queries/movement";
import { fiscalQuarter, currentFiscalQuarter } from "@/lib/fiscal";
import { seedAccount, USER, type Seed } from "./helpers";

const DAY = 86_400_000;
let seed: Seed;

// change_log.created_at comes from Date.now(); this ages rows so a window can
// be tested without waiting, and so the seed's own create rows can be pushed
// out of the way.
function ageEverythingBy(ms: number) {
  db().prepare(`UPDATE change_log SET created_at = created_at - ?`).run(ms);
  db().prepare(`UPDATE deals SET created_at = created_at - ?, updated_at = updated_at - ?`).run(ms, ms);
}

function edit(payload: Record<string, unknown>, entityId = seed.dealId) {
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId, payload, actorUserId: USER });
}

function moves(days = 7, opts = {}): Movement[] {
  return listMovement(Date.now() - days * DAY, opts);
}

function kindsFor(dealId: string, days = 7): string[] {
  return moves(days)
    .filter((m) => m.dealId === dealId)
    .map((m) => m.kind);
}

beforeEach(() => {
  seed = seedAccount();
  // The seed's deal closes 2026-12-01. Age it so it is not "new" and its
  // create rows are outside every window under test.
  ageEverythingBy(30 * DAY);
});

describe("a close date that moves", () => {
  it("is not a slip when it stays inside its quarter", () => {
    // Two days is noise. Calling it a slip is how a forecast report earns the
    // reputation of being ignored.
    const before = fiscalQuarter("2026-12-01")!;
    edit({ close_date: "2026-12-18" });
    expect(fiscalQuarter("2026-12-18")!.key).toBe(before.key);
    expect(kindsFor(seed.dealId)).toEqual(["date_moved"]);
  });

  it("is a push when it crosses into a later quarter", () => {
    edit({ close_date: "2027-03-31" });
    const m = moves().find((x) => x.dealId === seed.dealId)!;
    expect(m.kind).toBe("pushed_out");
    expect(m.fromQuarter).toBe(fiscalQuarter("2026-12-01")!.label);
    expect(m.toQuarter).toBe(fiscalQuarter("2027-03-31")!.label);
  });

  it("is a pull when it crosses into an earlier one", () => {
    edit({ close_date: "2026-09-30" });
    expect(kindsFor(seed.dealId)).toEqual(["pulled_in"]);
  });

  it("is one row from where it started to where it ended, however many times it moved", () => {
    // Otherwise a date nudged three times in a week is three contradictory
    // rows, and two of them report a starting point that was never true at the
    // start of the window.
    edit({ close_date: "2027-01-15" });
    edit({ close_date: "2027-02-15" });
    edit({ close_date: "2027-03-31" });
    const rows = moves().filter((m) => m.dealId === seed.dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.from).toBe("2026-12-01");
    expect(rows[0]!.to).toBe("2027-03-31");
  });

  it("is nothing at all when it ends where it began", () => {
    edit({ close_date: "2027-03-31" });
    edit({ close_date: "2026-12-01" });
    expect(kindsFor(seed.dealId)).toEqual([]);
  });
});

describe("the other three fields", () => {
  it("reports a stage in the direction it went", () => {
    edit({ stage: 5 });
    expect(kindsFor(seed.dealId)).toEqual(["stage_up"]);
    edit({ stage: 2 });
    const rows = moves().filter((m) => m.dealId === seed.dealId);
    // Net across the window: started at the seed's stage, ended at 2.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("stage_down");
  });

  it("reports a value with the money it moved by", () => {
    edit({ tcv_usd: 1_500 });
    const m = moves().find((x) => x.dealId === seed.dealId)!;
    expect(m.kind).toBe("value_up");
    expect(m.deltaUsd).toBe(500);
  });

  it("reports won", () => {
    edit({ status: "won" });
    expect(kindsFor(seed.dealId)).toEqual(["won"]);
  });

  it("reports reopened, when reopening is what happened in the window", () => {
    edit({ status: "won" });
    // Won last month, reopened this week: the window starts with it won.
    ageEverythingBy(20 * DAY);
    edit({ status: "open" });
    expect(kindsFor(seed.dealId, 7)).toEqual(["reopened"]);
  });

  it("says nothing when a status ends the window where it started", () => {
    // Won and then reopened in the same week is net nothing, the same rule
    // the close date follows. A list that reported both would be telling you
    // about a decision that was taken back before you read it.
    edit({ status: "won" });
    edit({ status: "open" });
    expect(kindsFor(seed.dealId)).toEqual([]);
  });
});

describe("a deal added inside the window", () => {
  it("is one row of news, not one per field", () => {
    const fresh = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: "SYN-EXTRA-005", name: "Depot refresh", stage: 1, close_date: "2027-02-15", tcv_usd: 400_000 },
      actorUserId: USER,
    }).entityId;
    const rows = moves().filter((m) => m.dealId === fresh);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("new");
  });
});

describe("who moved it", () => {
  it("marks a change that came from accepting an import, and one that did not", () => {
    // Without this, "twelve deals slipped this week" is often really "the CRM
    // export ran on Tuesday" — and the two call for completely different
    // reactions.
    edit({ close_date: "2027-03-31" });
    expect(moves().find((m) => m.dealId === seed.dealId)?.fromImport).toBe(false);

    const batch = createProposalBatch(seed.accountId, { kind: "import", id: "doc-1", aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { stage: 5 }, rationale: "the report says stage 5", source_ref: null },
    ]);
    for (const pid of batch.ids) acceptProposal(pid, USER);

    const stage = moves().find((m) => m.dealId === seed.dealId && m.kind.startsWith("stage"));
    expect(stage?.fromImport).toBe(true);
    // And asking for hand edits only leaves it out while keeping the date.
    const byHand = listMovement(Date.now() - 7 * DAY, { handEditsOnly: true });
    expect(byHand.some((m) => m.kind.startsWith("stage"))).toBe(false);
    expect(byHand.some((m) => m.kind === "pushed_out")).toBe(true);
  });
});

describe("what is left out", () => {
  it("leaves an archived deal out, as every other read surface does", () => {
    edit({ close_date: "2027-03-31" });
    expect(kindsFor(seed.dealId)).toEqual(["pushed_out"]);
    edit({ archived_at: "2026-09-14" });
    expect(kindsFor(seed.dealId)).toEqual([]);
  });

  it("ignores fields that are not a movement in the pipeline", () => {
    edit({ next_step: "Confirm the sizing", owner: "Finley Example", notes: "long story" });
    expect(kindsFor(seed.dealId)).toEqual([]);
  });

  it("ignores anything older than the window", () => {
    edit({ close_date: "2027-03-31" });
    ageEverythingBy(10 * DAY);
    expect(kindsFor(seed.dealId, 7)).toEqual([]);
    expect(kindsFor(seed.dealId, 30)).toEqual(["pushed_out"]);
  });
});

describe("the deal nobody is working", () => {
  it("is an open deal in this quarter that nothing has touched", () => {
    // The inverse of everything above, and the failure mode that costs a
    // quarter: every other signal in this app fires on something happening.
    const closeDate = `${currentFiscalQuarterIsoMonth()}-15`;
    edit({ close_date: closeDate });
    // The edit itself is a touch, so nothing is stalled yet.
    expect(listStalled(Date.now() - 7 * DAY, currentFiscalQuarter())).toHaveLength(0);
    ageEverythingBy(10 * DAY);
    const stalled = listStalled(Date.now() - 7 * DAY, currentFiscalQuarter());
    expect(stalled.map((s) => s.dealId)).toEqual([seed.dealId]);
    expect(stalled[0]!.lastTouched).toBeTruthy();
  });

  it("does not count a deal closing in another quarter, or a closed one", () => {
    const closeDate = `${currentFiscalQuarterIsoMonth()}-15`;
    edit({ close_date: closeDate });
    ageEverythingBy(10 * DAY);
    expect(listStalled(Date.now() - 7 * DAY, currentFiscalQuarter())).toHaveLength(1);

    // Marking it won is a touch *and* takes it out of the open set, so it
    // leaves for both reasons; age again to remove the first.
    edit({ status: "won" });
    ageEverythingBy(10 * DAY);
    expect(listStalled(Date.now() - 7 * DAY, currentFiscalQuarter())).toHaveLength(0);
  });

  it("counts a next step rewritten as working the deal, not as silence", () => {
    // "Nothing has changed" has to mean no change of any kind, not no watched
    // field: someone rewriting the next step on Tuesday is working it.
    const closeDate = `${currentFiscalQuarterIsoMonth()}-15`;
    edit({ close_date: closeDate });
    ageEverythingBy(10 * DAY);
    expect(listStalled(Date.now() - 7 * DAY, currentFiscalQuarter())).toHaveLength(1);
    edit({ next_step: "Chasing their architect" });
    expect(listStalled(Date.now() - 7 * DAY, currentFiscalQuarter())).toHaveLength(0);
  });
});

describe("the quarter roll-up", () => {
  it("counts what is in the quarter now and what moved across its edge", () => {
    const q = currentFiscalQuarter();
    const closeDate = `${currentFiscalQuarterIsoMonth()}-15`;
    edit({ close_date: closeDate, tcv_usd: 1_000_000 });
    const roll = quarterRollUp(Date.now() - 7 * DAY, q);
    expect(roll.label).toBe(q.label);
    expect(roll.inNowUsd).toBe(1_000_000);
    expect(roll.inNowCount).toBe(1);
    // It came from 2026-12-01, so unless that is this quarter it arrived here.
    if (fiscalQuarter("2026-12-01")!.key !== q.key) {
      expect(roll.pulledInUsd + roll.pushedOutUsd).toBeGreaterThan(0);
    }
  });

  it("never shows a total that disagrees with the rows under it", () => {
    // Both come from the same folded change_log rows, which is the only way a
    // page can promise that.
    const q = currentFiscalQuarter();
    edit({ close_date: `${currentFiscalQuarterIsoMonth()}-15` });
    const roll = quarterRollUp(Date.now() - 7 * DAY, q);
    const rows = moves();
    const intoThisQuarter = rows
      .filter((m) => m.kind === "pulled_in" && m.toQuarter === q.label)
      .reduce((s, m) => s + (m.tcvUsd ?? 0), 0);
    expect(roll.pulledInUsd).toBe(intoThisQuarter);
  });
});

// The first day of the current fiscal quarter's middle month, as YYYY-MM, so
// a test date lands inside the quarter whatever day the suite runs on.
function currentFiscalQuarterIsoMonth(): string {
  const now = new Date();
  const q = currentFiscalQuarter(now);
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (fiscalQuarter(`${iso}-15`)!.key === q.key) return iso;
  }
  throw new Error("no month in the current fiscal quarter, which cannot happen");
}
