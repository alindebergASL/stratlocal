// Does the owner id bind to the placeholder its own clause put in the SQL?
//
// `ownerClause` returns a SQL fragment and its bindings separately, and every
// caller has to splice those bindings in at the position the fragment lands.
// better-sqlite3 binds `?` strictly by order, so getting that wrong does not
// throw — it compares an account owner against a stage number, returns the
// wrong rows, and every screen above it looks reasonable.
//
// tests/owner.test.ts asserts the *answers* are right, and it is the better
// test of the two for what the feature means. It cannot catch this, though,
// and the reason is worth writing down: it only ever asks for the owner filter
// on its own. With one clause there is one binding and order cannot be wrong.
// The bug needs a second filter beside it — `/pipeline?owner=mine&stage=3` —
// which is how the page is actually used. Moving listOpenDeals' `args.push`
// after the other three filters leaves all nine of those tests green and fails
// exactly one here.
//
// So this counts placeholders rather than reading the code, and it covers the
// call sites at once, because the next one added is the one nobody re-reads.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { listAccountSummaries, listOpenDeals } from "@/lib/queries/accounts";
import { listAttention } from "@/lib/queries/attention";
import { dayCounts, meetingsAwaitingNotes, recentChanges, upcomingMeetings } from "@/lib/queries/today";
import { listMovement, listStalled, quarterRollUp } from "@/lib/queries/movement";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { seedAccount } from "./helpers";

const ME = "SENTINEL-OWNER-ID";
const scope = { filter: "mine" as const, me: ME };

type Seen = { sql: string; args: unknown[] };

/**
 * Every statement a call prepares, with what it was bound with.
 *
 * The driver is patched for the duration of one call rather than the query
 * being re-implemented here: the point is to see the SQL that actually ran.
 */
type Runner = (...args: unknown[]) => unknown;
type Patchable = Record<"all" | "get", Runner>;
type Conn = { prepare: (sql: string) => unknown };

function record(run: () => void): Seen[] {
  const conn = db() as unknown as Conn;
  const seen: Seen[] = [];
  const realPrepare = conn.prepare.bind(conn);
  conn.prepare = (sql: string) => {
    const stmt = realPrepare(sql) as Patchable;
    for (const method of ["all", "get"] as const) {
      const real = stmt[method].bind(stmt);
      stmt[method] = (...args: unknown[]) => {
        seen.push({ sql, args });
        return real(...args);
      };
    }
    return stmt;
  };
  try {
    run();
  } finally {
    conn.prepare = realPrepare;
  }
  return seen;
}

/** How many `?` precede `needle`, which is the index its own binding must sit at. */
function placeholderIndexBefore(sql: string, needle: string): number | null {
  const at = sql.indexOf(needle);
  if (at === -1) return null;
  return (sql.slice(0, at).match(/\?/g) ?? []).length;
}

const NOW = new Date("2026-09-15T15:00:00Z");
const QUARTER = currentFiscalQuarter(NOW);
const DAY = 86_400_000;

// Every query the filter reaches, including the shapes that put another
// binding beside it — which is the only way the order can be wrong.
const SURFACES: Array<[string, () => void]> = [
  ["listAccountSummaries", () => listAccountSummaries(scope)],
  ["listOpenDeals", () => listOpenDeals({ scope })],
  ["listOpenDeals with every other filter", () => listOpenDeals({ scope, stage: 3, owner: "Jer", accountId: "acc", status: "won" })],
  ["upcomingMeetings", () => upcomingMeetings(NOW, 7, scope)],
  ["meetingsAwaitingNotes", () => meetingsAwaitingNotes(NOW, 7, scope)],
  ["listAttention", () => listAttention(NOW, scope)],
  ["recentChanges", () => recentChanges(NOW.getTime() - DAY, 50, null, scope)],
  ["recentChanges for one account", () => recentChanges(NOW.getTime() - DAY, 50, "acc", scope)],
  ["dayCounts", () => dayCounts(NOW, scope)],
  ["listMovement", () => listMovement(NOW.getTime() - DAY, { scope })],
  ["listStalled", () => listStalled(NOW.getTime(), QUARTER, { scope })],
  ["quarterRollUp", () => quarterRollUp(NOW.getTime() - DAY, QUARTER, { scope })],
];

beforeEach(() => {
  resetDbForTests();
  seedAccount();
});

describe("the owner id binds where its placeholder is", () => {
  for (const [name, run] of SURFACES) {
    it(name, () => {
      const scoped = record(run).filter((s) => s.sql.includes("owner_user_id"));
      // Without this the test passes for a query that stopped filtering at
      // all, which is the failure it is least allowed to miss.
      expect(scoped.length, `${name}: no query carried the owner clause`).toBeGreaterThan(0);
      for (const { sql, args } of scoped) {
        const i = placeholderIndexBefore(sql, "owner_user_id = ?");
        // "shared" and "theirs" produce IS NULL / IS NOT NULL and bind nothing.
        if (i === null) continue;
        expect(
          args[i],
          `${name}: the owner id should bind at ?${i + 1}\n--- SQL ---\n${sql}\n--- args ---\n${JSON.stringify(args)}`,
        ).toBe(ME);
      }
    });
  }
});
