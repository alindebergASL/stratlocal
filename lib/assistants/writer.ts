// Writer (DECISIONS #106): writes Today's summary for each person in the
// morning (and again after the close-the-day hour), and an account's Where
// it stands when its records have moved: watched accounts and those touched
// in the last day, a few per tick. Each only when the facts changed since the
// last version. Off, it writes nothing and the counted text shows.
import { db, OWN_WORK_ACCOUNT_ID } from "../db";
import { listUsers } from "../auth";
import { todayISO } from "../clock";
import { briefingSince, gatherBriefing } from "../briefing";
import { BudgetError } from "../ai/guard";
import { startWriting } from "../writer/core";
import { TODAY_TASK, todayFacts, todayKey } from "../writer/today";
import { ACCOUNT_TASK, accountFacts, accountKey } from "../writer/account";
import { accountLead } from "../writer/lead";
import { assistantMode } from "./settings";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";

export const WRITER_MORNING = "07:30";
export const ACCOUNTS_PER_TICK = 3;

export function writeToday(userId: string, now = new Date()): string | null {
  const input = gatherBriefing(userId, now, briefingSince(userId, now));
  return startWriting({ key: todayKey(userId, now, input.closing), facts: todayFacts(input), task: TODAY_TASK, userId, once: true });
}

export function writeAccount(accountId: string, userId: string | null, now = new Date()): string | null {
  const today = todayISO(now);
  return startWriting({ key: accountKey(accountId), facts: accountFacts(accountId, today, accountLead(accountId, today)), task: ACCOUNT_TASK, userId });
}

/** Accounts worth keeping current: watched ones, and any touched in the last day. */
function accountsToWrite(now: number): string[] {
  return (
    db()
      .prepare(
        `SELECT a.id FROM accounts a WHERE a.archived_at IS NULL AND a.kind = 'customer' AND a.id != ? AND (
           EXISTS (SELECT 1 FROM watched_accounts w WHERE w.account_id = a.id)
           OR EXISTS (SELECT 1 FROM change_log c WHERE c.account_id = a.id AND c.created_at > ?))
         ORDER BY a.name`,
      )
      .all(OWN_WORK_ACCOUNT_ID, now - 86400_000) as Array<{ id: string }>
  ).map((r) => r.id);
}

export function runWriter(trigger: RunTrigger, userId: string | null, now = new Date()): { runId: string; summary: string } | null {
  let started = 0;
  let stopped: string | null = null;
  const attempt = (fn: () => string | null) => {
    if (stopped) return;
    try {
      if (fn()) started++;
    } catch (e) {
      if (!(e instanceof BudgetError)) throw e;
      stopped = e.message;
    }
  };
  for (const u of listUsers()) attempt(() => writeToday(u.id, now));
  let accounts = 0;
  for (const id of accountsToWrite(now.getTime())) {
    if (accounts >= ACCOUNTS_PER_TICK) break;
    const before = started;
    attempt(() => writeAccount(id, userId, now));
    if (started > before) accounts++;
  }
  if (started === 0 && !stopped) return null;
  const runId = beginAssistantRun("writer", trigger, userId);
  const summary = `${started} being written${stopped ? `; stopped: ${stopped}` : ""}`;
  endAssistantRun(runId, { status: started ? "done" : "skipped", summary });
  return { runId, summary };
}

export const writerOn = () => assistantMode("writer") === "auto";
