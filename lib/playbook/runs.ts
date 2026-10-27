import { db, type AiRunRow } from "../db";

/** The newest run of one kind on an account, for a button to pick up after a reload. */
export function latestRunOfKind(accountId: string, kind: string): AiRunRow | null {
  return (db().prepare(`SELECT * FROM ai_runs WHERE account_id = ? AND kind = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`).get(accountId, kind) as AiRunRow | undefined) ?? null;
}
