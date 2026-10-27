import { db, type ActionItemRow, type MeetingRow, type ProposalRow } from "../db";
import { sameName } from "../format";

export function listMeetings(accountId: string): MeetingRow[] {
  return db()
    .prepare(
      // Within a day, by time. This ordered by date alone while the pages
      // reading it had started printing "at 14:30" beside each row, so a day's
      // meetings were visibly out of order on the same screen that showed the
      // time. NULLs sort last under DESC in SQLite, which is what we want:
      // known times first, "some time Thursday" after them.
      `SELECT * FROM meetings WHERE account_id = ? AND archived_at IS NULL
       ORDER BY held_at DESC, held_time DESC, created_at DESC`,
    )
    .all(accountId) as MeetingRow[];
}

// Why a candidate is being offered, strongest signal first.
//
// The distinction matters because a merge cannot be undone and "same day" is
// a weak signal: two genuinely different meetings on one day is the ordinary
// case, not the exception. An option offered on nothing but the date should
// not look like one that shares four attendees.
export type DuplicateReason = "attendees" | "title" | "day";

export type MeetingCandidate = MeetingRow & { reason: DuplicateReason; sharedAttendees: number };

/** The contact ids in an attendee list, for comparing two of them. */
function attendeeIds(json: string | null): Set<string> {
  try {
    const parsed: unknown = JSON.parse(json ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .map((a) => (a && typeof a === "object" ? (a as { contact_id?: unknown }).contact_id : null))
        .filter((id): id is string => typeof id === "string"),
    );
  } catch {
    return new Set();
  }
}

// Live meetings on this account held on the same day as `meetingId`.
//
// A day, not a title: two records of one call are usually both of us writing
// it down, and we will not have called it the same thing. Pre-fills the merge
// control and nothing more — the control is not gated on it, because a person
// knows two rows were the same conversation and no rule here ever will. What
// the rule can do is say how much it actually knows, which is what `reason` is.
export function likelyDuplicateMeetings(accountId: string, meetingId: string): MeetingCandidate[] {
  const self = db().prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId) as MeetingRow | undefined;
  if (!self || self.archived_at || self.merged_into) return [];
  const mine = attendeeIds(self.attendees_json);
  const rows = db()
    .prepare(
      `SELECT * FROM meetings WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL
         AND substr(held_at, 1, 10) = ? AND id != ?
       ORDER BY held_time DESC, created_at DESC`,
    )
    .all(accountId, self.held_at.slice(0, 10), meetingId) as MeetingRow[];

  const RANK: Record<DuplicateReason, number> = { attendees: 0, title: 1, day: 2 };
  return rows
    .map((m) => {
      const shared = [...attendeeIds(m.attendees_json)].filter((id) => mine.has(id)).length;
      const reason: DuplicateReason = shared > 0 ? "attendees" : sameName(m.title, self.title) ? "title" : "day";
      return { ...m, reason, sharedAttendees: shared };
    })
    .sort((x, y) => RANK[x.reason] - RANK[y.reason] || y.sharedAttendees - x.sharedAttendees);
}

// Chronological order, ascending, for the lists that ask "what is next".
//
// A meeting has an optional time, and every caller that sorted by date alone
// tied on a day and took whatever the query happened to return first — so the
// account header could name the five o'clock call while the nine o'clock one
// was next. Undated last, the same rule the rest of the app uses for an
// unknown when.
export function byWhen(a: { held_at: string; held_time?: string | null }, b: { held_at: string; held_time?: string | null }): number {
  const day = a.held_at.slice(0, 10).localeCompare(b.held_at.slice(0, 10));
  if (day !== 0) return day;
  if (!a.held_time && !b.held_time) return 0;
  if (!a.held_time) return 1;
  if (!b.held_time) return -1;
  return a.held_time.localeCompare(b.held_time);
}

// Unfiltered, like getAccount: a direct link to an archived meeting resolves
// so it can be read and restored.
export function getMeeting(id: string): MeetingRow | null {
  return (db().prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as MeetingRow | undefined) ?? null;
}

// The few most recent meetings that already have a summary, for context.
/** Summarised meetings, newest first; merged ones never, and only those held before `before` when given. */
export function recentSummarized(accountId: string, limit: number, excludeId?: string, before?: string): MeetingRow[] {
  return db()
    .prepare(
      `SELECT * FROM meetings
       WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL AND summary IS NOT NULL AND summary <> '' AND id <> COALESCE(?, '')
         AND (? IS NULL OR held_at < ?)
       ORDER BY held_at DESC LIMIT ?`,
    )
    .all(accountId, excludeId ?? null, before ?? null, before ?? null, limit) as MeetingRow[];
}

export function listActionItems(
  accountId: string,
  opts: { status?: "open" | "done"; meetingId?: string; includeArchived?: boolean } = {},
): ActionItemRow[] {
  const where = ["account_id = ?"];
  const args: string[] = [accountId];
  if (!opts.includeArchived) where.push("archived_at IS NULL");
  if (opts.status) {
    where.push("status = ?");
    args.push(opts.status);
  }
  if (opts.meetingId) {
    where.push("meeting_id = ?");
    args.push(opts.meetingId);
  }
  return db()
    .prepare(`SELECT * FROM action_items WHERE ${where.join(" AND ")} ORDER BY status, COALESCE(due, '9999'), created_at`)
    .all(...args) as ActionItemRow[];
}

// Pending proposals produced by one meeting's extraction.
export function listMeetingProposals(meetingId: string): ProposalRow[] {
  return db()
    .prepare(`SELECT * FROM proposals WHERE origin_kind = 'meeting' AND origin_id = ? AND status = 'pending' ORDER BY created_at`)
    .all(meetingId) as ProposalRow[];
}

// Pending only, matching listMeetingProposals above. Without that filter a
// second extraction pointed the "Accept all N" button at a batch that was
// already resolved, while the count beside it came from the pending list.
export function latestMeetingBatchId(meetingId: string): string | null {
  const row = db()
    .prepare(
      `SELECT batch_id FROM proposals WHERE origin_kind = 'meeting' AND origin_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(meetingId) as { batch_id: string } | undefined;
  return row?.batch_id ?? null;
}

// Everything archived on an account, for the restore block.
export function listArchived(accountId: string): {
  deals: Array<{ id: string; label: string }>;
  contacts: Array<{ id: string; label: string }>;
  plays: Array<{ id: string; label: string }>;
  meetings: Array<{ id: string; label: string }>;
  action_items: Array<{ id: string; label: string }>;
} {
  const conn = db();
  const rows = <T>(sql: string) => conn.prepare(sql).all(accountId) as T[];
  return {
    deals: rows<{ id: string; label: string }>(
      // A merged-away deal is not something to restore — it lives on the
      // deal it was merged into, which is where the Archived block would
      // otherwise offer to resurrect half of it.
      `SELECT deal_id AS id, name AS label FROM deals WHERE account_id = ? AND archived_at IS NOT NULL AND merged_into IS NULL ORDER BY name`,
    ),
    contacts: rows(`SELECT id, name AS label FROM contacts WHERE account_id = ? AND archived_at IS NOT NULL AND merged_into IS NULL ORDER BY name`),
    // Same reasoning as the deals above, since 015 gave both of these the same
    // pointer: a merged-away row is a tombstone, not an archived record waiting
    // to come back. Restoring one would return a play whose follow-ups and
    // links now answer to the keeper, or a meeting whose attendees do.
    plays: rows(`SELECT id, title AS label FROM plays WHERE account_id = ? AND archived_at IS NOT NULL AND merged_into IS NULL ORDER BY title`),
    meetings: rows(
      `SELECT id, title || ' (' || substr(held_at, 1, 10) || ')' AS label FROM meetings
       WHERE account_id = ? AND archived_at IS NOT NULL AND merged_into IS NULL ORDER BY held_at DESC`,
    ),
    action_items: rows(`SELECT id, text AS label FROM action_items WHERE account_id = ? AND archived_at IS NOT NULL ORDER BY created_at DESC`),
  };
}

// Everything open, across every account.
//
// Follow-ups lived on one account page each, and Home showed only the overdue
// ones — so "what do I owe this week" had no answer anywhere, and neither did
// "what has Jamie got". `owner` is free text and cannot answer either: a
// follow-up written down by extraction says whatever the notes said, and
// "Jamie" and "Jamie L." are two owners to a query. owner_user_id is the
// one that can be filtered on.
export type OpenFollowUp = ActionItemRow & { account_name: string };

export function listOpenFollowUps(filter: { ownerUserId?: string | null; unowned?: boolean } = {}): OpenFollowUp[] {
  const where = ["i.status = 'open'", "i.archived_at IS NULL", "a.archived_at IS NULL"];
  const args: string[] = [];
  if (filter.unowned) {
    where.push("i.owner_user_id IS NULL");
  } else if (filter.ownerUserId) {
    where.push("i.owner_user_id = ?");
    args.push(filter.ownerUserId);
  }
  return db()
    .prepare(
      `SELECT i.*, a.name AS account_name
       FROM action_items i JOIN accounts a ON a.id = i.account_id
       WHERE ${where.join(" AND ")}
       -- Dated first and soonest first, then the undated ones, which are the
       -- ones nothing else in the app will ever remind you about.
       ORDER BY i.due IS NULL, i.due, i.created_at`,
    )
    .all(...args) as OpenFollowUp[];
}

// Every meeting this person was in.
//
// Attendees live in a JSON blob rather than a join table, so this is the
// reverse of a lookup the app has only ever done forwards: a meeting knows
// who was there, and nobody could ask a person what they had been in.
// json_each is part of SQLite itself, so no extra pass in JS and no LIKE over
// a blob that would match a note mentioning the id.
export function meetingsAttendedBy(contactId: string): MeetingRow[] {
  return db()
    .prepare(
      `SELECT m.* FROM meetings m
       WHERE m.archived_at IS NULL
         AND EXISTS (
           SELECT 1 FROM json_each(COALESCE(m.attendees_json, '[]')) a
           WHERE json_extract(a.value, '$.contact_id') = ?
         )
       ORDER BY m.held_at DESC, m.created_at DESC`,
    )
    .all(contactId) as MeetingRow[];
}
