// Putting an Inbox item off until a day (DECISIONS #98). Per person: one of
// you putting an account's changes off does not hide them from the other.
// Keys name the item as the Inbox lists it: `changes:<accountId>` or
// `research:<noteId>`. Nothing is decided by snoozing; on the day it comes back.
import { db } from "../db";
import { todayISO } from "../clock";

export function snoozedKeys(me: string, today = todayISO()): Map<string, string> {
  const rows = db().prepare(`SELECT item_key, until_day FROM inbox_snoozes WHERE user_id = ? AND until_day > ?`).all(me, today) as Array<{ item_key: string; until_day: string }>;
  return new Map(rows.map((r) => [r.item_key, r.until_day]));
}

export function snoozeItem(me: string, key: string, untilDay: string): void {
  if (!/^(changes|research):[\w-]+$/.test(key)) throw new Error("not an Inbox item");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilDay)) throw new Error("not a day");
  db()
    .prepare(`INSERT INTO inbox_snoozes (user_id, item_key, until_day, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, item_key) DO UPDATE SET until_day = excluded.until_day, created_at = excluded.created_at`)
    .run(me, key, untilDay, Date.now());
}

export function wakeItem(me: string, key: string): void {
  db().prepare(`DELETE FROM inbox_snoozes WHERE user_id = ? AND item_key = ?`).run(me, key);
}

/** Tomorrow and next Monday, the two days anything is put off until. */
export function snoozeDays(today = todayISO()): { tomorrow: string; nextWeek: string } {
  const d = new Date(`${today}T12:00:00Z`);
  const add = (n: number) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
  const dow = d.getUTCDay();
  return { tomorrow: add(1), nextWeek: add(((8 - dow) % 7) || 7) };
}
