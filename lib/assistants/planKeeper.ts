// Plan keeper: questions about the plan, never a rewrite of it.
//
// Daily, by code (DECISIONS #27), one question per play at most:
//   - its next step's date has passed;
//   - it is active and has no next step;
//   - nothing about it has moved in QUIET_DAYS (the play, its follow-ups,
//     its deals).
// Monthly, per account with a thesis and recent meeting notes, a model reads
// the thesis against those notes (lib/plan/check.ts) and may raise up to
// three questions, each resting on a quoted clause and a quoted sentence.
// Answers are a person's edits through the one apply path.
import { createHash } from "node:crypto";
import { db, OWN_WORK_ACCOUNT_ID, type AssistantNoticeRow } from "../db";
import { newId } from "../ids";
import { addDays, dayOf, daysBetween, todayISO } from "../clock";
import { fmtDay } from "../format";
import { BudgetError, runDetached, startOfMonth, startRun } from "../ai/guard";
import { runThesisCheck } from "../plan/check";
import { assistantMode } from "./settings";
import { beginAssistantRun, endAssistantRun, NOTICE_VISIBLE_SQL, type RunTrigger } from "./runs";

export const QUIET_DAYS = 30;
/** Meetings this recent feed the thesis check. */
export const CHECK_NOTES_DAYS = 45;
const MAX_MEETINGS = 5;
const MAX_NOTES_CHARS = 4000;

export type PlayRow = {
  id: string;
  account_id: string;
  account_name: string;
  account_owner: string | null;
  title: string;
  status: string;
  next_step: string | null;
  next_step_due: string | null;
  updated_at: number;
  last_activity: number;
};

export function livePlays(accountId?: string): PlayRow[] {
  return db()
    .prepare(
      `SELECT p.id, p.account_id, a.name AS account_name, a.owner_user_id AS account_owner, p.title, p.status, p.next_step, p.next_step_due, p.updated_at,
              MAX(p.updated_at,
                  COALESCE((SELECT MAX(ai.updated_at) FROM action_items ai WHERE ai.play_id = p.id), 0),
                  COALESCE((SELECT MAX(d.updated_at) FROM deals d, json_each(p.deal_ids_json) j WHERE d.deal_id = j.value), 0)) AS last_activity
       FROM plays p JOIN accounts a ON a.id = p.account_id
       WHERE p.archived_at IS NULL AND p.merged_into IS NULL AND a.archived_at IS NULL AND a.id != ?
         AND p.status IN ('proposed','active') ${accountId ? "AND p.account_id = ?" : ""}
       ORDER BY a.name COLLATE NOCASE, p.sort_order, p.created_at`,
    )
    .all(...(accountId ? [OWN_WORK_ACCOUNT_ID, accountId] : [OWN_WORK_ACCOUNT_ID])) as PlayRow[];
}

export type PlayQuestion = { rule: "overdue" | "nonext" | "quiet"; playId: string; accountId: string; forUserId: string | null; text: string; dedupeKey: string };

// One question per play, the most pressing first.
export function playQuestion(p: PlayRow, today: string): PlayQuestion | null {
  const base = { playId: p.id, accountId: p.account_id, forUserId: p.account_owner };
  if (p.next_step && p.next_step_due && p.next_step_due < today) {
    return { ...base, rule: "overdue", text: `The next step was due ${fmtDay(p.next_step_due)}: "${p.next_step}". Done, a new date, or has the play moved on?`, dedupeKey: `plan:overdue:${p.id}:${p.next_step_due}` };
  }
  if (p.status === "active" && !p.next_step?.trim()) {
    return { ...base, rule: "nonext", text: "It is active with no next step. What is the one thing that moves it?", dedupeKey: `plan:nonext:${p.id}` };
  }
  const quietSince = dayOf(p.last_activity);
  const days = daysBetween(quietSince, today);
  if (days >= QUIET_DAYS) {
    return { ...base, rule: "quiet", text: `Nothing about it has moved in ${days} days. Still on, stalled, or done with?`, dedupeKey: `plan:quiet:${p.id}:${quietSince}` };
  }
  return null;
}

const insertNotice = () =>
  db().prepare(
    `INSERT OR IGNORE INTO assistant_notices (id, assistant, kind, account_id, action_item_id, subject_id, for_user_id, text, dedupe_key, payload_json, run_id, created_at)
     VALUES (?, 'plan_keeper', 'question', ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  );

/** The daily look: code only, costs nothing. */
export function runPlanLook(trigger: RunTrigger, userId: string | null, today = todayISO()): { runId: string; checked: number; added: number } {
  const runId = beginAssistantRun("plan_keeper", trigger, userId);
  const plays = livePlays();
  const questions = plays.map((p) => playQuestion(p, today)).filter((q): q is PlayQuestion => !!q);
  const ins = insertNotice();
  let added = 0;
  const now = Date.now();
  db().transaction(() => {
    for (const q of questions) added += ins.run(newId(), q.accountId, q.playId, q.forUserId, q.text, q.dedupeKey, null, runId, now).changes;
  })();
  endAssistantRun(runId, { status: "done", summary: `Looked at ${plays.length} live play${plays.length === 1 ? "" : "s"}; ${added ? `${added} new question${added === 1 ? "" : "s"}` : "nothing new"}.`, result: { checked: plays.length, added } });
  return { runId, checked: plays.length, added };
}

// ---- the monthly thesis check ----------------------------------------------

export const thesisHash = (thesis: string) => createHash("sha256").update(thesis.trim()).digest("hex").slice(0, 16);

type ThesisCandidate = { id: string; name: string; thesis: string; owner: string | null };

export function recentNotes(accountId: string, today = todayISO()) {
  return (
    db()
      .prepare(
        `SELECT id, title, held_at, raw_notes FROM meetings WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL
           AND raw_notes IS NOT NULL AND length(trim(raw_notes)) >= 40 AND held_at >= ? AND held_at <= ?
         ORDER BY held_at DESC LIMIT ?`,
      )
      .all(accountId, addDays(today, -CHECK_NOTES_DAYS), today, MAX_MEETINGS) as Array<{ id: string; title: string; held_at: string; raw_notes: string }>
  ).map((m) => ({ id: m.id, title: m.title, heldAt: m.held_at, notes: m.raw_notes.slice(0, MAX_NOTES_CHARS) }));
}

/** Accounts whose thesis has not been read against recent notes this month. */
export function thesisDue(today = todayISO(), monthStart = startOfMonth()): ThesisCandidate[] {
  const rows = db()
    .prepare(
      `SELECT a.id, a.name, a.thesis, a.owner_user_id AS owner FROM accounts a
       WHERE a.archived_at IS NULL AND a.id != ? AND a.thesis IS NOT NULL AND length(trim(a.thesis)) >= 20
         AND NOT EXISTS (SELECT 1 FROM ai_runs r WHERE r.account_id = a.id AND r.kind = 'plan_check' AND r.started_at >= ?)
         AND NOT EXISTS (SELECT 1 FROM ai_runs r WHERE r.account_id = a.id AND r.status = 'running')
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all(OWN_WORK_ACCOUNT_ID, monthStart) as ThesisCandidate[];
  return rows.filter((a) => recentNotes(a.id, today).length > 0);
}

export type ThesisCheckResult = { tensions: number; holds: string };

export function startThesisCheck(account: ThesisCandidate, userId: string | null, today = todayISO()): string {
  const meetings = recentNotes(account.id, today);
  if (meetings.length === 0) throw new BudgetError("No meeting notes in the last six weeks to read the thesis against.");
  const run = startRun({ role: "plan_check", accountId: account.id, userId, inputSummary: `thesis ${account.id}`, assistant: "plan_keeper" });
  const month = today.slice(0, 7);
  const hash = thesisHash(account.thesis);
  runDetached(run.id, async (stages): Promise<ThesisCheckResult> => {
    const { check } = await runThesisCheck({ accountName: account.name, thesis: account.thesis, meetings }, stages);
    const titles = new Map(meetings.map((m) => [m.id, m.title]));
    const ins = insertNotice();
    const now = Date.now();
    db().transaction(() => {
      check.tensions.forEach((t, i) => {
        const payload = { ...t, meeting_title: titles.get(t.meeting_id) ?? "", thesis_hash: hash };
        ins.run(newId(), account.id, null, account.owner, t.question, `plan:thesis:${account.id}:${month}:${i}`, JSON.stringify(payload), null, now);
      });
    })();
    return { tensions: check.tensions.length, holds: check.holds };
  });
  return run.id;
}

/** Start the thesis check for the next account due. Null when none is. */
export function runThesisLook(trigger: RunTrigger, userId: string | null, today = todayISO()): { runId: string; accountName: string; started: boolean; reason: string } | null {
  const next = thesisDue(today)[0];
  if (!next) return null;
  const runId = beginAssistantRun("plan_keeper", trigger, userId);
  try {
    startThesisCheck(next, userId, today);
    const reason = `Reading ${next.name}'s thesis against its recent meeting notes.`;
    endAssistantRun(runId, { status: "done", summary: reason, result: { accountId: next.id } });
    return { runId, accountName: next.name, started: true, reason };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    endAssistantRun(runId, { status: "skipped", summary: `${next.name}: ${reason}` });
    if (!(e instanceof BudgetError)) throw e;
    return { runId, accountName: next.name, started: false, reason };
  }
}

// ---- reading the questions -------------------------------------------------

export type ThesisPayload = { thesis_claim: string; meeting_id: string; meeting_title: string; quote: string; question: string; thesis_hash: string };

export type PlanQuestion = AssistantNoticeRow & {
  account_name: string;
  account_thesis: string | null;
  account_version: number;
  play_title: string | null;
  play_status: string | null;
  play_next_step: string | null;
  play_next_step_due: string | null;
  play_version: number | null;
  play_activity: number | null;
  payload: ThesisPayload | null;
};

// Still true when shown, like Promise keeper's: an answered play or an edited
// thesis retires its question without anyone tidying up.
export function planQuestionStillTrue(q: PlanQuestion, today: string): boolean {
  const [, rule, , a, b] = q.dedupe_key.split(":");
  if (rule === "thesis") return !!q.account_thesis && !!q.payload && thesisHash(q.account_thesis) === q.payload.thesis_hash;
  if (!q.play_title || !q.play_status || !["proposed", "active"].includes(q.play_status)) return false;
  if (rule === "overdue") return q.play_next_step_due === a && !!q.play_next_step && a! < today;
  if (rule === "nonext") return q.play_status === "active" && !q.play_next_step?.trim();
  if (rule === "quiet") return q.play_activity != null && dayOf(q.play_activity) === a && b === undefined;
  return false;
}

export function openPlanQuestions(me: string, opts: { everyone?: boolean; accountId?: string; today?: string } = {}): PlanQuestion[] {
  if (assistantMode("plan_keeper") === "off") return [];
  const today = opts.today ?? todayISO();
  const rows = db()
    .prepare(
      `SELECT n.*, a.name AS account_name, a.thesis AS account_thesis, a.updated_at AS account_version,
              p.title AS play_title, p.status AS play_status, p.next_step AS play_next_step, p.next_step_due AS play_next_step_due, p.updated_at AS play_version,
              CASE WHEN p.id IS NULL THEN NULL ELSE MAX(p.updated_at,
                  COALESCE((SELECT MAX(ai.updated_at) FROM action_items ai WHERE ai.play_id = p.id), 0),
                  COALESCE((SELECT MAX(d.updated_at) FROM deals d, json_each(p.deal_ids_json) j WHERE d.deal_id = j.value), 0)) END AS play_activity
       FROM assistant_notices n
       JOIN accounts a ON a.id = n.account_id AND a.archived_at IS NULL
       LEFT JOIN plays p ON p.id = n.subject_id AND p.archived_at IS NULL AND p.merged_into IS NULL
       WHERE n.assistant = 'plan_keeper' AND n.resolved_at IS NULL AND (? OR ${NOTICE_VISIBLE_SQL}) ${opts.accountId ? "AND n.account_id = ?" : ""}
       ORDER BY a.name COLLATE NOCASE, n.created_at
       LIMIT 200`,
    )
    .all(opts.everyone ? 1 : 0, me, ...(opts.accountId ? [opts.accountId] : [])) as Array<Omit<PlanQuestion, "payload">>;
  return rows
    .map((r) => {
      let payload: ThesisPayload | null = null;
      try {
        payload = r.payload_json ? (JSON.parse(r.payload_json) as ThesisPayload) : null;
      } catch {
        payload = null;
      }
      return { ...r, payload };
    })
    .filter((q) => planQuestionStillTrue(q, today));
}

/** When each of an account's plays last moved, whatever its status. */
export function playActivity(accountId: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT p.id, MAX(p.updated_at,
                COALESCE((SELECT MAX(ai.updated_at) FROM action_items ai WHERE ai.play_id = p.id), 0),
                COALESCE((SELECT MAX(d.updated_at) FROM deals d, json_each(p.deal_ids_json) j WHERE d.deal_id = j.value), 0)) AS last_activity
       FROM plays p WHERE p.account_id = ? AND p.archived_at IS NULL AND p.merged_into IS NULL`,
    )
    .all(accountId) as Array<{ id: string; last_activity: number }>;
  return new Map(rows.map((r) => [r.id, r.last_activity]));
}
