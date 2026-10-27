// Cover while someone is away: everything of theirs that falls in the time
// off, read by code from what is on file (DECISIONS #27). Nothing here
// writes; handing a follow-up over is a person's tap on /handoff.
//
// "Theirs" is the follow-ups they own, and on the accounts they own (or
// share — DECISIONS #26), the meetings in the window, what customers
// promised for it, and the plays whose next step falls in it.
import { db, OWN_WORK_ACCOUNT_ID } from "../db";
import { addDays, todayISO } from "../clock";
import { listUsers } from "../auth";
import { promiseDirection } from "../promises";
import { otherSideNames } from "../queries/accounts";

// `from` is clamped to today, because what fell in days already gone is not
// for the cover to hand over. `first` is the stretch's real first day, the
// same on every day of it, so a draft made before or during the absence is
// found again rather than paid for once a day.
export type CoverWindow = { from: string; to: string; first?: string };

export type CoverFollowUp = { id: string; accountId: string; accountName: string; text: string; due: string | null; version: number; late: boolean };
export type CoverMeeting = { id: string; accountId: string; accountName: string; title: string; day: string; time: string | null; hasBrief: boolean };
export type CoverPromise = { id: string; accountId: string; accountName: string; text: string; owner: string; due: string };
export type CoverPlay = { id: string; accountId: string; accountName: string; title: string; nextStep: string; due: string };

export type Cover = {
  userId: string;
  userName: string;
  partner: { id: string; name: string } | null;
  window: CoverWindow;
  followUps: CoverFollowUp[];
  meetings: CoverMeeting[];
  promises: CoverPromise[];
  plays: CoverPlay[];
};

/** The next stretch of time off on this person's own calendar, if one starts within `withinDays`. */
export function nextTimeOff(userId: string, today = todayISO(), withinDays = 30): CoverWindow | null {
  const rows = db()
    .prepare(
      `SELECT e.day, e.end_day FROM calendar_events e JOIN calendar_sources s ON s.id = e.source_id AND s.archived_at IS NULL
       WHERE s.owner_user_id = ? AND e.time_off = 1 AND e.cancelled = 0 AND e.removed_at IS NULL AND e.end_day >= ? AND e.day <= ?
       ORDER BY e.day`,
    )
    .all(userId, today, addDays(today, withinDays)) as Array<{ day: string; end_day: string }>;
  if (rows.length === 0) return null;
  // Back-to-back days off are one stretch.
  const window: CoverWindow = { from: rows[0]!.day < today ? today : rows[0]!.day, to: rows[0]!.end_day, first: rows[0]!.day };
  for (const r of rows.slice(1)) {
    if (r.day <= addDays(window.to, 1)) window.to = r.end_day > window.to ? r.end_day : window.to;
    else break;
  }
  return window;
}

// Who covers: the person chosen, or with exactly two of you the other one.
// In a bigger team nobody is assumed; the page asks.
export function coverOptions(userId: string): Array<{ id: string; name: string }> {
  return listUsers().filter((u) => u.id !== userId).map((u) => ({ id: u.id, name: u.display_name }));
}

export function buildCover(userId: string, window: CoverWindow, today = todayISO(), coveredBy: string | null = null): Cover {
  const users = listUsers(), theirNames = otherSideNames();
  const me = users.find((u) => u.id === userId);
  const others = users.filter((u) => u.id !== userId);
  const partner = others.find((u) => u.id === coveredBy) ?? (others.length === 1 ? others[0]! : null);
  // Accounts that are theirs: owned by them, or by nobody (both of us).
  const mine = `(a.owner_user_id = @user OR a.owner_user_id IS NULL)`;

  const followUps = (
    db()
      .prepare(
        `SELECT ai.id, ai.account_id, a.name AS account_name, ai.text, ai.due, ai.updated_at FROM action_items ai JOIN accounts a ON a.id = ai.account_id
         WHERE ai.owner_user_id = @user AND ai.status = 'open' AND ai.archived_at IS NULL AND a.archived_at IS NULL AND ai.due IS NOT NULL AND ai.due <= @to
         ORDER BY ai.due, a.name LIMIT 100`,
      )
      .all({ user: userId, to: window.to }) as Array<{ id: string; account_id: string; account_name: string; text: string; due: string; updated_at: number }>
  ).map((r) => ({ id: r.id, accountId: r.account_id, accountName: r.account_id === OWN_WORK_ACCOUNT_ID ? "Own work" : r.account_name, text: r.text, due: r.due, version: r.updated_at, late: r.due < today }));

  const meetings = (
    db()
      .prepare(
        `SELECT m.id, m.account_id, a.name AS account_name, m.title, m.held_at, m.held_time, m.brief_json IS NOT NULL AS has_brief
         FROM meetings m JOIN accounts a ON a.id = m.account_id
         WHERE m.archived_at IS NULL AND m.merged_into IS NULL AND a.archived_at IS NULL AND a.id != @own AND ${mine}
           AND m.held_at >= @from AND m.held_at <= @to
         ORDER BY m.held_at, m.held_time IS NULL, m.held_time LIMIT 50`,
      )
      .all({ user: userId, own: OWN_WORK_ACCOUNT_ID, from: window.from, to: window.to }) as Array<{ id: string; account_id: string; account_name: string; title: string; held_at: string; held_time: string | null; has_brief: number }>
  ).map((m) => ({ id: m.id, accountId: m.account_id, accountName: m.account_name, title: m.title, day: m.held_at.slice(0, 10), time: m.held_time, hasBrief: !!m.has_brief }));

  const promises = (
    db()
      .prepare(
        `SELECT ai.id, ai.account_id, a.name AS account_name, ai.text, ai.owner, ai.owner_user_id, ai.due FROM action_items ai JOIN accounts a ON a.id = ai.account_id
         WHERE ai.status = 'open' AND ai.archived_at IS NULL AND a.archived_at IS NULL AND a.id != @own AND ${mine}
           AND ai.owner_user_id IS NULL AND ai.owner IS NOT NULL AND ai.due >= @from AND ai.due <= @to
         ORDER BY ai.due LIMIT 50`,
      )
      .all({ user: userId, own: OWN_WORK_ACCOUNT_ID, from: window.from, to: window.to }) as Array<{ id: string; account_id: string; account_name: string; text: string; owner: string; owner_user_id: string | null; due: string }>
  )
    .filter((r) => promiseDirection({ owner: r.owner, ownerUserId: r.owner_user_id }, users.map((u) => ({ name: u.display_name })), theirNames.get(r.account_id)) === "theirs")
    .map((r) => ({ id: r.id, accountId: r.account_id, accountName: r.account_name, text: r.text, owner: r.owner, due: r.due }));

  const plays = (
    db()
      .prepare(
        `SELECT p.id, p.account_id, a.name AS account_name, p.title, p.next_step, p.next_step_due FROM plays p JOIN accounts a ON a.id = p.account_id
         WHERE p.archived_at IS NULL AND p.merged_into IS NULL AND a.archived_at IS NULL AND a.id != @own AND ${mine}
           AND p.status IN ('proposed','active') AND p.next_step IS NOT NULL AND p.next_step_due >= @from AND p.next_step_due <= @to
         ORDER BY p.next_step_due LIMIT 50`,
      )
      .all({ user: userId, own: OWN_WORK_ACCOUNT_ID, from: window.from, to: window.to }) as Array<{ id: string; account_id: string; account_name: string; title: string; next_step: string; next_step_due: string }>
  ).map((p) => ({ id: p.id, accountId: p.account_id, accountName: p.account_name, title: p.title, nextStep: p.next_step, due: p.next_step_due }));

  return { userId, userName: me?.display_name ?? "Someone", partner: partner ? { id: partner.id, name: partner.display_name } : null, window, followUps, meetings, promises, plays };
}

export function coverSize(c: Cover): number {
  return c.followUps.length + c.meetings.length + c.promises.length + c.plays.length;
}
