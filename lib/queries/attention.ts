// What is slipping, across every account. Four queries, each one a thing a
// seller would actually act on; nothing here is a vanity count.
import { db, OWN_WORK_ACCOUNT_ID } from "../db";
import { needsNextStepSql } from "../deals/nextStep";
import { addDays, meetingCutoff, todayISO } from "../clock";
import { currentFiscalQuarter } from "../fiscal";
import { ownerClause, type OwnerScope } from "./owner";
import { listUsers } from "../auth";
import { promiseDirection } from "../promises";
import { otherSideNames } from "./accounts";

export type AttentionKind = "proposals" | "no_next_step" | "overdue" | "due_today" | "no_brief";

export type AttentionItem = {
  kind: AttentionKind;
  accountId: string;
  accountName: string;
  text: string;
  detail: string | null;
  /** Explicit count units; never infer these from presentation text. */
  unit?: "follow-up" | "play";
  count?: number;
  due?: string;
  /** Set when the follow-up is the customer's promise, not our work: who made it. */
  promisedBy?: string;
  /** For a deal with no next step: its id, so it can be acknowledged in place. */
  dealId?: string;
  href: string;
};

export const ATTENTION_LABELS: Record<AttentionKind, string> = {
  proposals: "Waiting for your review",
  no_next_step: "Closing this quarter with no next step",
  overdue: "Past due",
  due_today: "Due today",
  no_brief: "Meeting soon, no brief yet",
};

// The user's calendar day, not UTC's.
function isoDay(d: Date): string {
  return todayISO(d);
}

export function listAttention(now = new Date(), scope?: OwnerScope): AttentionItem[] {
  const conn = db();
  // Every one of the five queries below joins accounts and ends its WHERE
  // with the account's own conditions, so whose account it is goes on the end
  // of the clause and its bindings go on the end of the arguments.
  const owner = ownerClause(scope);
  const today = isoDay(now);
  const inAWeek = isoDay(new Date(now.getTime() + 7 * 86_400_000));
  const cutoff = meetingCutoff(now);
  const fq = currentFiscalQuarter(now).label;
  const out: AttentionItem[] = [];

  for (const r of conn
    .prepare(
      `SELECT a.id, a.name, COUNT(*) AS n FROM proposals p JOIN accounts a ON a.id = p.account_id
       WHERE p.status = 'pending' AND a.archived_at IS NULL${owner.sql} GROUP BY a.id ORDER BY a.name COLLATE NOCASE`,
    )
    .all(...owner.args) as Array<{ id: string; name: string; n: number }>) {
    out.push({
      kind: "proposals",
      count: r.n,
      accountId: r.id,
      accountName: r.name,
      text: `${r.n} proposed change${r.n === 1 ? "" : "s"}`,
      detail: null,
      href: `/inbox?kind=changes&account=${r.id}`,
    });
  }

  for (const r of conn
    .prepare(
      `SELECT d.deal_id, d.name AS deal_name, d.tcv_usd, a.id AS account_id, a.name AS account_name
       FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE d.status = 'open' AND d.archived_at IS NULL AND a.archived_at IS NULL
         AND d.fiscal_quarter = ? AND ${needsNextStepSql("d")}${owner.sql}
       ORDER BY COALESCE(d.tcv_usd, 0) DESC`,
    )
    .all(fq, todayISO(now), ...owner.args) as Array<{ deal_id: string; deal_name: string; tcv_usd: number | null; account_id: string; account_name: string }>) {
    out.push({
      kind: "no_next_step",
      dealId: r.deal_id,
      accountId: r.account_id,
      accountName: r.account_name,
      text: r.deal_name,
      detail: r.tcv_usd ? `$${Math.round(r.tcv_usd).toLocaleString("en-US")} · closes ${fq}` : `closes ${fq}`,
      href: `/accounts/${r.account_id}/deals/${encodeURIComponent(r.deal_id)}`,
    });
  }

  out.push(...listDueWork(now, scope, false));

  for (const r of conn
    .prepare(
      // Not yet over, and ordered by time within the day — the same rule
      // upcomingMeetings uses, because this is the same question.
      //
      // It used to be `held_at >= today` with no notion of a time, so at four
      // in the afternoon this asked you to prepare a brief for a call that had
      // ended at ten, while the section below it on the same screen asked for
      // that call's notes. Only meetingsAwaitingNotes was taught that a
      // meeting has a time; this and upcomingMeetings were not.
      `SELECT m.id, m.title, m.held_at, m.held_time, a.id AS account_id, a.name AS account_name
       FROM meetings m JOIN accounts a ON a.id = m.account_id
       WHERE m.brief_json IS NULL AND m.archived_at IS NULL AND a.archived_at IS NULL
         AND m.held_at >= ? AND m.held_at <= ?
         AND NOT (m.held_at < ? OR (m.held_at = ? AND m.held_time IS NOT NULL AND m.held_time <= ?))${owner.sql}
       ORDER BY m.held_at, m.held_time IS NULL, m.held_time`,
    )
    .all(today, inAWeek, cutoff.day, cutoff.day, cutoff.time, ...owner.args) as Array<{
    id: string;
    title: string;
    held_at: string;
    held_time: string | null;
    account_id: string;
    account_name: string;
  }>) {
    out.push({
      kind: "no_brief",
      accountId: r.account_id,
      accountName: r.account_name,
      text: r.title,
      detail: r.held_at.slice(0, 10),
      href: `/accounts/${r.account_id}/meetings/${r.id}`,
    });
  }

  return out;
}

export function groupAttention(items: AttentionItem[]): Array<{ kind: AttentionKind; label: string; items: AttentionItem[] }> {
  const order: AttentionKind[] = ["proposals", "overdue", "no_brief", "no_next_step"];
  return order
    .map((kind) => ({ kind, label: ATTENTION_LABELS[kind], items: items.filter((i) => i.kind === kind) }))
    .filter((g) => g.items.length > 0);
}

// Separate calendar-day read: listAttention retains its strict past-due contract.
export function listDueToday(now = new Date(), scope?: OwnerScope): AttentionItem[] {
  return listDueWork(now, scope, true);
}

function listDueWork(now: Date, scope: OwnerScope | undefined, dueToday: boolean): AttentionItem[] {
  const conn = db(), owner = ownerClause(scope), today = isoDay(now);
  const out: AttentionItem[] = [];
  // A promise the customer made stays on the list — late, it is the one
  // nobody on our side would otherwise chase — but says it is theirs.
  const ours = ourNames(), theirNames = otherSideNames();
  for (const r of conn
    .prepare(
      `SELECT i.id, i.text, i.due, i.owner, i.owner_user_id, a.id AS account_id, a.name AS account_name
       FROM action_items i JOIN accounts a ON a.id = i.account_id
       WHERE i.status = 'open' AND i.archived_at IS NULL AND a.archived_at IS NULL
         AND i.due IS NOT NULL AND i.due ${dueToday ? '=' : '<'} ?${owner.sql} ORDER BY i.due`,
    )
    .all(today, ...owner.args) as Array<{ id: string; text: string; due: string; owner: string | null; owner_user_id: string | null; account_id: string; account_name: string }>) {
    const promisedBy = promisedByCustomer(r, ours, theirNames.get(r.account_id));
    out.push({
      kind: dueToday ? "due_today" : "overdue",
      accountId: r.account_id,
      accountName: r.account_name,
      text: r.text,
      unit: "follow-up",
      due: r.due,
      ...(promisedBy ? { promisedBy } : {}),
      detail: `due ${r.due}${promisedBy ? ` · ${promisedBy} promised this` : r.owner ? ` · ${r.owner}` : ""}`,
      // Own work has no deals, plays or meetings, so its account page is a
      // row of empty sections. A todo that is not about a customer belongs on
      // the list of todos instead — which is also where it can be edited.
      href: r.account_id === OWN_WORK_ACCOUNT_ID ? `/follow-ups?who=${encodeURIComponent(r.owner_user_id ?? "unowned")}#action-${r.id}` : `/follow-ups/${r.id}`,
    });
  }

  for (const r of conn
    .prepare(
      `SELECT p.id, p.title, p.next_step, p.next_step_due, a.id AS account_id, a.name AS account_name
       FROM plays p JOIN accounts a ON a.id = p.account_id
       WHERE p.status IN ('proposed','active','stalled') AND p.archived_at IS NULL AND a.archived_at IS NULL
         AND p.next_step_due IS NOT NULL AND p.next_step_due ${dueToday ? '=' : '<'} ?${owner.sql}
       ORDER BY p.next_step_due`,
    )
    .all(today, ...owner.args) as Array<{ id: string; title: string; next_step: string | null; next_step_due: string; account_id: string; account_name: string }>) {
    out.push({
      kind: dueToday ? "due_today" : "overdue",
      accountId: r.account_id,
      accountName: r.account_name,
      unit: "play",
      due: r.next_step_due,
      text: r.next_step ? `${r.title}: ${r.next_step}` : r.title,
      detail: `due ${r.next_step_due}`,
      href: `/accounts/${r.account_id}/plays/${r.id}`,
    });
  }

  return out;
}

// Follow-ups that slipped long enough ago to have stopped being today's
// problem. Today counts them in one line; /follow-ups/sort walks them one at a
// time. Oldest first, because the oldest are the ones most likely to be
// let go, and clearing those first is what makes the pile feel smaller.
export type BacklogItem = {
  id: string;
  accountId: string;
  accountName: string;
  text: string;
  due: string;
  owner: string | null;
  ownerUserId: string | null;
  /** Who made it, when this is the customer's promise rather than our work. */
  promisedBy: string | null;
  /** The row version, sent back with a new date so a stale card cannot overwrite a newer edit. */
  version: number;
};

export const BACKLOG_LIMIT = 200;

export function listBacklog(now = new Date(), scope?: OwnerScope, olderThanDays = 7): { items: BacklogItem[]; total: number } {
  const owner = ownerClause(scope);
  // The same arithmetic Today uses (lib/today.ts), so the count on Today and
  // the length of this list agree.
  const cutoff = addDays(isoDay(now), -olderThanDays);
  const where = `FROM action_items i JOIN accounts a ON a.id = i.account_id
       WHERE i.status = 'open' AND i.archived_at IS NULL AND a.archived_at IS NULL
         AND i.due IS NOT NULL AND i.due < ?${owner.sql}`;
  const total = (db().prepare(`SELECT COUNT(*) AS n ${where}`).get(cutoff, ...owner.args) as { n: number }).n;
  const rows = db()
    .prepare(
      `SELECT i.id, i.text, i.due, i.owner, i.owner_user_id, i.updated_at, a.id AS account_id, a.name AS account_name ${where}
       ORDER BY i.due, a.name COLLATE NOCASE, i.id LIMIT ?`,
    )
    .all(cutoff, ...owner.args, BACKLOG_LIMIT) as Array<{
    id: string;
    text: string;
    due: string;
    owner: string | null;
    owner_user_id: string | null;
    updated_at: number;
    account_id: string;
    account_name: string;
  }>;
  const ours = ourNames(), theirNames = otherSideNames();
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      accountName: r.account_name,
      text: r.text,
      due: r.due,
      owner: r.owner,
      ownerUserId: r.owner_user_id,
      promisedBy: promisedByCustomer(r, ours, theirNames.get(r.account_id)),
      version: r.updated_at,
    })),
  };
}

function ourNames(): Array<{ name: string }> {
  return listUsers().map((u) => ({ name: u.display_name }));
}

function promisedByCustomer(r: { owner: string | null; owner_user_id: string | null }, ours: ReadonlyArray<{ name: string }>, theirs: readonly string[] = []): string | null {
  return promiseDirection({ owner: r.owner, ownerUserId: r.owner_user_id }, ours, theirs) === "theirs" ? r.owner : null;
}
