// "It's ready": what an assistant that writes something leaves on Today — a
// line linking to the report, the review or the note, until it is opened.
// A notice, never a change to a record (DECISIONS #1); dedupe_key is unique,
// so a run cannot say the same thing twice.
import { db, OWN_WORK_ACCOUNT_ID } from "../db";
import { newId } from "../ids";
import { NOTICE_VISIBLE_SQL } from "./runs";
import type { AssistantId } from "./registry";

export const READY_ASSISTANTS = ["friday_review", "close_the_day", "scheduled_reports"] as const;
type ReadyAssistant = (typeof READY_ASSISTANTS)[number];

export type ReadyItem = { id: string; assistant: ReadyAssistant; title: string; why: string; href: string; action: string };

export function postReady(input: {
  assistant: ReadyAssistant & AssistantId;
  forUserId: string | null;
  title: string;
  why: string;
  href: string;
  action: string;
  /** What opening it means: a report or a thread id; opening that marks it seen. */
  subjectId: string;
  dedupeKey: string;
  runId: string | null;
  accountId?: string | null;
}): void {
  db()
    .prepare(
      `INSERT OR IGNORE INTO assistant_notices (id, assistant, kind, account_id, subject_id, for_user_id, text, dedupe_key, payload_json, run_id, created_at)
       VALUES (?, ?, 'notify', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      input.assistant,
      input.accountId ?? OWN_WORK_ACCOUNT_ID,
      input.subjectId,
      input.forUserId,
      input.title.slice(0, 300),
      input.dedupeKey,
      JSON.stringify({ why: input.why.slice(0, 300), href: input.href, action: input.action }),
      input.runId,
      Date.now(),
    );
}

export function openReady(me: string): ReadyItem[] {
  const rows = db()
    .prepare(
      `SELECT n.id, n.assistant, n.text, n.payload_json FROM assistant_notices n
       WHERE n.assistant IN (${READY_ASSISTANTS.map(() => "?").join(",")}) AND n.resolved_at IS NULL AND ${NOTICE_VISIBLE_SQL}
       ORDER BY n.created_at DESC LIMIT 10`,
    )
    .all(...READY_ASSISTANTS, me) as Array<{ id: string; assistant: ReadyAssistant; text: string; payload_json: string | null }>;
  return rows.flatMap((r) => {
    try {
      const p = JSON.parse(r.payload_json ?? "{}") as { why?: string; href?: string; action?: string };
      return p.href ? [{ id: r.id, assistant: r.assistant, title: r.text, why: p.why ?? "", href: p.href, action: p.action ?? "Open" }] : [];
    } catch {
      return [];
    }
  });
}

/** Opening what a notice points at is reading it: it leaves Today. */
export function markReadySeen(subjectId: string, me: string): void {
  db()
    .prepare(
      `UPDATE assistant_notices SET resolved_at = ?, resolved_by = ?, resolution = 'dismissed'
       WHERE subject_id = ? AND resolved_at IS NULL AND assistant IN (${READY_ASSISTANTS.map(() => "?").join(",")}) AND (for_user_id IS NULL OR for_user_id = ?)`,
    )
    .run(Date.now(), me, subjectId, ...READY_ASSISTANTS, me);
}
