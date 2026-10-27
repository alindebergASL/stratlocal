// Report templates on a schedule: "Weekly pipeline review, Mondays at 07:00,
// for Alex". The Scheduled reports assistant runs each one when it is due
// and leaves the report on that person's Today (DECISIONS #55). A report
// whose records have not changed since its last run is skipped: the same
// report twice says nothing new.
import { z } from "zod";
import { db } from "../db";
import { newId } from "../ids";
import { ApplyError } from "../proposals/apply";
import { dayOf, nowHHMM, todayISO } from "../clock";
import { getTemplate, type AskTemplate } from "./templates";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const Schedule = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  forUserId: z.string().min(1),
});

export type AskSchedule = z.infer<typeof Schedule> & { templateId: string; lastRunAt: number | null };
type Row = { template_id: string; days_json: string; at: string; for_user_id: string; last_run_at: number | null };

const fromRow = (r: Row): AskSchedule | null => {
  try {
    return { templateId: r.template_id, ...Schedule.parse({ days: JSON.parse(r.days_json), at: r.at, forUserId: r.for_user_id }), lastRunAt: r.last_run_at };
  } catch {
    return null;
  }
};

export function listSchedules(): AskSchedule[] {
  return (db().prepare(`SELECT * FROM ask_schedules`).all() as Row[]).map(fromRow).filter((s): s is AskSchedule => s !== null);
}

export function scheduleFor(templateId: string): AskSchedule | null {
  const r = db().prepare(`SELECT * FROM ask_schedules WHERE template_id = ?`).get(templateId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function setSchedule(templateId: string, input: { days: number[]; at: string; forUserId: string }, userId: string): void {
  const t = getTemplate(templateId);
  if (!t) throw new ApplyError("That template no longer exists.", "not_found");
  if (t.scope !== "all") throw new ApplyError("A template about one account is started from that account, not on a schedule.", "validation");
  const s = Schedule.parse({ ...input, days: [...new Set(input.days)].sort() });
  db()
    .prepare(
      `INSERT INTO ask_schedules (template_id, days_json, at, for_user_id, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(template_id) DO UPDATE SET days_json = excluded.days_json, at = excluded.at, for_user_id = excluded.for_user_id, updated_at = excluded.updated_at`,
    )
    .run(templateId, JSON.stringify(s.days), s.at, s.forUserId, userId, Date.now());
}

export function clearSchedule(templateId: string): void {
  db().prepare(`DELETE FROM ask_schedules WHERE template_id = ?`).run(templateId);
}

export function describeSchedule(s: AskSchedule): string {
  const days =
    s.days.length === 7 ? "Every day" : s.days.join(",") === "1,2,3,4,5" ? "Weekdays" : s.days.map((d) => `${DAY_NAMES[d]}s`).join(", ");
  return `${days} at ${s.at}`;
}

/** Due now: today is one of its days, its time has come, and it has not run since. */
export function isDue(s: AskSchedule, now = new Date()): boolean {
  const today = todayISO(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (!s.days.includes(weekday) || nowHHMM(now) < s.at) return false;
  return s.lastRunAt === null || dayOf(s.lastRunAt) !== today;
}

/** Has anything on file changed since the last run? The first run always has news. */
export function changedSince(ms: number | null): boolean {
  if (ms === null) return true;
  return !!db().prepare(`SELECT 1 FROM change_log WHERE created_at > ? LIMIT 1`).get(ms);
}

export function markRan(templateId: string, at = Date.now()): void {
  db().prepare(`UPDATE ask_schedules SET last_run_at = ? WHERE template_id = ?`).run(at, templateId);
}

export type ScheduledTemplate = { template: AskTemplate; schedule: AskSchedule };

// Three attempts per local day, fifteen minutes apart, including manual
// launches. The unique running index and immediate claim also cover overlap.
const RETRY_AFTER_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
export function canAttemptSchedule(templateId: string, now: Date): boolean {
  const attempts = db().prepare(`SELECT started_at, status FROM ask_schedule_attempts WHERE template_id = ? ORDER BY started_at DESC`).all(templateId) as Array<{ started_at: number; status: string }>;
  if (attempts.some((a) => a.status === "running")) return false;
  if (attempts[0] && now.getTime() - attempts[0].started_at < RETRY_AFTER_MS) return false;
  return attempts.filter((a) => dayOf(a.started_at) === todayISO(now)).length < MAX_ATTEMPTS;
}

export function claimScheduleAttempt(templateId: string, assistantRunId: string, now: Date): string | null {
  return db().transaction(() => {
    if (!canAttemptSchedule(templateId, now)) return null;
    const id = newId();
    db().prepare(`INSERT INTO ask_schedule_attempts (id, template_id, assistant_run_id, started_at, status) VALUES (?, ?, ?, ?, 'running')`).run(id, templateId, assistantRunId, now.getTime());
    return id;
  }).immediate();
}
