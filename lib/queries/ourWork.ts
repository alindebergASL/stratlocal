// What the team did, person by person: meetings held, follow-ups closed,
// plays and deals moved, research kept. Read from history (change_log) and
// the meetings table, with no model, so it counts what happened rather than
// what anyone remembers (DECISIONS #92).
import { db } from "../db";
import { listTeam } from "../auth";

export type WorkCounts = { meetings: number; followUpsClosed: number; playsMoved: number; dealsMoved: number; researchKept: number };
export type PersonWeek = { userId: string; name: string; counts: WorkCounts; total: number };

export const WEEK_DAYS = 7;
const EMPTY: WorkCounts = { meetings: 0, followUpsClosed: 0, playsMoved: 0, dealsMoved: 0, researchKept: 0 };

export function workCounts(userId: string, since: number, accountId: string | null = null, until = Date.now()): WorkCounts {
  const conn = db();
  const acct = accountId ? " AND account_id = ?" : "";
  const args = (...a: unknown[]) => (accountId ? [...a, accountId] : a);
  const distinct = (sql: string, ...a: unknown[]) => (conn.prepare(`SELECT COUNT(DISTINCT entity_id) AS n FROM change_log WHERE actor_user_id = ? AND created_at >= ? AND ${sql}${acct}`).get(...args(userId, since, ...a)) as { n: number }).n;
  const sinceDay = new Date(since).toISOString().slice(0, 10);
  const today = new Date(until).toISOString().slice(0, 10);
  return {
    // Meetings someone put on file and that were held in the window.
    meetings: (conn.prepare(`SELECT COUNT(*) AS n FROM meetings WHERE created_by = ? AND archived_at IS NULL AND merged_into IS NULL AND held_at >= ? AND held_at <= ?${acct}`).get(...args(userId, sinceDay, today)) as { n: number }).n,
    followUpsClosed: distinct(`entity_type = 'action_item' AND field = 'status' AND new_value = '"done"'`),
    // Moved means a value changed: a create logs every field with no old value.
    playsMoved: distinct(`entity_type = 'play' AND field IN ('status', 'next_step', 'next_step_due') AND old_value IS NOT NULL`),
    dealsMoved: distinct(`entity_type = 'deal' AND field IN ('stage', 'status', 'next_step', 'close_date') AND old_value IS NOT NULL`),
    researchKept: distinct(`entity_type = 'document' AND field = 'accepted_findings'`),
  };
}

const sum = (c: WorkCounts) => c.meetings + c.followUpsClosed + c.playsMoved + c.dealsMoved + c.researchKept;

/** The week for everyone active, me first, then the rest by how much they did. */
export function weekSummary(me: string | null, now = new Date(), accountId: string | null = null, days = WEEK_DAYS): PersonWeek[] {
  const since = now.getTime() - days * 86_400_000;
  const people = listTeam()
    .filter((m) => m.active)
    .map((m) => {
      const counts = workCounts(m.id, since, accountId, now.getTime());
      return { userId: m.id, name: m.display_name, counts, total: sum(counts) };
    });
  return people.sort((a, b) => (a.userId === me ? -1 : b.userId === me ? 1 : b.total - a.total || a.name.localeCompare(b.name)));
}

export { EMPTY as NO_WORK };
