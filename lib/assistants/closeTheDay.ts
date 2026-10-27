// Close the day: Ask drafts two lines about what you did today, from the
// records you touched, and you choose whether your partner sees them. It
// never sends anything itself (DECISIONS #55): "Send" is a person pressing a
// button, and what it does is put the note on the other person's Today.
import { db } from "../db";
import { listUsers } from "../auth";
import { BudgetError } from "../ai/guard";
import { todayISO } from "../clock";
import { startAsk } from "../ask/run";
import { listMessages } from "../ask/threads";
import { closeTheDay } from "../queries/closeTheDay";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";
import { postReady } from "./ready";

/** Weekdays from this time, in the app's timezone. */
export const CLOSE_THE_DAY_AT = "17:30";
/** When the button appears on Today. */
export const CLOSE_BUTTON_FROM = "15:00";

export function isWeekday(now = new Date()): boolean {
  const d = new Date(`${todayISO(now)}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

const prefix = (day: string) => `Close the day for ${day}`;

export function closeQuestion(me: string, now = new Date()): string | null {
  const day = closeTheDay(me, now);
  if (day.did.length === 0 && day.decided === 0) return null;
  return [
    `${prefix(day.today)}: write two short lines for my partner about what I did today, citing the records, and nothing about what is left.`,
    "What I touched today:",
    ...day.did.map((d) => `- ${d.label} (${d.kind} ${d.id}) on ${d.accountName}: ${d.what}`),
    day.decided ? `- decided ${day.decided} proposed change${day.decided === 1 ? "" : "s"}` : "",
    "Look each record up before you write about it. No headings, no list: two plain sentences.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Today's close-the-day conversation for this person, if there is one. */
export function todaysCloseThread(me: string, now = new Date()): string | null {
  const r = db()
    .prepare(`SELECT id FROM ask_threads WHERE created_by = ? AND title LIKE ? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .get(me, `${prefix(todayISO(now))}%`) as { id: string } | undefined;
  return r?.id ?? null;
}

/** The note: the last answer on today's close-the-day conversation. */
export function closeNote(threadId: string) {
  return listMessages(threadId).filter((m) => m.role === "assistant").at(-1) ?? null;
}

export function startCloseNote(me: string, trigger: RunTrigger, now = new Date()): { runId: string; threadId: string } | { reason: string } {
  const question = closeQuestion(me, now);
  if (!question) return { reason: "Nothing changed in the app today, so there is nothing to write up." };
  const existing = todaysCloseThread(me, now);
  const r = startAsk({ userId: me, question, threadId: existing, assistant: "close_the_day", save: true });
  if (trigger === "schedule") {
    postReady({
      assistant: "close_the_day",
      forUserId: me,
      title: "Your day is ready to close",
      why: "what you did, the loose ends, and a note for the team",
      href: "/?view=close",
      action: "Close it",
      subjectId: `close:${me}:${todayISO(now)}`,
      dedupeKey: `close_the_day:${me}:${todayISO(now)}`,
      runId: null,
    });
  }
  return r;
}

export function runCloseTheDay(trigger: RunTrigger, pressedBy: string | null, now = new Date()): { runId: string; started: number; reason: string } {
  const runId = beginAssistantRun("close_the_day", trigger, pressedBy);
  const people = trigger === "manual" && pressedBy ? listUsers().filter((u) => u.id === pressedBy) : listUsers();
  let started = 0;
  const notes: string[] = [];
  for (const p of people) {
    try {
      const r = startCloseNote(p.id, trigger, now);
      if ("reason" in r) notes.push(`${p.display_name}: ${r.reason.toLowerCase()}`);
      else started += 1;
    } catch (e) {
      if (!(e instanceof BudgetError)) {
        endAssistantRun(runId, { status: "failed", summary: "Could not draft the note.", error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
      notes.push(e.message);
    }
  }
  const reason = started ? `Drafting ${started} note${started === 1 ? "" : "s"}.` : notes.join(" ") || "Nobody to close the day for.";
  endAssistantRun(runId, { status: started ? "done" : "skipped", summary: reason });
  return { runId, started, reason };
}

/** Put the note on everyone else's Today. Only ever from a person pressing Send. */
export function sendCloseNote(threadId: string, me: string): { to: string } {
  const others = listUsers().filter((u) => u.id !== me);
  if (!others.length) throw new BudgetError("There is nobody else to send it to.");
  const note = closeNote(threadId);
  if (!note) throw new BudgetError("There is no note to send yet.");
  const sender = listUsers().find((u) => u.id === me)?.display_name ?? "A teammate";
  const first = note.text.replace(/\[\d{1,3}\]/g, "").replace(/\s+/g, " ").trim();
  for (const other of others) {
    postReady({
      assistant: "close_the_day",
      forUserId: other.id,
      title: `${sender} closed the day`,
      why: first.length > 160 ? `${first.slice(0, 158)}…` : first,
      href: `/ask/${threadId}`,
      action: "Read it",
      subjectId: threadId,
      dedupeKey: `close_sent:${threadId}:${note.id}:${other.id}`,
      runId: null,
    });
  }
  return { to: others.length === 1 ? others[0]!.display_name : "the team" };
}
