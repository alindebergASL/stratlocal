// Ask's conversations: who asked what, what came back, and what it rested on.
import { db } from "../db";
import { newId } from "../ids";
import { ApplyError } from "../proposals/apply";
import { parseFocus, type AskFocus } from "./focus";
import type { ChartData } from "./charts";

/** A batch of proposals one answer filed: on which account, how many. */
export type AskProposals = { batchId: string; accountId: string; count: number };

export type AskCitation = { n: number; kind: string; id: string; accountId: string | null; label: string };

export type AskThread = { id: string; accountId: string | null; title: string; saved: boolean; createdBy: string | null; createdAt: number; updatedAt: number; focus: AskFocus | null };
export type AskMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  citations: AskCitation[];
  steps: string[];
  /** Questions the answer suggests asking next. */
  followUps: string[];
  /** Charts drawn with the answer, as computed when it was written. */
  charts: ChartData[];
  /** What someone said about the answer: useful, or wrong and why. */
  verdict: { value: "useful" | "wrong"; note: string | null; by: string | null; at: number } | null;
  runId: string | null;
  proposals: AskProposals[];
  reportDocId: string | null;
  createdBy: string | null;
  createdAt: number;
};

type ThreadRow = { id: string; account_id: string | null; title: string; saved: number; created_by: string | null; created_at: number; updated_at: number; archived_at: string | null; focus_kind?: string | null; focus_id?: string | null };
type MessageRow = { id: string; thread_id: string; role: "user" | "assistant"; text: string; citations_json: string | null; steps_json: string | null; follow_ups_json?: string | null; charts_json?: string | null; verdict?: "useful" | "wrong" | null; verdict_note?: string | null; verdict_by?: string | null; verdict_at?: number | null; run_id: string | null; proposal_batch_id: string | null; report_doc_id: string | null; created_by: string | null; created_at: number };

// A temporary thread is kept this long, then purged.
export const TEMPORARY_FOR_MS = 24 * 60 * 60 * 1000;

const parse = <T>(json: string | null, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toThread = (r: ThreadRow): AskThread => ({
  id: r.id,
  accountId: r.account_id,
  title: r.title,
  saved: r.saved === 1,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  focus: r.focus_kind && r.focus_id ? parseFocus(`${r.focus_kind}:${r.focus_id}`) : null,
});
const toMessage = (r: MessageRow): AskMessage => ({
  id: r.id,
  threadId: r.thread_id,
  role: r.role,
  text: r.text,
  citations: parse<AskCitation[]>(r.citations_json, []),
  steps: parse<string[]>(r.steps_json, []),
  followUps: parse<string[]>(r.follow_ups_json ?? null, []),
  charts: parse<ChartData[]>(r.charts_json ?? null, []),
  verdict: r.verdict ? { value: r.verdict, note: r.verdict_note ?? null, by: r.verdict_by ?? null, at: r.verdict_at ?? 0 } : null,
  runId: r.run_id,
  // The column holds the list of batches as JSON: one per account changed.
  proposals: parse<AskProposals[]>(r.proposal_batch_id, []),
  reportDocId: r.report_doc_id,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

/** A thread's title: the first question, on one line, short enough for a list. */
export function titleFor(question: string): string {
  const one = question.replace(/\s+/g, " ").trim();
  return one.length > 90 ? `${one.slice(0, 88)}…` : one;
}

export function createThread(input: { accountId: string | null; question: string; saved: boolean; userId: string; focus?: AskFocus | null }): AskThread {
  if (input.accountId) {
    const a = db().prepare(`SELECT kind, archived_at FROM accounts WHERE id = ?`).get(input.accountId) as { kind: string; archived_at: string | null } | undefined;
    if (!a || a.kind !== "customer") throw new ApplyError("That account does not exist.", "not_found");
  }
  const now = Date.now();
  const row: ThreadRow = {
    id: newId(),
    account_id: input.accountId,
    title: titleFor(input.question),
    saved: input.saved ? 1 : 0,
    created_by: input.userId,
    created_at: now,
    updated_at: now,
    archived_at: null,
    focus_kind: input.focus?.kind ?? null,
    focus_id: input.focus?.id ?? null,
  };
  db()
    .prepare(`INSERT INTO ask_threads (id, account_id, title, saved, created_by, created_at, updated_at, focus_kind, focus_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.account_id, row.title, row.saved, row.created_by, row.created_at, row.updated_at, row.focus_kind, row.focus_id);
  return toThread(row);
}

export function getThread(id: string): AskThread | null {
  const r = db().prepare(`SELECT * FROM ask_threads WHERE id = ? AND archived_at IS NULL`).get(id) as ThreadRow | undefined;
  return r ? toThread(r) : null;
}

/**
 * Kept threads, newest first: on one account, or every one (`accountId`
 * undefined), each with the name of the account it was started on.
 */
export function listThreads(opts: { accountId?: string; limit?: number } = {}): Array<AskThread & { accountName: string | null }> {
  const where = opts.accountId ? "AND t.account_id = ?" : "";
  return (
    db()
      .prepare(
        `SELECT t.*, a.name AS account_name FROM ask_threads t LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.saved = 1 AND t.archived_at IS NULL ${where} ORDER BY t.updated_at DESC LIMIT ?`,
      )
      .all(...(opts.accountId ? [opts.accountId] : []), opts.limit ?? 50) as Array<ThreadRow & { account_name: string | null }>
  ).map((r) => ({ ...toThread(r), accountName: r.account_name }));
}

/** The thread's latest run, so a reloaded page picks up a question still being answered. */
export function latestRunId(threadId: string): string | null {
  const r = db()
    .prepare(`SELECT id FROM ai_runs WHERE kind = 'ask' AND json_valid(input_summary) AND json_extract(input_summary, '$.threadId') = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
    .get(threadId) as { id: string } | undefined;
  return r?.id ?? null;
}

/** A temporary thread, kept after all. */
export function keepThread(id: string): void {
  db().prepare(`UPDATE ask_threads SET saved = 1 WHERE id = ?`).run(id);
}

export function listMessages(threadId: string): AskMessage[] {
  return (db().prepare(`SELECT * FROM ask_messages WHERE thread_id = ? ORDER BY created_at, rowid`).all(threadId) as MessageRow[]).map(toMessage);
}

export function addMessage(input: {
  threadId: string;
  role: "user" | "assistant";
  text: string;
  citations?: AskCitation[];
  steps?: string[];
  followUps?: string[];
  charts?: ChartData[];
  runId?: string | null;
  proposals?: AskProposals[];
  reportDocId?: string | null;
  userId: string | null;
}): AskMessage {
  const now = Date.now();
  const row: MessageRow = {
    id: newId(),
    thread_id: input.threadId,
    role: input.role,
    text: input.text,
    citations_json: input.citations?.length ? JSON.stringify(input.citations) : null,
    steps_json: input.steps?.length ? JSON.stringify(input.steps) : null,
    follow_ups_json: input.followUps?.length ? JSON.stringify(input.followUps) : null,
    charts_json: input.charts?.length ? JSON.stringify(input.charts) : null,
    run_id: input.runId ?? null,
    proposal_batch_id: input.proposals?.length ? JSON.stringify(input.proposals) : null,
    report_doc_id: input.reportDocId ?? null,
    created_by: input.userId,
    created_at: now,
  };
  const conn = db();
  conn.transaction(() => {
    conn
      .prepare(
        `INSERT INTO ask_messages (id, thread_id, role, text, citations_json, steps_json, follow_ups_json, charts_json, run_id, proposal_batch_id, report_doc_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.thread_id, row.role, row.text, row.citations_json, row.steps_json, row.follow_ups_json ?? null, row.charts_json ?? null, row.run_id, row.proposal_batch_id, row.report_doc_id, row.created_by, row.created_at);
    conn.prepare(`UPDATE ask_threads SET updated_at = ? WHERE id = ?`).run(now, input.threadId);
  })();
  return toMessage(row);
}

export function archiveThread(id: string): void {
  db().prepare(`UPDATE ask_threads SET archived_at = ? WHERE id = ?`).run(new Date().toISOString().slice(0, 10), id);
}

/** Temporary threads older than a day, gone with their messages. */
export function purgeTemporaryThreads(now = Date.now()): number {
  return db().prepare(`DELETE FROM ask_threads WHERE saved = 0 AND updated_at < ?`).run(now - TEMPORARY_FOR_MS).changes;
}

/** Useful or wrong, on an answer; a second press replaces the first. */
export function setVerdict(messageId: string, verdict: "useful" | "wrong" | null, note: string | null, userId: string): void {
  const r = db().prepare(`SELECT role FROM ask_messages WHERE id = ?`).get(messageId) as { role: string } | undefined;
  if (!r || r.role !== "assistant") throw new ApplyError("That is not an answer.", "not_found");
  db()
    .prepare(`UPDATE ask_messages SET verdict = ?, verdict_note = ?, verdict_by = ?, verdict_at = ? WHERE id = ?`)
    .run(verdict, verdict === "wrong" ? (note?.trim().slice(0, 2000) || null) : null, verdict ? userId : null, verdict ? Date.now() : null, messageId);
  // A miss is kept to be looked at, even on a conversation nobody chose to keep.
  if (verdict === "wrong") db().prepare(`UPDATE ask_threads SET saved = 1 WHERE id = (SELECT thread_id FROM ask_messages WHERE id = ?)`).run(messageId);
}

export type JudgedAnswer = { answer: AskMessage; question: string | null; threadId: string; threadTitle: string };

/** Answers marked wrong (or useful), newest first, with the question each answered. */
export function listJudged(verdict: "useful" | "wrong", limit = 100): JudgedAnswer[] {
  const rows = db()
    .prepare(
      `SELECT m.*, t.title AS thread_title,
              (SELECT q.text FROM ask_messages q WHERE q.thread_id = m.thread_id AND q.role = 'user' AND q.rowid < m.rowid ORDER BY q.rowid DESC LIMIT 1) AS question
       FROM ask_messages m JOIN ask_threads t ON t.id = m.thread_id
       WHERE m.verdict = ? ORDER BY m.verdict_at DESC LIMIT ?`,
    )
    .all(verdict, limit) as Array<MessageRow & { thread_title: string; question: string | null }>;
  return rows.map((r) => ({ answer: toMessage(r), question: r.question, threadId: r.thread_id, threadTitle: r.thread_title }));
}
