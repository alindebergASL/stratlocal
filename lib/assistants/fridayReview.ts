// Friday review: for each person, the deals on their accounts that need a
// look — picked in code by a rule that is shown with the list — and a report
// Ask writes around them, left on their Today. It reads and writes a report;
// it changes no record (DECISIONS #1).
import { listUsers } from "../auth";
import { BudgetError } from "../ai/guard";
import { todayISO } from "../clock";
import { startAsk } from "../ask/run";
import { LOOK_RULE, needsALook, reasonsKeptThisWeek, type KeptReason, type NeedsALook } from "../queries/needsALook";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";
import { postReady } from "./ready";

/** Fridays from this time, in the app's timezone. */
export const FRIDAY_REVIEW_AT = "07:00";
export const FRIDAY = 5;

export function isFriday(now = new Date()): boolean {
  return new Date(`${todayISO(now)}T12:00:00Z`).getUTCDay() === FRIDAY;
}

const fmt = (n: number | null) => (n == null ? "no value" : `$${Math.round(n).toLocaleString("en-US")}`);

/** The question, with the picked deals in hand, so the review is about them. */
export function fridayQuestion(items: NeedsALook[], more: number, reasons: KeptReason[] = []): string {
  return [
    "Write my Friday pipeline review.",
    items.length ? `These deals need a look, picked by this rule: ${LOOK_RULE}` : "No deal matched the look rule this week.",
    ...items.map((d) => `- ${d.name} (deal_id ${d.dealId}) on ${d.accountName}, ${fmt(d.tcvUsd)}: ${d.why}`),
    more ? `${more} more matched the rule and are not listed.` : "",
    ...(reasons.length
      ? [
          "Reasons to act kept in research this week (the research's own read; read the account's research before you write about one):",
          ...reasons.map((r) => `- ${r.accountName} (account_id ${r.accountId}): ${r.kind === "compelling_event" ? "compelling event" : "trigger"}${r.date ? `, ${r.date}` : ""}: ${r.text}`),
        ]
      : []),
    "Look each one up before you write about it. Suggest a next step for each only from what the records say.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function runFridayReview(trigger: RunTrigger, pressedBy: string | null, now = new Date()): { runId: string; started: number; reason: string } {
  const runId = beginAssistantRun("friday_review", trigger, pressedBy);
  const people = trigger === "manual" && pressedBy ? listUsers().filter((u) => u.id === pressedBy) : listUsers();
  const today = todayISO(now);
  let started = 0;
  const notes: string[] = [];
  try {
    for (const person of people) {
      const look = needsALook(person.id, now);
      const reasons = reasonsKeptThisWeek(person.id, now);
      if (look.items.length === 0 && reasons.length === 0) {
        notes.push(`nothing on ${person.display_name}'s accounts needs a look`);
        continue;
      }
      const count = look.items.length + look.more;
      const title = [
        count ? `${count} deal${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} a look` : null,
        reasons.length ? `${reasons.length} new reason${reasons.length === 1 ? "" : "s"} to act` : null,
      ]
        .filter(Boolean)
        .join(", ");
      try {
        startAsk({
          userId: person.id,
          question: fridayQuestion(look.items, look.more, reasons),
          templateId: "friday_review",
          assistant: "friday_review",
          save: true,
          onDone: ({ threadId, reportDocId }) =>
            postReady({
              assistant: "friday_review",
              forUserId: person.id,
              title: `Friday review: ${title}`,
              why: [...reasons.slice(0, 1).map((r) => `${r.accountName}: ${r.kind === "compelling_event" ? "compelling event" : "reason to act"}`), ...look.items.slice(0, 2).map((d) => `${d.name}: ${d.why}`)].slice(0, 2).join("; "),
              href: reportDocId ? `/reports/${reportDocId}` : `/ask/${threadId}`,
              action: "Read it",
              subjectId: reportDocId ?? threadId,
              dedupeKey: `friday_review:${person.id}:${today}:${trigger}`,
              runId,
            }),
        });
        started += 1;
      } catch (e) {
        if (!(e instanceof BudgetError)) throw e;
        notes.push(e.message);
      }
    }
  } catch (e) {
    endAssistantRun(runId, { status: "failed", summary: "Could not start the review.", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  const said = notes.join("; ");
  const reason = started
    ? `Writing ${started} review${started === 1 ? "" : "s"}.${said ? ` Also: ${said}.` : ""}`
    : said
      ? `${said[0]!.toUpperCase()}${said.slice(1)}.`
      : "Nobody to review for.";
  endAssistantRun(runId, { status: started ? "done" : "skipped", summary: reason });
  return { runId, started, reason };
}
