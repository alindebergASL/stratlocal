// Mail reader (DECISIONS #102): on each tick, reads every connected mailbox
// since its last read, empties bodies past their 30 days, and starts reading
// at most a few threads for changes. The reading of mailboxes happens off the
// tick, so a slow provider never holds the scheduler's knock open.
import { mailSources, purgeMailBodies, readMailbox, threadsToRead } from "../mail/sync";
import { startMailExtraction } from "../mail/extract";
import { BudgetError } from "../ai/guard";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";

export const THREADS_PER_TICK = 5;

let reading = false;

/** Reads mailboxes in the background; returns at once. */
export function readMailboxes(now = Date.now()): Promise<void> | null {
  if (reading) return null;
  const sources = mailSources();
  if (sources.length === 0) return null;
  reading = true;
  return (async () => {
    try {
      for (const s of sources) await readMailbox(s.userId, now).catch(() => {});
    } finally {
      reading = false;
    }
  })();
}

export function runMailReader(trigger: RunTrigger, userId: string | null, now = Date.now()): { runId: string; summary: string } | null {
  purgeMailBodies(now);
  const threads = threadsToRead(THREADS_PER_TICK);
  if (threads.length === 0) return null;
  const runId = beginAssistantRun("mail_reader", trigger, userId);
  let started = 0;
  let stopped: string | null = null;
  for (const t of threads) {
    try {
      startMailExtraction(t, userId);
      started++;
    } catch (e) {
      if (!(e instanceof BudgetError)) throw e;
      stopped = e.message;
      break;
    }
  }
  const summary = `${started} thread${started === 1 ? "" : "s"} being read${stopped ? `; stopped: ${stopped}` : ""}`;
  endAssistantRun(runId, { status: started ? "done" : "skipped", summary });
  return { runId, summary };
}
