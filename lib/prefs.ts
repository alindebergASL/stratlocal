// Small per-person preferences, one value per key. Not for records: nothing
// here is history, and nothing here is shared between people.
import { db } from "./db";

export type PrefKey = "today_last_seen" | "today_since" | "digest_on" | "digest_names" | "digest_sent_day";

export function getPref(userId: string, key: PrefKey): string | null {
  const row = db().prepare(`SELECT value FROM user_prefs WHERE user_id = ? AND key = ?`).get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setPref(userId: string, key: PrefKey, value: string): void {
  db()
    .prepare(`INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(userId, key, value, Date.now());
}

export function flag(userId: string, key: PrefKey): boolean {
  return getPref(userId, key) === "1";
}
