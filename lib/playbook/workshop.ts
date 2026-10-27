// An account's workshop plan, one document per account, saved whole with a
// check that nobody else saved in between.
import { db } from "../db";
import { ApplyError } from "../proposals/apply";
import { EMPTY_WORKSHOP, Workshop } from "./workshopShape";

export { addMinutes, EMPTY_WORKSHOP, UseCase, Workshop } from "./workshopShape";

export function getWorkshop(accountId: string): { workshop: Workshop; updatedAt: number | null } {
  const row = db().prepare(`SELECT json, updated_at FROM account_workshops WHERE account_id = ?`).get(accountId) as { json: string; updated_at: number } | undefined;
  if (!row) return { workshop: EMPTY_WORKSHOP, updatedAt: null };
  const parsed = Workshop.safeParse(JSON.parse(row.json));
  return { workshop: parsed.success ? parsed.data : EMPTY_WORKSHOP, updatedAt: row.updated_at };
}

export function saveWorkshop(accountId: string, input: unknown, userId: string, basis: number | null, now = Date.now()): number {
  const parsed = Workshop.safeParse(input);
  if (!parsed.success) throw new ApplyError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "validation");
  const conn = db();
  return conn.transaction(() => {
    const current = getWorkshop(accountId).updatedAt;
    if (current !== basis) throw new ApplyError("Someone else saved this workshop while you had it open. Reload to see their changes.", "conflict");
    const at = Math.max(now, (current ?? 0) + 1);
    conn
      .prepare(`INSERT INTO account_workshops (account_id, json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(accountId, JSON.stringify(parsed.data), at, userId);
    return at;
  })();
}
