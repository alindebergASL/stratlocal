// The scheduler's one entry point. A loop in deploy/compose.yml calls the
// internal route every few minutes; the route calls this, and this decides
// what is due. There is no queue: each assistant's own records say what it
// has already done today, and a look that died with a restart is simply due
// again on the next tick (DECISIONS #38).
import { purgeTemporaryThreads } from "../ask/threads";
import { db } from "../db";
import { startOfToday } from "../ai/guard";
import { nowHHMM } from "../clock";
import { assistantMode } from "./settings";
import { scheduledRunSince } from "./runs";
import { runPromiseKeeper } from "./promiseKeeper";
import { PREP_MORNING, runMeetingPrep } from "./meetingPrep";
import { calendarTick, listSources } from "../calendar/sync";
import { runAccountWatch } from "./accountWatch";
import { runPlanLook, runThesisLook } from "./planKeeper";
import { runHandoffWriter } from "../handoff/writer";
import { FRIDAY_REVIEW_AT, isFriday, runFridayReview } from "./fridayReview";
import { CLOSE_THE_DAY_AT, isWeekday, runCloseTheDay } from "./closeTheDay";
import { runScheduledReports } from "./scheduledReports";
import { QUARTERLY_REFRESH_AT, runQuarterlyRefresh } from "./quarterlyRefresh";
import { MORNING_DIGEST_AT, runMorningDigest } from "./morningDigest";
import { readMailboxes, runMailReader } from "./mailReader";
import { purgeMailBodies } from "../mail/sync";
import { runWriter, WRITER_MORNING } from "./writer";

/** Handoff writer drafts cover notes from here. */
export const HANDOFF_FROM = "07:30";

/** Plan keeper's daily look at the plays, and when the monthly thesis checks may start. */
export const PLAN_LOOK_AT = "06:30";
export const THESIS_CHECK_FROM = "08:00";

/** Account watch starts its weekly looks from here, one account per tick. */
export const ACCOUNT_WATCH_FROM = "07:00";

export const PROMISE_KEEPER_AT = "06:00";

export const MIN_SECRET_LENGTH = 32;

/** The shared secret the loop knocks with, or null when the scheduler is not set up. */
export function schedulerSecret(): string | null {
  const s = (process.env.SCHEDULER_SECRET ?? "").trim();
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

export type TickReport = {
  at: number;
  ran: Array<{ assistant: string; runId: string; summary: string }>;
  errors: Array<{ assistant: string; error: string }>;
  /** Calendars are read in the background: a slow provider must not hold the knock open. */
  calendars: "reading" | "none";
  /** Set when another tick held the lease, so this one did nothing. */
  skipped?: "busy";
};

/** How long one tick may hold the lease before another may take it anyway. */
export const LEASE_MS = 4 * 60_000;

/**
 * One tick at a time, across every process sharing the database (DECISIONS
 * #99): a row in settings holds when the current lease runs out, and only a
 * tick that finds it run out may take it. A tick that died holding it is
 * overtaken when it expires.
 */
export function takeLease(at: number): boolean {
  return (
    db()
      .prepare(
        `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('scheduler_lease', ?, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE CAST(settings.value AS INTEGER) <= ?`,
      )
      .run(String(at + LEASE_MS), at, at).changes === 1
  );
}

export function releaseLease(): void {
  db().prepare(`UPDATE settings SET value = '0' WHERE key = 'scheduler_lease'`).run();
}

export function lastTick(): number | null {
  const row = db().prepare(`SELECT value FROM settings WHERE key = 'scheduler_last_tick'`).get() as { value: string } | undefined;
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function markTick(at: number) {
  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('scheduler_last_tick', ?, NULL, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(String(at), at);
}

export function tick(now = new Date()): TickReport {
  const at = now.getTime();
  if (!takeLease(at)) return { at, ran: [], errors: [], calendars: "none", skipped: "busy" };
  try {
    return tickHeld(now);
  } finally {
    releaseLease();
  }
}

function tickHeld(now: Date): TickReport {
  // Ask conversations nobody chose to keep are gone after a day, and email
  // bodies after 30, whether or not the Mail reader is still on.
  purgeTemporaryThreads(now.getTime());
  purgeMailBodies(now.getTime());
  const at = now.getTime();
  markTick(at);
  const report: TickReport = { at, ran: [], errors: [], calendars: "none" };
  const midnight = startOfToday();
  const time = nowHHMM(now);

  const attempt = (assistant: string, run: () => { runId: string; summary: string } | null) => {
    try {
      const r = run();
      if (r) report.ran.push({ assistant, ...r });
    } catch (e) {
      report.errors.push({ assistant, error: e instanceof Error ? e.message : String(e) });
    }
  };

  if (assistantMode("promise_keeper") === "auto" && time >= PROMISE_KEEPER_AT && !scheduledRunSince("promise_keeper", midnight)) {
    attempt("promise_keeper", () => {
      const r = runPromiseKeeper("schedule", null);
      return { runId: r.runId, summary: `${r.added} new` };
    });
  }

  if (assistantMode("meeting_prep") === "auto" && time >= PREP_MORNING) {
    attempt("meeting_prep", () => {
      const r = runMeetingPrep("schedule", null, now, midnight);
      return r ? { runId: r.runId, summary: `${r.started.length} started` } : null;
    });
  }

  if (assistantMode("account_watch") === "auto" && time >= ACCOUNT_WATCH_FROM) {
    attempt("account_watch", () => {
      const r = runAccountWatch("schedule", null, at);
      return r ? { runId: r.runId, summary: r.reason } : null;
    });
  }

  if (assistantMode("plan_keeper") === "auto") {
    if (time >= PLAN_LOOK_AT && !scheduledRunSince("plan_keeper", midnight)) {
      attempt("plan_keeper", () => {
        const r = runPlanLook("schedule", null);
        return { runId: r.runId, summary: `${r.added} new` };
      });
    }
    if (time >= THESIS_CHECK_FROM) {
      attempt("plan_keeper", () => {
        const r = runThesisLook("schedule", null);
        return r ? { runId: r.runId, summary: r.reason } : null;
      });
    }
  }

  if (assistantMode("handoff_writer") === "auto" && time >= HANDOFF_FROM) {
    attempt("handoff_writer", () => {
      const r = runHandoffWriter("schedule", null);
      return r ? { runId: r.runId, summary: r.reason } : null;
    });
  }

  if (assistantMode("friday_review") === "auto" && isFriday(now) && time >= FRIDAY_REVIEW_AT && !scheduledRunSince("friday_review", midnight)) {
    attempt("friday_review", () => {
      const r = runFridayReview("schedule", null, now);
      return { runId: r.runId, summary: r.reason };
    });
  }

  if (assistantMode("close_the_day") === "auto" && isWeekday(now) && time >= CLOSE_THE_DAY_AT && !scheduledRunSince("close_the_day", midnight)) {
    attempt("close_the_day", () => {
      const r = runCloseTheDay("schedule", null, now);
      return { runId: r.runId, summary: r.reason };
    });
  }

  if (assistantMode("scheduled_reports") === "auto") {
    attempt("scheduled_reports", () => {
      const r = runScheduledReports("schedule", null, now);
      return r && r.runId ? { runId: r.runId, summary: r.reason } : null;
    });
  }

  if (assistantMode("quarterly_refresh") === "auto" && time >= QUARTERLY_REFRESH_AT && !scheduledRunSince("quarterly_refresh", midnight)) {
    attempt("quarterly_refresh", () => {
      const r = runQuarterlyRefresh("schedule", null, now);
      return { runId: r.runId, summary: r.reason };
    });
  }

  if (assistantMode("morning_digest") === "auto" && isWeekday(now) && time >= MORNING_DIGEST_AT) {
    attempt("morning_digest", () => {
      const r = runMorningDigest("schedule", null, now);
      if (!r) return null;
      void r.sending.catch((e: unknown) => console.error("[morning_digest]", e instanceof Error ? e.message : "failed"));
      return { runId: r.runId, summary: r.summary };
    });
  }

  // Mail: what was read on earlier ticks is read for changes now; the
  // mailboxes themselves are read in the background for the next tick.
  if (assistantMode("mail_reader") === "auto") {
    attempt("mail_reader", () => runMailReader("schedule", null, at));
    void readMailboxes(at)?.catch((e: unknown) => console.error("[mail]", e instanceof Error ? e.message : "failed"));
  }

  // Writer: Today's summaries from the morning, accounts as they move. Each
  // only when its facts changed, so most ticks start nothing.
  if (assistantMode("writer") === "auto" && time >= WRITER_MORNING) {
    attempt("writer", () => runWriter("schedule", null, now));
  }

  if (!calendarBusy && listSources().length > 0) {
    calendarBusy = true;
    void calendarTick(at)
      .catch((e: unknown) => console.error("[calendar]", e))
      .finally(() => {
        calendarBusy = false;
      });
    report.calendars = "reading";
  }

  return report;
}

let calendarBusy = false;
