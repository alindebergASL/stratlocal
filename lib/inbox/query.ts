// Everything waiting on a decision, from every place it used to wait
// (DECISIONS #97): proposed changes on every account, research drafts to
// keep, Plan keeper's and Promise keeper's questions, and calendar events
// that need an account. Read from each source as it is, never copied, so the
// Inbox cannot drift from the place a decision is actually recorded; each
// decision still goes through that source's own function.
import { db } from "../db";
import { todayISO } from "../clock";
import { isLowRisk } from "../changeDeck";
import { toProposalViews } from "../proposals/view";
import { listPendingProposals } from "../queries/accounts";
import { openPlanQuestions } from "../assistants/planKeeper";
import { openNotices } from "../assistants/promiseKeeper";
import { calendarReview } from "../calendar/review";
import { listSources } from "../calendar/sync";
import { snoozedKeys } from "./snooze";
import { displayOrigin } from "../proposals/origin";

function draftsWaiting(me: string): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM outbound_drafts WHERE user_id = ? AND status IN ('draft','failed','unknown')`).get(me) as { n: number }).n;
}

export type InboxKind = "send" | "changes" | "research" | "plan" | "promise" | "calendar";
export const INBOX_KINDS: InboxKind[] = ["send", "changes", "research", "plan", "promise", "calendar"];

export type AccountChanges = { accountId: string; accountName: string; total: number; quick: number; sources: string[] };
export type ResearchDraft = { accountId: string; accountName: string; noteId: string; title: string; findings: number };

export type InboxSummary = {
  changes: AccountChanges[];
  research: ResearchDraft[];
  plan: number;
  promise: number;
  calendar: number;
  /** Drafts waiting for this person to send or discard (DECISIONS #103). */
  send: number;
  total: number;
  /** Put off until a later day, by this person: not listed or counted. */
  snoozed: Array<{ key: string; label: string; until: string }>;
};

const ORIGIN_LABEL: Record<string, string> = { import: "a report", meeting: "meeting notes", plan_draft: "a drafted plan", mail: "email", ask: "Ask" };

export function inboxSummary(me: string, today = todayISO()): InboxSummary {
  const conn = db();
  const off = snoozedKeys(me, today);
  const snoozed: InboxSummary["snoozed"] = [];
  const accounts = conn
    .prepare(
      `SELECT a.id, a.name, COUNT(p.id) AS n FROM proposals p JOIN accounts a ON a.id = p.account_id
       WHERE p.status = 'pending' AND a.archived_at IS NULL GROUP BY a.id ORDER BY MAX(p.created_at) DESC`,
    )
    .all() as Array<{ id: string; name: string; n: number }>;
  const changes = accounts.flatMap((a) => {
    const until = off.get(`changes:${a.id}`);
    if (until) {
      snoozed.push({ key: `changes:${a.id}`, label: `${a.name}: ${a.n} change${a.n === 1 ? "" : "s"}`, until });
      return [];
    }
    const rows = listPendingProposals(a.id);
    const views = toProposalViews(a.id, rows);
    return [{
      accountId: a.id,
      accountName: a.name,
      total: rows.length,
      quick: views.filter(isLowRisk).length,
      sources: [...new Set(rows.map((r) => ORIGIN_LABEL[displayOrigin(r)] ?? ORIGIN_LABEL[r.origin_kind] ?? "a suggestion"))],
    }];
  });
  const research = (
    conn
      .prepare(
        `SELECT d.id AS noteId, d.account_id AS accountId, a.name AS accountName, d.meta_json AS meta FROM documents d JOIN accounts a ON a.id = d.account_id
         WHERE d.kind = 'research_note' AND d.status = 'draft' AND d.archived_at IS NULL AND a.archived_at IS NULL ORDER BY d.created_at DESC`,
      )
      .all() as Array<{ noteId: string; accountId: string; accountName: string; meta: string | null }>
  ).map((r) => {
    let title = "Research to review";
    let findings = 0;
    try {
      const m = JSON.parse(r.meta ?? "{}") as { title?: string; findings?: unknown[] };
      title = typeof m.title === "string" ? m.title : title;
      findings = Array.isArray(m.findings) ? m.findings.length : 0;
    } catch {
      // A note whose metadata cannot be read is still listed, to be opened.
    }
    return { noteId: r.noteId, accountId: r.accountId, accountName: r.accountName, title, findings };
  }).filter((r) => {
    const until = off.get(`research:${r.noteId}`);
    if (until) snoozed.push({ key: `research:${r.noteId}`, label: `${r.accountName}: ${r.title}`, until });
    return !until;
  });
  const plan = openPlanQuestions(me, { everyone: true, today }).length;
  const promise = openNotices(me, today, { everyone: true }).filter((n) => n.kind === "question").length;
  const review = listSources().length ? calendarReview(today) : null;
  const calendar = review ? review.questions.length + review.toAdd.length : 0;
  const send = draftsWaiting(me);
  const total = changes.reduce((s, c) => s + c.total, 0) + research.length + plan + promise + calendar + send;
  return { changes, research, plan, promise, calendar, send, total, snoozed };
}

/** How many decisions wait, for the badge in the navigation: counts only. */
export function inboxCount(me: string, today = todayISO()): number {
  const conn = db();
  const off = snoozedKeys(me, today);
  const perAccount = conn
    .prepare(`SELECT p.account_id AS id, COUNT(*) AS n FROM proposals p JOIN accounts a ON a.id = p.account_id WHERE p.status = 'pending' AND a.archived_at IS NULL GROUP BY p.account_id`)
    .all() as Array<{ id: string; n: number }>;
  const proposals = perAccount.filter((a) => !off.has(`changes:${a.id}`)).reduce((s, a) => s + a.n, 0);
  const drafts = (
    conn
      .prepare(`SELECT d.id FROM documents d JOIN accounts a ON a.id = d.account_id WHERE d.kind = 'research_note' AND d.status = 'draft' AND d.archived_at IS NULL AND a.archived_at IS NULL`)
      .all() as Array<{ id: string }>
  ).filter((d) => !off.has(`research:${d.id}`)).length;
  const plan = openPlanQuestions(me, { everyone: true, today }).length;
  const promise = openNotices(me, today, { everyone: true }).filter((n) => n.kind === "question").length;
  const review = listSources().length ? calendarReview(today) : null;
  return proposals + drafts + plan + promise + (review ? review.questions.length + review.toAdd.length : 0) + draftsWaiting(me);
}
