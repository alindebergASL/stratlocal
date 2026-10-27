// An assistant's own record of each time it looked. One row per look, whether
// or not it called a model, so "it checked and found nothing" is on record and
// the scheduler can tell what is already done today.
import { db, type AssistantRunRow } from "../db";
import { newId } from "../ids";
import type { AssistantId } from "./registry";

// Who sees an assistant's notice: the person it is for, or both of you when it
// is for nobody in particular — including an account owner who is not (or no
// longer) one of the users, so nothing is addressed to an empty chair.
export const NOTICE_VISIBLE_SQL = `(n.for_user_id IS NULL OR n.for_user_id = ? OR n.for_user_id NOT IN (SELECT id FROM users))`;

export type RunTrigger = "schedule" | "manual";

export function beginAssistantRun(assistant: AssistantId, trigger: RunTrigger, userId: string | null): string {
  const id = newId();
  db()
    .prepare(`INSERT INTO assistant_runs (id, assistant, trigger, status, created_by, started_at) VALUES (?, ?, ?, 'running', ?, ?)`)
    .run(id, assistant, trigger, userId, Date.now());
  return id;
}

export function endAssistantRun(id: string, outcome: { status: "done" | "failed" | "skipped"; summary: string; result?: unknown; error?: string | null }) {
  const summary = outcome.summary.slice(0, 500);
  if (outcome.status === "skipped" && foldRepeatSkip(id, summary)) return;
  db()
    .prepare(`UPDATE assistant_runs SET status = ?, summary = ?, result_json = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'`)
    .run(outcome.status, summary, outcome.result === undefined ? null : JSON.stringify(outcome.result), outcome.error?.slice(0, 2000) ?? null, Date.now(), id);
}

/** How many scheduled looks one skipped row stands for (see foldRepeatSkip). */
export function runRepeats(r: { result_json: string | null }): number {
  try {
    return Number((JSON.parse(r.result_json ?? "{}") as { repeats?: unknown }).repeats) || 1;
  } catch {
    return 1;
  }
}

// A scheduled look skipped for the same reason as the look just before it —
// the budget is spent, say — is the same news every few minutes. Rather than
// a row per tick pushing the real runs off the page, the earlier row says when
// it was last true and how many times; this one, which recorded nothing, goes.
function foldRepeatSkip(id: string, summary: string): boolean {
  const run = db().prepare(`SELECT assistant, trigger FROM assistant_runs WHERE id = ? AND status = 'running'`).get(id) as { assistant: string; trigger: string } | undefined;
  if (!run || run.trigger !== "schedule") return false;
  const prev = db()
    .prepare(`SELECT id, trigger, status, summary, result_json FROM assistant_runs WHERE assistant = ? AND id <> ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
    .get(run.assistant, id) as { id: string; trigger: string; status: string; summary: string | null; result_json: string | null } | undefined;
  if (!prev || prev.trigger !== "schedule" || prev.status !== "skipped" || prev.summary !== summary) return false;
  const repeats = runRepeats(prev);
  db().transaction(() => {
    db().prepare(`UPDATE assistant_runs SET finished_at = ?, result_json = ? WHERE id = ?`).run(Date.now(), JSON.stringify({ repeats: repeats + 1 }), prev.id);
    db().prepare(`DELETE FROM assistant_runs WHERE id = ? AND status = 'running'`).run(id);
  })();
  return true;
}

export function recentAssistantRuns(assistant: AssistantId | null, limit = 10): AssistantRunRow[] {
  const n = Math.min(Math.max(limit, 1), 50);
  return (assistant
    ? db().prepare(`SELECT * FROM assistant_runs WHERE assistant = ? ORDER BY started_at DESC, rowid DESC LIMIT ?`).all(assistant, n)
    : db().prepare(`SELECT * FROM assistant_runs ORDER BY started_at DESC, rowid DESC LIMIT ?`).all(n)) as AssistantRunRow[];
}

/** Did a scheduled look finish since this instant? A failed one does not count, so it is simply due again. */
export function scheduledRunSince(assistant: AssistantId, sinceMs: number): boolean {
  return !!db()
    .prepare(`SELECT 1 FROM assistant_runs WHERE assistant = ? AND trigger = 'schedule' AND status IN ('done','skipped') AND started_at >= ? LIMIT 1`)
    .get(assistant, sinceMs);
}

// What the assistants did today for you, in one line's worth of numbers, for
// Today. Only what they found counts: a look that found nothing is on the
// Assistants page, not on the first screen.
export function assistantsToday(sinceMs: number, me: string): { briefs: number; reminders: number } {
  const briefs = (db()
    .prepare(`SELECT COUNT(*) AS n FROM ai_runs WHERE assistant = 'meeting_prep' AND kind = 'brief' AND status = 'done' AND started_at >= ?`)
    .get(sinceMs) as { n: number }).n;
  const reminders = (db()
    .prepare(`SELECT COUNT(*) AS n FROM assistant_notices n WHERE n.assistant = 'promise_keeper' AND n.created_at >= ? AND ${NOTICE_VISIBLE_SQL}`)
    .get(sinceMs, me) as { n: number }).n;
  return { briefs, reminders };
}
