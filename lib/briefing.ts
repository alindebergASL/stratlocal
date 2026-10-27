// The morning briefing (DECISIONS #99): what changed since you last looked,
// what is due today, and what the assistants prepared, every number counted
// from the records rather than written by a model. Today shows it; the
// morning digest sends a short form of it to Slack or Teams.
//
// `buildBriefing` is pure and decides the words; `gatherBriefing` reads the
// database. After CLOSE_BUTTON_FROM the same block becomes Close the day.
import { db } from "./db";
import { nowHHMM, todayISO } from "./clock";
import { upcomingMeetings, partnerDigest, clearedToday, type UpcomingMeeting, type PartnerDigest } from "./queries/today";
import { listAttention, listDueToday } from "./queries/attention";
import { watchDrafts, type WatchDraft } from "./assistants/accountWatch";
import { calendarReview } from "./calendar/review";
import { openReady } from "./assistants/ready";
import { assistantMode } from "./assistants/settings";
import { inboxSummary } from "./inbox/query";
import { CLOSE_BUTTON_FROM } from "./assistants/closeTheDay";
import { getPref, setPref } from "./prefs";

/** "Overnight" never reaches further back than this, however long you were away. */
export const BRIEFING_MAX_HOURS = 24;

export type DealMove = { dealId: string; name: string; accountId: string; accountName: string; fields: string[] };

export type BriefingInput = {
  sinceMs: number;
  closing: boolean;
  findings: WatchDraft[];
  partners: PartnerDigest[];
  deals: DealMove[];
  calendar: { toAdd: number; questions: number };
  meetings: UpcomingMeeting[];
  prepOn: boolean;
  overdue: number;
  dueToday: number;
  ready: number;
  inbox: { total: number; quick: number };
  cleared: number;
};

export type BriefingItem = { text: string; href: string };
export type BriefingLine = { key: string; text: string; href: string; items: BriefingItem[] };
export type Briefing = { closing: boolean; sinceMs: number; sections: Array<{ key: "overnight" | "due" | "prepared"; title: string; lines: BriefingLine[] }> };

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const FIELD: Record<string, string> = { stage: "stage", status: "status", close_date: "close date", tcv_usd: "value" };

export function buildBriefing(i: BriefingInput): Briefing {
  const overnight: BriefingLine[] = [];
  const findings = i.findings.reduce((s, f) => s + f.findings, 0);
  if (findings > 0)
    overnight.push({ key: "findings", text: `${n(findings, "new finding")} on ${n(i.findings.length, "account")}`, href: "/inbox?kind=research", items: i.findings.map((f) => ({ text: `${f.accountName}: ${n(f.findings, "finding")}${f.signals ? `, ${n(f.signals, "reason")} to act` : ""}`, href: `/accounts/${f.accountId}/research#research-review` })) });
  if (i.deals.length > 0)
    overnight.push({ key: "deals", text: `${n(i.deals.length, "deal")} moved`, href: "/pipeline", items: i.deals.map((d) => ({ text: `${d.accountName} · ${d.name}: ${d.fields.map((f) => FIELD[f] ?? f).join(", ")}`, href: `/accounts/${d.accountId}/deals/${d.dealId}` })) });
  for (const p of i.partners)
    overnight.push({ key: `partner-${p.actorId}`, text: `${p.actorName} changed ${n(p.records, "record")}`, href: "/activity?days=1", items: p.accounts.map((a) => ({ text: a.name, href: `/accounts/${a.id}` })) });
  const cal = i.calendar.toAdd + i.calendar.questions;
  if (cal > 0) overnight.push({ key: "calendar", text: `${n(cal, "calendar event")} to add or match`, href: "/inbox?kind=calendar", items: [] });

  const due: BriefingLine[] = [];
  if (i.meetings.length > 0) {
    const briefed = i.meetings.filter((m) => m.hasBrief).length;
    const missing = i.meetings.length - briefed;
    const state = missing === 0 ? "briefs ready" : i.prepOn ? `${missing === i.meetings.length ? "briefs" : `${missing} brief${missing === 1 ? "" : "s"}`} being prepared` : `${n(missing, "without a brief", "without briefs")}`;
    due.push({ key: "meetings", text: `${n(i.meetings.length, "meeting")} · ${state}`, href: i.meetings[0]!.href, items: i.meetings.map((m) => ({ text: `${m.heldTime ?? "Today"} · ${m.accountName}: ${m.title}${m.hasBrief ? "" : " (no brief yet)"}`, href: m.hasBrief ? `${m.href}#brief` : m.href })) });
  }
  if (i.overdue + i.dueToday > 0)
    due.push({ key: "tasks", text: [i.dueToday ? `${n(i.dueToday, "task")} due today` : null, i.overdue ? `${i.overdue} late` : null].filter(Boolean).join(" · "), href: "/follow-ups", items: [] });

  const prepared: BriefingLine[] = [];
  if (i.inbox.total > 0) prepared.push({ key: "inbox", text: `${i.inbox.total} waiting in your Inbox${i.inbox.quick ? ` · ${i.inbox.quick} quick to accept` : ""}`, href: "/inbox", items: [] });
  if (i.ready > 0) prepared.push({ key: "ready", text: `${n(i.ready, "thing")} an assistant wrote for you`, href: "/", items: [] });
  if (i.closing) prepared.push({ key: "close", text: i.cleared > 0 ? `${i.cleared} cleared today · close the day` : "Close the day", href: "/?view=close", items: [] });

  return {
    closing: i.closing,
    sinceMs: i.sinceMs,
    sections: [
      { key: "overnight" as const, title: i.closing ? "Since this morning" : "Since you last looked", lines: overnight },
      { key: "due" as const, title: i.closing ? "Still today" : "Today", lines: due },
      { key: "prepared" as const, title: "Waiting on you", lines: prepared },
    ].filter((s) => s.lines.length > 0),
  };
}

/** A gap this long between two visits to Today starts a new "since you last looked". */
export const NEW_LOOK_AFTER_HOURS = 3;

/**
 * When "since you last looked" starts, without moving it on every reload: a
 * visit within a few hours of the last one keeps the same start, so accepting
 * something and coming back does not empty the briefing. Never more than a
 * day back. Read-only unless `record` is set (Today records; the digest does not).
 */
export function briefingSince(me: string, now: Date, record = false): number {
  const at = now.getTime();
  const floor = at - BRIEFING_MAX_HOURS * 3_600_000;
  const seen = Number(getPref(me, "today_last_seen") ?? NaN);
  const kept = Number(getPref(me, "today_since") ?? NaN);
  const fresh = !Number.isFinite(seen) || at - seen > NEW_LOOK_AFTER_HOURS * 3_600_000;
  const since = fresh ? (Number.isFinite(seen) ? seen : floor) : Number.isFinite(kept) ? kept : seen;
  if (record) {
    if (fresh) setPref(me, "today_since", String(since));
    setPref(me, "today_last_seen", String(at));
  }
  return Math.max(since, floor);
}

function dealMoves(me: string, sinceMs: number): DealMove[] {
  const rows = db()
    .prepare(
      `SELECT c.entity_id AS deal_id, d.name, a.id AS account_id, a.name AS account_name, GROUP_CONCAT(DISTINCT c.field) AS fields
       FROM change_log c JOIN deals d ON d.deal_id = c.entity_id JOIN accounts a ON a.id = d.account_id
       WHERE c.entity_type = 'deal' AND c.field IN ('stage','status','close_date','tcv_usd') AND c.old_value IS NOT NULL
         AND c.created_at > ? AND (c.actor_user_id IS NULL OR c.actor_user_id <> ?) AND d.archived_at IS NULL AND a.archived_at IS NULL
       GROUP BY c.entity_id ORDER BY MAX(c.created_at) DESC LIMIT 20`,
    )
    .all(sinceMs, me) as Array<{ deal_id: string; name: string; account_id: string; account_name: string; fields: string }>;
  return rows.map((r) => ({ dealId: r.deal_id, name: r.name, accountId: r.account_id, accountName: r.account_name, fields: r.fields.split(",") }));
}

export function gatherBriefing(me: string, now = new Date(), sinceMs = briefingSince(me, now)): BriefingInput {
  const today = todayISO(now);
  const attention = [...listAttention(now), ...listDueToday(now)];
  const cal = calendarReview(today);
  const inbox = inboxSummary(me, today);
  const hours = Math.max(1, Math.ceil((now.getTime() - sinceMs) / 3_600_000));
  return {
    sinceMs,
    closing: nowHHMM(now) >= CLOSE_BUTTON_FROM,
    findings: watchDrafts(),
    partners: partnerDigest(now, me, undefined, hours).filter((p) => p.latestAt > sinceMs),
    deals: dealMoves(me, sinceMs),
    calendar: { toAdd: cal.toAdd.length, questions: cal.questions.length },
    meetings: upcomingMeetings(now, 1).filter((m) => m.heldAt === today),
    prepOn: assistantMode("meeting_prep") === "auto",
    overdue: attention.filter((a) => a.kind === "overdue").reduce((s, a) => s + (a.count ?? 1), 0),
    dueToday: attention.filter((a) => a.kind === "due_today").reduce((s, a) => s + (a.count ?? 1), 0),
    ready: openReady(me).length,
    inbox: { total: inbox.total, quick: inbox.changes.reduce((s, c) => s + c.quick, 0) },
    cleared: clearedToday(now, me),
  };
}

/** The briefing as a short message for Slack or Teams: counts and links only, unless names were asked for. */
export function digestText(b: Briefing, i: BriefingInput, opts: { names: boolean }): string {
  if (b.sections.length === 0) return "Nothing new and nothing due today.";
  const lines = b.sections.flatMap((s) => s.lines.map((l) => `• ${l.text}`));
  if (opts.names) {
    const accounts = [...new Set([...i.findings.map((f) => f.accountName), ...i.deals.map((d) => d.accountName), ...i.meetings.map((m) => m.accountName)])];
    if (accounts.length) lines.push(`Accounts: ${accounts.slice(0, 8).join(", ")}${accounts.length > 8 ? ` and ${accounts.length - 8} more` : ""}`);
  }
  return lines.join("\n");
}

