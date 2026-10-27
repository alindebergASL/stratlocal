"use server";

// The Assistants page's writes, and the answers to what an assistant asked.
// None of these touches an account record except answerPromise, which sets a
// follow-up's date through the same save every other edit uses.
import { runQuarterlyRefresh } from "@/lib/assistants/quarterlyRefresh";
import { runScheduledReports } from "@/lib/assistants/scheduledReports";
import { runCloseTheDay } from "@/lib/assistants/closeTheDay";
import { runFridayReview } from "@/lib/assistants/fridayReview";
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { isRealDay, todayISO } from "@/lib/clock";
import { startOfToday } from "@/lib/ai/guard";
import { saveTask, getTask } from "@/lib/planning";
import type { ActionResult } from "@/components/attempt";
import { assistantDef, isAssistantId, type AssistantMode } from "@/lib/assistants/registry";
import { assistantMode, assistantSetting, saveAssistant, saveBudget, SettingsError } from "@/lib/assistants/settings";
import { sendToPerson } from "@/lib/integrations";
import { digestMessage } from "@/lib/assistants/morningDigest";
import { runMailReader } from "@/lib/assistants/mailReader";
import { runWriter } from "@/lib/assistants/writer";
import { getNotice, NoticeError, resolveNotice, runPromiseKeeper } from "@/lib/assistants/promiseKeeper";
import { runMeetingPrep } from "@/lib/assistants/meetingPrep";
import { runAccountWatch, setWatched } from "@/lib/assistants/accountWatch";
import { runPlanLook, runThesisLook } from "@/lib/assistants/planKeeper";
import { runHandoffWriter } from "@/lib/handoff/writer";
import { BudgetError } from "@/lib/ai/guard";

// Dollars as typed ("250", "$1,250.50") to whole cents, or null.
function readDollars(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

function refresh() {
  revalidatePath("/assistants");
  revalidatePath("/inbox");
  revalidatePath("/");
}

export async function saveBudgetAction(fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const total = readDollars(fd.get("total"));
  const share = readDollars(fd.get("share"));
  if (total === null || share === null) return { ok: false, error: "Write each amount in dollars, like 250 or 99.50." };
  try {
    saveBudget({ monthlyTotalCents: total, peopleShareCents: share }, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    if (e instanceof SettingsError) return { ok: false, error: e.message };
    return { ok: false, error: describeError(e) };
  }
}

export async function saveAssistantAction(id: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  if (!isAssistantId(id)) return { ok: false, error: "No such assistant." };
  const mode = String(fd.get("mode") ?? "") as AssistantMode;
  const limit = readDollars(fd.get("limit"));
  if (limit === null) return { ok: false, error: "Write the limit in dollars, like 20." };
  try {
    saveAssistant(id, { mode, monthlyCents: limit }, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    if (e instanceof SettingsError) return { ok: false, error: e.message };
    return { ok: false, error: describeError(e) };
  }
}

// The assistants worth running on their own from day one (DECISIONS #99),
// each within its own monthly limit as it stands. A limit that no longer
// fits the month is refused by saveAssistant, as when set one at a time.
const RECOMMENDED_AUTO = ["promise_keeper", "meeting_prep", "plan_keeper", "account_watch"] as const;

export async function recommendedOnAction(): Promise<ActionResult> {
  const user = await requirePageUser();
  const refused: string[] = [];
  for (const id of RECOMMENDED_AUTO) {
    try {
      saveAssistant(id, { mode: "auto", monthlyCents: assistantSetting(id).monthlyCents }, user.id);
    } catch (e) {
      refused.push(`${assistantDef(id)?.name ?? id}: ${e instanceof SettingsError ? e.message : describeError(e)}`);
    }
  }
  refresh();
  return refused.length ? { ok: false, error: refused.join(" ") } : { ok: true };
}

export type RunNowResult = { ok: true; summary: string } | { ok: false; error: string };

export async function runAssistantNow(id: string): Promise<RunNowResult> {
  const user = await requirePageUser();
  if (!isAssistantId(id)) return { ok: false, error: "No such assistant." };
  if (assistantMode(id) === "off") return { ok: false, error: "It is switched off. Choose When I ask or On its own first." };
  try {
    if (id === "promise_keeper") {
      const r = runPromiseKeeper("manual", user.id);
      refresh();
      return { ok: true, summary: r.added > 0 ? `${r.added} new to look at.` : `Checked ${r.checked} open follow-ups. Nothing new.` };
    }
    if (id === "meeting_prep") {
      const r = runMeetingPrep("manual", user.id, new Date(), startOfToday());
      refresh();
      if (!r || r.candidates === 0) return { ok: true, summary: "No meeting today or tomorrow needs a brief." };
      return r.started.length > 0
        ? { ok: true, summary: `Writing ${r.started.length} brief${r.started.length === 1 ? "" : "s"}. They appear on each meeting when done.` }
        : { ok: false, error: r.skipped[0]?.reason ?? "Nothing could start." };
    }
    if (id === "account_watch") {
      const r = runAccountWatch("manual", user.id);
      refresh();
      if (!r || !r.started) return { ok: false, error: r?.reason ?? "Nothing to look at." };
      return { ok: true, summary: `${r.reason} The note appears on its research page when done.` };
    }
    if (id === "plan_keeper") {
      const look = runPlanLook("manual", user.id);
      const thesis = runThesisLook("manual", user.id);
      refresh();
      const plays = look.added > 0 ? `${look.added} new question${look.added === 1 ? "" : "s"} about plays` : `Looked at ${look.checked} live plays; nothing new`;
      return { ok: true, summary: `${plays}.${thesis ? ` ${thesis.reason}` : " No thesis is due a check this month."}` };
    }
    if (id === "handoff_writer") {
      const r = runHandoffWriter("manual", user.id);
      refresh();
      return r && r.started ? { ok: true, summary: `${r.reason} It appears on /handoff when done.` } : { ok: false, error: r?.reason ?? "Nothing to hand over." };
    }
    if (id === "friday_review") {
      const r = runFridayReview("manual", user.id);
      refresh();
      return r.started ? { ok: true, summary: `${r.reason} It appears on Today when done.` } : { ok: false, error: r.reason };
    }
    if (id === "close_the_day") {
      const r = runCloseTheDay("manual", user.id);
      refresh();
      return r.started ? { ok: true, summary: `${r.reason} It appears on Close the day when done.` } : { ok: false, error: r.reason };
    }
    if (id === "scheduled_reports") {
      const r = runScheduledReports("manual", user.id);
      refresh();
      return r && r.started ? { ok: true, summary: `${r.reason} Each appears on Today when done.` } : { ok: false, error: r?.reason ?? "Nothing to run." };
    }
    if (id === "quarterly_refresh") {
      const r = runQuarterlyRefresh("manual", user.id);
      refresh();
      return r.started ? { ok: true, summary: `${r.reason} It is waiting in the account's review.` } : { ok: false, error: r.reason };
    }
    if (id === "writer") {
      const r = runWriter("manual", user.id);
      refresh();
      return { ok: true, summary: r ? `${r.summary}. It appears on Today and the accounts when done.` : "Everything written is current." };
    }
    if (id === "mail_reader") {
      const r = runMailReader("manual", user.id);
      refresh();
      return { ok: true, summary: r ? `${r.summary}. Changes appear in the Inbox when done.` : "No new email to read. Read your mailbox now from Settings → Connections." };
    }
    if (id === "morning_digest") {
      // Pressed, it sends you yours now, whatever was sent this morning.
      const sent = await sendToPerson(user.id, digestMessage(user.id, new Date()));
      if (sent.length === 0) return { ok: false, error: "Connect Slack or Teams under Settings → Connections first." };
      const bad = sent.filter((r) => !r.ok);
      return bad.length ? { ok: false, error: bad.map((r) => `${r.kind === "slack" ? "Slack" : "Teams"}: ${r.error}`).join("; ") } : { ok: true, summary: `Sent to ${sent.map((r) => (r.kind === "slack" ? "Slack" : "Teams")).join(" and ")}.` };
    }
    return { ok: false, error: "This assistant cannot run yet." };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

export async function dismissNotice(id: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    resolveNotice(id, user.id, "dismissed");
    refresh();
    return { ok: true };
  } catch (e) {
    if (e instanceof NoticeError) return { ok: false, error: e.message };
    return { ok: false, error: describeError(e) };
  }
}

// "When did they say?" answered with a date. The follow-up gets the date
// through the ordinary save, so it lands in history as your edit; the
// question is then closed as answered.
export async function answerPromise(noticeId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const due = String(fd.get("due") ?? "").trim();
  if (!isRealDay(due)) return { ok: false, error: "Pick a real day." };
  if (due < todayISO()) return { ok: false, error: "That day has passed. If it slipped, pick when you will chase it." };
  const notice = getNotice(noticeId);
  if (!notice || notice.resolved_at || notice.kind !== "question" || !notice.action_item_id) return { ok: false, error: "That question was already answered." };
  const item = getTask(notice.action_item_id);
  if (!item || item.status !== "open" || item.archived_at) return { ok: false, error: "That follow-up is closed or archived now." };
  try {
    if (item.due) {
      // Someone gave it a date meanwhile. Theirs stands; the question is moot.
      resolveNotice(noticeId, user.id, "answered");
      refresh();
      return { ok: false, error: `It already has a date: ${item.due}. Nothing changed.` };
    }
    saveTask({ accountId: item.account_id, itemId: item.id, payload: { due }, version: item.updated_at, userId: user.id });
    resolveNotice(noticeId, user.id, "answered");
    revalidatePath(`/accounts/${item.account_id}`);
    if (item.meeting_id) revalidatePath(`/accounts/${item.account_id}/meetings/${item.meeting_id}`);
    revalidatePath("/follow-ups");
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

export async function setWatchedAction(accountId: string, on: boolean): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    setWatched(accountId, on, user.id);
    refresh();
    revalidatePath(`/accounts/${accountId}/research`);
    return { ok: true };
  } catch (e) {
    if (e instanceof BudgetError) return { ok: false, error: e.message };
    return { ok: false, error: describeError(e) };
  }
}
