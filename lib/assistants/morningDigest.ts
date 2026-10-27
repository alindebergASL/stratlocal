// Morning digest (DECISIONS #99): on weekday mornings, each person who
// connected Slack or Teams and turned the digest on gets a short form of
// Today's briefing. Counts and a link; account names only if they asked.
// Once a day per person: the day is marked before sending, so a slow or
// failing webhook is never retried in a loop. With names on and the Writer's
// summary written (DECISIONS #106), the summary leads and the counts follow.
// A failure is recorded on the connection and shown on Settings → Connections.
import { todayISO } from "../clock";
import { buildBriefing, briefingSince, digestText, gatherBriefing } from "../briefing";
import { connectedUsers, sendToPerson } from "../integrations";
import { flag, getPref, setPref } from "../prefs";
import { writtenFor } from "../writer/core";
import { todayKey } from "../writer/today";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";

export const MORNING_DIGEST_AT = "07:45";

export function appLink(): string | null {
  const host = (process.env.APP_HOSTNAME ?? "").trim();
  return host ? `https://${host}/` : null;
}

export function digestMessage(userId: string, now: Date): { text: string; link?: { label: string; url: string } } {
  const input = gatherBriefing(userId, now, briefingSince(userId, now));
  const b = buildBriefing(input);
  const url = appLink();
  const names = flag(userId, "digest_names");
  const written = names ? writtenFor(todayKey(userId, now, input.closing), null) : null;
  const summary = written ? `${written.sentences.map((s) => s.text).join(" ")}\n` : "";
  return { text: `Today\n${summary}${digestText(b, input, { names })}`, ...(url ? { link: { label: "Open Today", url } } : {}) };
}

/** Who is due a digest today: connected, switched on, not yet sent today. */
export function dueForDigest(now: Date): string[] {
  const today = todayISO(now);
  return connectedUsers().filter((u) => flag(u, "digest_on") && getPref(u, "digest_sent_day") !== today);
}

/**
 * Marks each person's day and returns the run; the sending happens after,
 * off the tick, so a slow webhook never holds the scheduler's knock open.
 */
export function runMorningDigest(trigger: RunTrigger, userId: string | null, now = new Date()): { runId: string; summary: string; sending: Promise<void> } | null {
  const people = dueForDigest(now);
  if (people.length === 0) return null;
  const today = todayISO(now);
  for (const u of people) setPref(u, "digest_sent_day", today);
  const runId = beginAssistantRun("morning_digest", trigger, userId);
  const sending = (async () => {
    let sent = 0;
    let failed = 0;
    for (const u of people) {
      try {
        const results = await sendToPerson(u, digestMessage(u, now));
        sent += results.filter((r) => r.ok).length;
        failed += results.filter((r) => !r.ok).length;
      } catch {
        failed += 1;
      }
    }
    endAssistantRun(runId, { status: failed && !sent ? "failed" : "done", summary: `${sent} sent${failed ? `, ${failed} failed` : ""}`, error: failed ? "See Settings → Connections for which." : null });
  })();
  return { runId, summary: `sending to ${people.length}`, sending };
}
