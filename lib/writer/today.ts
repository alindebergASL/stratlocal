// The facts Today's summary is written from (DECISIONS #106): the same ones
// the counted briefing shows (lib/briefing.ts), one citable key each.
import { todayISO } from "../clock";
import type { BriefingInput } from "../briefing";
import type { Fact } from "./core";

export function todayKey(userId: string, now: Date, closing: boolean): string {
  return `today:${userId}:${todayISO(now)}:${closing ? "pm" : "am"}`;
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function todayFacts(i: BriefingInput): Fact[] {
  const facts: Fact[] = [];
  for (const f of i.findings)
    facts.push({ key: `finding:${f.accountId}`, label: `${f.accountName}: ${n(f.findings, "new finding")}`, href: `/accounts/${f.accountId}/research#research-review`, facts: `${n(f.signals, "reason")} to act; ${n(f.touching, "touches a play", "touch a play")}` });
  for (const d of i.deals)
    facts.push({ key: `deal:${d.dealId}`, label: `${d.accountName} · ${d.name}`, href: `/accounts/${d.accountId}/deals/${encodeURIComponent(d.dealId)}`, facts: `moved since you last looked: ${d.fields.join(", ")}` });
  for (const p of i.partners)
    facts.push({ key: `partner:${p.actorId}`, label: `${p.actorName}`, href: "/activity?days=1", facts: `changed ${n(p.records, "record")} on ${p.accounts.map((a) => a.name).join(", ")}` });
  for (const m of i.meetings)
    facts.push({ key: `meeting:${m.id}`, label: `${m.heldTime ?? "Today"} · ${m.accountName}: ${m.title}`, href: m.hasBrief ? `${m.href}#brief` : m.href, facts: m.hasBrief ? "brief ready" : i.prepOn ? "brief being prepared" : "no brief yet" });
  if (i.overdue + i.dueToday > 0) facts.push({ key: "tasks", label: "Your tasks", href: "/follow-ups", facts: `${i.dueToday} due today, ${i.overdue} late` });
  if (i.inbox.total > 0) facts.push({ key: "inbox", label: "Your Inbox", href: "/inbox", facts: `${i.inbox.total} waiting, ${i.inbox.quick} quick to accept` });
  if (i.closing && i.cleared > 0) facts.push({ key: "cleared", label: "Cleared today", href: "/?view=close", facts: `${i.cleared} cleared` });
  return facts;
}

export const TODAY_TASK = `Write the morning summary: two to four sentences on what matters most today and why, most important first. Meetings and things waiting on the person come before background. If it is the afternoon summary, say what is still open before the day ends.`;
