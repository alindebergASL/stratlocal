// What /calendar puts in front of you, and the one write it makes: turning an
// event into a meeting when a person says so. Matching is code (match.ts);
// adding is always a tap.
import { db, OWN_WORK_ACCOUNT_ID, type CalendarEventRow, type MeetingRow } from "../db";
import { addDays, todayISO } from "../clock";
import { listUsers } from "../auth";
import { applyEntityChange, archiveEntity } from "../proposals/apply";
import { domainOf } from "./match";
import type { CalPerson } from "./types";

/** How far back and ahead the review offers events as meetings. */
export const OFFER_BACK_DAYS = 7;
export const OFFER_AHEAD_DAYS = 14;

export type ReviewEvent = {
  id: string;
  title: string;
  day: string;
  time: string | null;
  allDay: boolean;
  accountId: string | null;
  accountName: string | null;
  reason: string | null;
  attendees: CalPerson[];
  /** The people from outside: the ones worth naming on the page. */
  outsiders: CalPerson[];
  outside: number;
};

export type ChangedEvent = ReviewEvent & { meetingId: string; meetingTitle: string; meetingDay: string; meetingTime: string | null; meetingVersion: number; what: "moved" | "cancelled" | "gone"; signature: string };
export type TimeOff = { userId: string; userName: string; from: string; to: string };

type Row = CalendarEventRow & { account_name: string | null; account_live: number | null };

function people(json: string): CalPerson[] {
  try {
    return JSON.parse(json) as CalPerson[];
  } catch {
    return [];
  }
}

function internalDomains(): Set<string> {
  const set = new Set<string>();
  for (const u of listUsers()) if (u.email?.includes("@")) set.add(domainOf(u.email));
  for (const d of (process.env.INTERNAL_EMAIL_DOMAINS ?? "").split(",")) if (d.trim()) set.add(d.trim().toLowerCase());
  return set;
}

function view(r: Row, internal: Set<string>): ReviewEvent {
  const attendees = people(r.attendees_json);
  return {
    id: r.id,
    title: r.title,
    day: r.day,
    time: r.time,
    allDay: !!r.all_day,
    accountId: r.account_live ? r.account_id : null,
    accountName: r.account_live ? r.account_name : null,
    reason: r.match_reason,
    attendees,
    outsiders: attendees.filter((p) => !internal.has(domainOf(p.email))),
    outside: attendees.filter((p) => !internal.has(domainOf(p.email))).length,
  };
}

const SELECT = `SELECT e.*, a.name AS account_name, CASE WHEN a.id IS NOT NULL AND a.archived_at IS NULL AND a.id != '${OWN_WORK_ACCOUNT_ID}' THEN 1 ELSE 0 END AS account_live
  FROM calendar_events e JOIN calendar_sources s ON s.id = e.source_id AND s.archived_at IS NULL
  LEFT JOIN accounts a ON a.id = e.account_id`;

export function signatureOf(e: Pick<CalendarEventRow, "day" | "time" | "cancelled" | "removed_at">): string {
  return `${e.day}|${e.time ?? ""}|${e.cancelled || e.removed_at ? "x" : ""}`;
}

export function calendarReview(today = todayISO()) {
  const from = addDays(today, -OFFER_BACK_DAYS);
  const to = addDays(today, OFFER_AHEAD_DAYS);
  const internal = internalDomains();
  const open = db()
    .prepare(`${SELECT} WHERE e.decision IS NULL AND e.time_off = 0 AND e.internal = 0 AND e.cancelled = 0 AND e.removed_at IS NULL AND e.day >= ? AND e.day <= ? ORDER BY e.day, e.time IS NULL, e.time, e.title LIMIT 200`)
    .all(from, to) as Row[];
  const views = open.map((r) => view(r, internal));
  const toAdd = views.filter((v) => v.accountId);
  const questions = views.filter((v) => !v.accountId);

  const added = db()
    .prepare(
      `${SELECT} JOIN meetings m ON m.id = e.meeting_id AND m.archived_at IS NULL AND m.merged_into IS NULL
       WHERE e.decision = 'added' AND (e.day >= ? OR m.held_at >= ?) LIMIT 200`,
    )
    .all(today, today) as Row[];
  const meetings = new Map(
    (added.length ? (db().prepare(`SELECT * FROM meetings WHERE id IN (${added.map(() => "?").join(",")})`).all(...added.map((r) => r.meeting_id)) as MeetingRow[]) : []).map((m) => [m.id, m]),
  );
  const changed: ChangedEvent[] = [];
  for (const r of added) {
    const m = meetings.get(r.meeting_id!);
    if (!m) continue;
    const signature = signatureOf(r);
    if (r.ack_signature === signature) continue;
    const gone = !!r.cancelled || !!r.removed_at;
    const moved = m.held_at.slice(0, 10) !== r.day || (!!r.time && (m.held_time ?? null) !== r.time);
    if (!gone && !moved) continue;
    // An invite marked cancelled was cancelled. One that only left the weeks
    // the app reads may have been cancelled or moved further out: the app
    // cannot see which, so it does not say.
    const what = r.cancelled ? "cancelled" : gone ? "gone" : "moved";
    changed.push({ ...view(r, internal), meetingId: m.id, meetingTitle: m.title, meetingDay: m.held_at.slice(0, 10), meetingTime: m.held_time ?? null, meetingVersion: m.updated_at, what, signature });
  }

  const offRows = db()
    .prepare(
      `SELECT e.day, e.end_day, s.owner_user_id FROM calendar_events e JOIN calendar_sources s ON s.id = e.source_id AND s.archived_at IS NULL
       WHERE e.time_off = 1 AND e.cancelled = 0 AND e.removed_at IS NULL AND e.end_day >= ? AND e.day <= ? AND s.owner_user_id IS NOT NULL
       ORDER BY s.owner_user_id, e.day`,
    )
    .all(today, addDays(today, 30)) as Array<{ day: string; end_day: string; owner_user_id: string }>;
  const names = new Map(listUsers({ includeInactive: true }).map((u) => [u.id, u.display_name]));
  const timeOff: TimeOff[] = [];
  for (const r of offRows) {
    const last = timeOff[timeOff.length - 1];
    // Back-to-back or overlapping days off are one stretch.
    if (last && last.userId === r.owner_user_id && r.day <= addDays(last.to, 1)) {
      if (r.end_day > last.to) last.to = r.end_day;
    } else timeOff.push({ userId: r.owner_user_id, userName: names.get(r.owner_user_id) ?? "Someone", from: r.day, to: r.end_day });
  }

  const internalCount = (db()
    .prepare(`SELECT COUNT(*) AS n FROM calendar_events e JOIN calendar_sources s ON s.id = e.source_id AND s.archived_at IS NULL WHERE e.internal = 1 AND e.removed_at IS NULL AND e.cancelled = 0 AND e.day >= ? AND e.day <= ?`)
    .get(from, to) as { n: number }).n;

  return { toAdd, questions, changed, timeOff, internalCount, window: { from, to } };
}

// ---- the write: a person adds events as meetings --------------------------

export class CalendarActionError extends Error {}

// The meeting's attendees: the people from outside, as contacts where the
// address is one, by name otherwise. Our own side is not listed, as on a
// meeting typed by hand.
function attendeesFor(accountId: string, invited: CalPerson[]) {
  const internal = internalDomains();
  const contacts = db().prepare(`SELECT id, name, email FROM contacts WHERE account_id = ? AND archived_at IS NULL`).all(accountId) as Array<{ id: string; name: string; email: string | null }>;
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c]));
  return invited
    .filter((p) => !internal.has(domainOf(p.email)))
    .slice(0, 40)
    .map((p) => {
      const c = byEmail.get(p.email);
      return { contact_id: c?.id ?? null, name: (c?.name ?? p.name ?? p.email).slice(0, 200), note: null };
    });
}

// A meeting already on the account that day with the same title, or at the
// same time, is the same meeting: link to it instead of making a second.
function existingMeeting(accountId: string, day: string, title: string, time: string | null): MeetingRow | null {
  const rows = db()
    .prepare(`SELECT * FROM meetings WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL AND substr(held_at, 1, 10) = ?`)
    .all(accountId, day) as MeetingRow[];
  const t = title.trim().toLowerCase();
  return rows.find((m) => m.title.trim().toLowerCase() === t) ?? rows.find((m) => !!time && m.held_time === time) ?? null;
}

export type AddResult = { created: number; linked: number };

export function addEventsAsMeetings(eventIds: string[], userId: string, chosenAccountId?: string): AddResult {
  const result: AddResult = { created: 0, linked: 0 };
  db().transaction(() => {
    for (const id of eventIds.slice(0, 100)) {
      const e = db().prepare(`SELECT * FROM calendar_events WHERE id = ?`).get(id) as CalendarEventRow | undefined;
      if (!e) throw new CalendarActionError("That event is no longer in the calendar.");
      if (e.decision) throw new CalendarActionError(`"${e.title}" was already ${e.decision}.`);
      if (e.cancelled || e.removed_at) throw new CalendarActionError(`"${e.title}" was cancelled in the calendar.`);
      const accountId = chosenAccountId ?? e.account_id;
      if (!accountId) throw new CalendarActionError(`Choose an account for "${e.title}".`);
      const account = db().prepare(`SELECT id, archived_at FROM accounts WHERE id = ?`).get(accountId) as { id: string; archived_at: string | null } | undefined;
      if (!account || account.archived_at || account.id === OWN_WORK_ACCOUNT_ID) throw new CalendarActionError("That account is missing or archived.");
      const found = existingMeeting(accountId, e.day, e.title, e.time);
      let meetingId: string;
      if (found) {
        meetingId = found.id;
        result.linked += 1;
      } else {
        meetingId = applyEntityChange({
          accountId,
          entityType: "meeting",
          op: "create",
          payload: { title: e.title.slice(0, 200), held_at: e.day, held_time: e.time, attendees: attendeesFor(accountId, people(e.attendees_json)) },
          actorUserId: userId,
        }).entityId;
        result.created += 1;
      }
      const reason = chosenAccountId && chosenAccountId !== e.account_id ? "you chose the account" : e.match_reason;
      db()
        .prepare(`UPDATE calendar_events SET decision = 'added', meeting_id = ?, account_id = ?, match_reason = ?, decided_by = ?, decided_at = ? WHERE id = ? AND decision IS NULL`)
        .run(meetingId, accountId, reason, userId, Date.now(), id);
    }
  })();
  return result;
}

export function ignoreEvents(eventIds: string[], userId: string): number {
  const stmt = db().prepare(`UPDATE calendar_events SET decision = 'ignored', decided_by = ?, decided_at = ? WHERE id = ? AND decision IS NULL`);
  let n = 0;
  db().transaction(() => {
    for (const id of eventIds.slice(0, 200)) n += stmt.run(userId, Date.now(), id).changes;
  })();
  return n;
}

/** "Keep the meeting as it is": not asked again until the invite changes again. */
export function acknowledgeChange(eventId: string, signature: string) {
  db().prepare(`UPDATE calendar_events SET ack_signature = ? WHERE id = ? AND decision = 'added'`).run(signature, eventId);
}

// What the page showed: the meeting's version and the invite's state. Move and
// Archive act on exactly that, or not at all — a meeting someone edited, or an
// invite that changed again, since the page loaded is the person's to look at
// afresh.
export type ShownChange = { meetingVersion: number; signature: string };

function shownChange(eventId: string, shown: ShownChange): { e: CalendarEventRow; m: MeetingRow } {
  const e = db().prepare(`SELECT * FROM calendar_events WHERE id = ?`).get(eventId) as CalendarEventRow | undefined;
  if (!e || e.decision !== "added" || !e.meeting_id) throw new CalendarActionError("That event is not linked to a meeting.");
  const m = db().prepare(`SELECT * FROM meetings WHERE id = ?`).get(e.meeting_id) as MeetingRow | undefined;
  if (!m || m.archived_at) throw new CalendarActionError("That meeting is archived.");
  if (signatureOf(e) !== shown.signature) throw new CalendarActionError("The invite changed again since the page loaded. Look at it afresh.");
  if (m.updated_at !== shown.meetingVersion) throw new CalendarActionError("Someone changed this meeting since the page loaded. Reload to see what is there now.");
  return { e, m };
}

export function archiveMeetingForEvent(eventId: string, userId: string, shown: ShownChange) {
  const { e, m } = shownChange(eventId, shown);
  archiveEntity({ accountId: m.account_id, entityType: "meeting", entityId: m.id, actorUserId: userId });
  acknowledgeChange(eventId, signatureOf(e));
  return m;
}

/** Move the meeting to where its invite now is, version-checked like any edit. */
export function moveMeetingToEvent(eventId: string, userId: string, shown: ShownChange) {
  const { e, m } = shownChange(eventId, shown);
  applyEntityChange({
    accountId: m.account_id,
    entityType: "meeting",
    op: "update",
    entityId: m.id,
    payload: { held_at: e.day, held_time: e.time },
    baseVersion: shown.meetingVersion,
    actorUserId: userId,
  });
  acknowledgeChange(eventId, signatureOf(e));
  return m;
}
