// Meeting prep on its own: the brief for a meeting that has none, written
// before you go looking for it. Today's meetings from six in the morning,
// tomorrow's from four in the afternoon, so a brief is written close to the
// call rather than days ahead of notes that may still change.
//
// It is the same brief, the same guards and the same write as pressing
// Prepare; only who pressed differs. A meeting with a brief, or with a brief
// a person has edited, is never touched, and the write is version-checked, so
// an edit made while it runs wins and the run fails instead.
import { db, OWN_WORK_ACCOUNT_ID, type MeetingRow } from "../db";
import { addDays, nowHHMM, todayISO } from "../clock";
import { briefReadiness } from "../ai/readiness";
import { BudgetError } from "../ai/guard";
import { startBriefRun } from "../meetings/run";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";

export const PREP_MORNING = "06:00";
export const PREP_EVENING = "16:00";
/** At most this many briefs started per look; the next look takes the rest. */
export const PREP_PER_LOOK = 3;

export function prepWindow(now: Date): { days: string[]; time: string } {
  const today = todayISO(now);
  const time = nowHHMM(now);
  if (time < PREP_MORNING) return { days: [], time };
  return { days: time >= PREP_EVENING ? [today, addDays(today, 1)] : [today], time };
}

// Started by Meeting prep today already, finished or not: a failure is not
// retried every five minutes, and tomorrow is another look.
function triedToday(meetingId: string, sinceMs: number): boolean {
  return !!db()
    .prepare(`SELECT 1 FROM ai_runs WHERE assistant = 'meeting_prep' AND input_summary = ? AND started_at >= ? LIMIT 1`)
    .get(`meeting ${meetingId}`, sinceMs);
}

// Pressed by hand ("Run now"), the clock does not apply: today's and
// tomorrow's meetings, and one that failed earlier today is tried again.
export function meetingsToPrepare(now: Date, sinceMs: number, manual = false): MeetingRow[] {
  const window = prepWindow(now);
  const days = manual ? [todayISO(now), addDays(todayISO(now), 1)] : window.days;
  const time = window.time;
  if (days.length === 0) return [];
  const today = todayISO(now);
  const rows = db()
    .prepare(
      `SELECT m.* FROM meetings m JOIN accounts a ON a.id = m.account_id
       WHERE m.archived_at IS NULL AND m.merged_into IS NULL AND a.archived_at IS NULL AND a.id != ?
         AND m.brief_json IS NULL AND m.brief_edits_json IS NULL
         AND m.held_at IN (${days.map(() => "?").join(",")})
       ORDER BY m.held_at, m.held_time IS NULL, m.held_time, m.id
       LIMIT 50`,
    )
    .all(OWN_WORK_ACCOUNT_ID, ...days) as MeetingRow[];
  return rows.filter(
    (m) =>
      // A meeting already under way today has nothing left to prepare for.
      !(m.held_at === today && m.held_time && m.held_time <= time) &&
      !briefReadiness(m) &&
      (manual || !triedToday(m.id, sinceMs)),
  );
}

export type MeetingPrepResult = { candidates: number; started: string[]; skipped: Array<{ meetingId: string; reason: string }> };

// Returns null without recording anything when there is nothing to prepare:
// a look that finds nothing every five minutes is not worth a row.
export function runMeetingPrep(trigger: RunTrigger, userId: string | null, now = new Date(), sinceMs: number): ({ runId: string } & MeetingPrepResult) | null {
  const due = meetingsToPrepare(now, sinceMs, trigger === "manual");
  if (due.length === 0 && trigger === "schedule") return null;
  const runId = beginAssistantRun("meeting_prep", trigger, userId);
  const started: string[] = [];
  const skipped: MeetingPrepResult["skipped"] = [];
  for (const m of due.slice(0, PREP_PER_LOOK)) {
    try {
      startBriefRun(m, null, { baseVersion: m.updated_at, replaceHumanEdits: false }, { assistant: "meeting_prep" });
      started.push(m.id);
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      skipped.push({ meetingId: m.id, reason: e.message });
      // Out of money stops the look: the next meeting would be refused too.
      if (e instanceof BudgetError && /left this month|is spent|switched off/.test(e.message)) break;
    }
  }
  const result = { candidates: due.length, started, skipped };
  const summary =
    due.length === 0
      ? "No meeting in the next day needs a brief."
      : started.length > 0
        ? `Started ${started.length} brief${started.length === 1 ? "" : "s"}${skipped.length ? `; ${skipped.length} skipped` : ""}.`
        : `Skipped: ${skipped[0]?.reason ?? "nothing could start"}`;
  endAssistantRun(runId, { status: started.length > 0 || due.length === 0 ? "done" : "skipped", summary, result });
  return { runId, ...result };
}
