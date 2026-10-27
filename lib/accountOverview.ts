// What the top of an account says, worked out once.
//
// The account page used to answer "where are we with this account" four
// times in four places — a hero card, an "Open tasks" card, a rail of links
// and the sections themselves — and the numbers a seller opens it for (what
// is open, what closes this quarter, how many deals have an agreed next step)
// sat at the bottom, inside a closed disclosure. This is the short version:
// a strip of vitals and at most four things that need one of you, each said
// once, each with one way in. Pure functions over rows the page already
// reads, so the Overview costs no extra queries and is tested without a page.
import { addDays } from "./clock";
import { needsNextStep } from "./deals/nextStep";
import { quarterLabel } from "./fiscal";
import { nextAccountMeeting } from "./glance";
import { scheduledElapsed } from "./workflow";

type Deal = { deal_id: string; name: string; status: string; tcv_usd: number | null; close_date: string | null; fiscal_quarter: string | null; next_step: string | null };
type Meeting = { id: string; title: string; held_at: string; held_time?: string | null; raw_notes?: string | null; brief_json?: string | null };
type FollowUp = { id: string; text: string; due: string | null };
type Play = { id: string; title: string; status: string; next_step: string | null; next_step_due: string | null };

export type AccountVitals = {
  openPipelineUsd: number;
  openDeals: number;
  thisQuarter: { label: string; usd: number; deals: number };
  withNextStep: number;
  nextClose: { dealId: string; name: string; date: string } | null;
  lastMeeting: string | null;
};

export function accountVitals(input: { deals: Deal[]; meetings: Meeting[]; today: string; quarter: string; now: Date }): AccountVitals {
  const open = input.deals.filter((d) => d.status === "open");
  // Grouped by the normalised label: the report writes "FY27Q2" in one row
  // and "FY27 Q2" in the next, and both are this quarter.
  const quarter = quarterLabel(input.quarter) ?? input.quarter;
  const thisQ = open.filter((d) => quarterLabel(d.fiscal_quarter) === quarter);
  const upcoming = open.filter((d) => d.close_date && d.close_date >= input.today).sort((a, b) => a.close_date!.localeCompare(b.close_date!));
  const past = input.meetings.filter((m) => scheduledElapsed(m, input.now)).map((m) => m.held_at.slice(0, 10)).sort();
  return {
    openPipelineUsd: open.reduce((s, d) => s + (d.tcv_usd ?? 0), 0),
    openDeals: open.length,
    thisQuarter: { label: quarter, usd: thisQ.reduce((s, d) => s + (d.tcv_usd ?? 0), 0), deals: thisQ.length },
    // A deal waived as "no next step needed" counts as covered (DECISIONS #88).
    withNextStep: open.filter((d) => !needsNextStep(d, input.today)).length,
    nextClose: upcoming[0] ? { dealId: upcoming[0].deal_id, name: upcoming[0].name, date: upcoming[0].close_date! } : null,
    lastMeeting: past.at(-1) ?? null,
  };
}

export type NeedsYouItem = {
  key: "follow-ups" | "review" | "meeting" | "notes" | "no-meeting" | "next-steps" | "plays" | "research" | "playbook";
  text: string;
  detail?: string;
  action: string;
  href: string;
  tone: "danger" | "warning" | "neutral";
};

export const NEEDS_YOU_MAX = 4;

/**
 * At most four rows, most urgent first, each kind at most once. A kind with
 * several of something says how many and names the first, rather than
 * becoming several rows.
 */
export function needsYou(input: {
  accountId: string;
  today: string;
  now: Date;
  followUps: FollowUp[];
  pending: number;
  planDraft: number;
  meetings: Meeting[];
  deals: Deal[];
  plays: Play[];
  researchDrafts: number;
  /** The next thing the playbook asks for, when the account is on a step. */
  playbookNext?: { text: string; step: string; position: string } | null;
}): NeedsYouItem[] {
  const { accountId: id, today, now } = input;
  const base = `/accounts/${id}`;
  const out: NeedsYouItem[] = [];

  const due = input.followUps.filter((f) => f.due && f.due <= today).sort((a, b) => a.due!.localeCompare(b.due!));
  if (due.length) {
    const overdue = due.filter((f) => f.due! < today).length;
    out.push({
      key: "follow-ups",
      text: due[0]!.text,
      detail: `${overdue ? `${overdue} overdue` : "due today"}${due.length > 1 ? ` · ${due.length - 1} more due` : ""}`,
      action: due.length > 1 ? "Follow-ups" : "Open",
      href: due.length > 1 ? `${base}/follow-ups` : `/follow-ups/${due[0]!.id}`,
      tone: overdue ? "danger" : "warning",
    });
  }

  if (input.pending > 0) {
    const plan = input.planDraft;
    out.push({
      key: "review",
      text: plan > 0 ? "A drafted plan is waiting for review" : "Proposed changes are waiting for review",
      detail: `${input.pending} change${input.pending === 1 ? "" : "s"}${plan > 0 && plan < input.pending ? `, ${plan} from the plan draft` : ""} · nothing is applied until one of you accepts it`,
      action: "Review",
      href: `/inbox?kind=changes&account=${id}`,
      tone: "warning",
    });
  }

  const next = nextAccountMeeting(input.meetings, now);
  const unwritten = input.meetings
    .filter((m) => !m.raw_notes?.trim() && m.held_at.slice(0, 10) >= addDays(today, -7) && scheduledElapsed(m, now))
    .sort((a, b) => b.held_at.localeCompare(a.held_at))[0];
  if (next && next.held_at.slice(0, 10) <= addDays(today, 7)) {
    out.push({
      key: "meeting",
      text: `${next.brief_json ? "Read the brief for" : "Prepare for"} ${next.title}`,
      detail: `${next.held_at.slice(0, 10)}${next.held_time ? ` at ${next.held_time}` : ""}`,
      action: next.brief_json ? "Read brief" : "Prepare",
      href: `${base}/meetings/${next.id}#brief`,
      tone: "neutral",
    });
  } else if (unwritten) {
    out.push({ key: "notes", text: `Add notes from ${unwritten.title}`, detail: unwritten.held_at.slice(0, 10), action: "Add notes", href: `${base}/meetings/${unwritten.id}#notes`, tone: "warning" });
  } else if (!next || next.held_at.slice(0, 10) > addDays(today, 30)) {
    out.push({ key: "no-meeting", text: "No meeting booked in the next 30 days", action: "Plan one", href: `${base}/meetings#meeting-new`, tone: "neutral" });
  }

  const open = input.deals.filter((d) => d.status === "open");
  const bare = open.filter((d) => needsNextStep(d, today));
  if (bare.length) {
    out.push({
      key: "next-steps",
      text: `${bare.length} of ${open.length} open deal${open.length === 1 ? " has" : "s have"} no next step`,
      detail: bare.length === 1 ? bare[0]!.name : undefined,
      action: "Set next steps",
      href: `${base}/deals?next=none`,
      tone: "warning",
    });
  }

  const stalled = input.plays.filter((p) => ["proposed", "active", "stalled"].includes(p.status) && p.next_step_due && p.next_step_due < today);
  if (stalled.length) {
    out.push({
      key: "plays",
      text: `${stalled[0]!.title}: next step overdue`,
      detail: stalled.length > 1 ? `${stalled.length - 1} more play${stalled.length === 2 ? "" : "s"} overdue` : (stalled[0]!.next_step ?? undefined),
      action: "Open play",
      href: `${base}/plays/${stalled[0]!.id}`,
      tone: "warning",
    });
  }

  if (input.researchDrafts > 0) {
    out.push({ key: "research", text: `${input.researchDrafts} research note${input.researchDrafts === 1 ? "" : "s"} to review`, action: "Review findings", href: `${base}/research#research-review`, tone: "neutral" });
  }

  // Last: the playbook is the standing plan, and what is late or waiting
  // above it is more urgent than the next tick on it.
  if (input.playbookNext) {
    out.push({ key: "playbook", text: input.playbookNext.text, detail: `Next in the playbook · ${input.playbookNext.step}, ${input.playbookNext.position}`, action: "Playbook", href: `${base}/playbook#lifecycle`, tone: "neutral" });
  }

  return out.slice(0, NEEDS_YOU_MAX);
}

/** Open deal value and count behind each play, from its linked deals. */
export function playDealTotals(plays: Array<{ id: string; deal_ids_json: string }>, deals: Deal[]): Map<string, { usd: number; deals: number }> {
  const byId = new Map(deals.filter((d) => d.status === "open").map((d) => [d.deal_id, d]));
  const out = new Map<string, { usd: number; deals: number }>();
  for (const p of plays) {
    let ids: unknown = [];
    try {
      ids = JSON.parse(p.deal_ids_json);
    } catch {
      ids = [];
    }
    const linked = (Array.isArray(ids) ? ids : []).map((i) => byId.get(String(i))).filter((d): d is Deal => !!d);
    out.set(p.id, { usd: linked.reduce((s, d) => s + (d.tcv_usd ?? 0), 0), deals: linked.length });
  }
  return out;
}
