// When you last looked at an account (DECISIONS #100), for "Since you last
// looked" on its Overview. Kept apart from research_seen, which the research
// page rolls on its own visits, so neither empties the other's list.
//
// Reading never writes: the page reads `accountSince`, and a ping after it
// renders calls `markAccountSeen`. A visit only moves "since" on after a
// half-hour pause, so a reload, or acting on what it shows, keeps the list.
import { db } from "../db";

export const ACCOUNT_PAUSE_MS = 30 * 60_000;

type Row = { seen_at: number; before_at: number | null };

function row(userId: string, accountId: string): Row | undefined {
  return db().prepare(`SELECT seen_at, before_at FROM account_seen WHERE user_id = ? AND account_id = ?`).get(userId, accountId) as Row | undefined;
}

/** Where "since you last looked" starts now, or null on a first visit. */
export function accountSince(userId: string, accountId: string, now = Date.now()): number | null {
  const r = row(userId, accountId);
  if (!r) return null;
  return now - r.seen_at > ACCOUNT_PAUSE_MS ? r.seen_at : r.before_at;
}

export function markAccountSeen(userId: string, accountId: string, now = Date.now()): void {
  const r = row(userId, accountId);
  const conn = db();
  if (!r) conn.prepare(`INSERT INTO account_seen (user_id, account_id, seen_at, before_at) VALUES (?, ?, ?, NULL)`).run(userId, accountId, now);
  else if (now - r.seen_at > ACCOUNT_PAUSE_MS) conn.prepare(`UPDATE account_seen SET before_at = seen_at, seen_at = ? WHERE user_id = ? AND account_id = ?`).run(now, userId, accountId);
  else conn.prepare(`UPDATE account_seen SET seen_at = ? WHERE user_id = ? AND account_id = ?`).run(now, userId, accountId);
}
