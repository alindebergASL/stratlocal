// What today looks like, across every account.
//
// Home used to be an account table with an attention list above it. The first
// question on a Monday morning is not "which accounts do I have", it is "what
// is happening today and what moved while I was away", so that is what this
// answers. Everything here is a thing a person would act on.
import { db } from "../db";
import { needsNextStepSql } from "../deals/nextStep";
import { dayOf, meetingCutoff, nowHHMM, todayISO } from "../clock";
import { currentFiscalQuarter } from "../fiscal";
import { ownerClause, type OwnerScope } from "./owner";

export type UpcomingMeeting = {
  id: string;
  title: string;
  heldAt: string;
  /** "HH:MM", or null when nobody said what time. */
  heldTime: string | null;
  /** Started, and not yet past the point where we assume it has ended. */
  inProgress: boolean;
  accountId: string;
  accountName: string;
  hasBrief: boolean;
  hasNotes: boolean;
  attendees: number;
  href: string;
};

// One accepted batch is one thing that happened, not twenty-eight. An import
// used to produce a row per record and drown everything a person did by hand,
// which is the half of this list that is actually worth reading.
export type RecentChange =
  | {
      kind: "batch";
      accountId: string;
      accountName: string;
      batchId: string;
      origin: "import" | "meeting" | "plan_draft" | string;
      records: number;
      fields: number;
      at: number;
      actors: string[];
    }
  | {
      kind: "edit";
      accountId: string;
      accountName: string;
      entityType: string;
      entityId: string;
      /** Which fields moved, and what they moved from and to. */
      changes: FieldChange[];
      at: number;
      // Everyone who touched this record on this day, the most recent first.
      // More than one name is the only place the app says out loud that two
      // people edited the same thing — see lib/proposals/apply.ts, which now
      // refuses the second save when the fields actually overlap.
      actors: string[];
    };

// One field's move. `from`/`to` are the raw change_log values — JSON, read
// back with logValueText — or null for a value too long to carry, which the
// page renders as a size the way history already renders meeting notes.
export type FieldChange = { field: string; from: string | null; to: string | null; fromBytes: number; toBytes: number };

// Past this, a value is reported as a size rather than carried.
//
// /activity renders up to 200 rows and reads up to RAW_EDIT_ROWS raw ones, so
// carrying whole values is a real cost: deals.notes alone holds 4000
// characters. Bounding it in SQL rather than after the read means the bytes
// never enter the process. 300 is well past anything a diff line shows.
const VALUE_CHARS = 300;

const ORIGIN_LABEL: Record<string, string> = {
  import: "Report import",
  meeting: "Meeting notes",
  plan_draft: "Drafted plan",
  ask: "Ask",
};

export function originLabel(origin: string): string {
  return ORIGIN_LABEL[origin] ?? origin.replace(/_/g, " ");
}

// The user's calendar day, not UTC's.
function isoDay(d: Date): string {
  return todayISO(d);
}

// Meetings from now forward. A meeting that already has a brief stays on this
// list: the brief is the thing you are trying to reach before the call, and
// the attention list used to drop it the moment it existed.
//
// "From now", not "from today". A meeting drops off this list once it is over
// — MEETING_RUNS_FOR_MINUTES after its start — and that is the same instant
// meetingsAwaitingNotes picks it up, so the two lists on Home partition the
// day rather than overlapping in it. During the hour it is running it stays
// here, which is right: what you want on a phone at five past nine is the
// brief, not a prompt for the notes.
export function upcomingMeetings(now = new Date(), days = 7, scope?: OwnerScope): UpcomingMeeting[] {
  const cutoff = meetingCutoff(now);
  const owner = ownerClause(scope);
  const today = isoDay(now);
  const clock = nowHHMM(now);
  const rows = db()
    .prepare(
      `SELECT m.id, m.title, m.held_at, m.held_time, m.brief_json, m.raw_notes, m.attendees_json, a.id AS account_id, a.name AS account_name
       FROM meetings m JOIN accounts a ON a.id = m.account_id
       WHERE m.archived_at IS NULL AND a.archived_at IS NULL AND m.held_at >= ? AND m.held_at <= ?
         -- Not already over. The negation of the condition in
         -- meetingsAwaitingNotes, written out rather than shared, because
         -- SQLite has no place to put a shared predicate and the two being
         -- literally each other's inverse is the property that matters.
         AND NOT (m.held_at < ? OR (m.held_at = ? AND m.held_time IS NOT NULL AND m.held_time <= ?))${owner.sql}
       -- Within a day, by time; the ones nobody gave a time to come last,
       -- which is the same rule listOpenFollowUps uses for an undated item.
       -- This used to fall straight through to the account name, so today's
       -- three calls sorted alphabetically on the page whose whole job is
       -- what happens next.
       ORDER BY m.held_at, m.held_time IS NULL, m.held_time, a.name COLLATE NOCASE`,
    )
    .all(
      isoDay(now),
      isoDay(new Date(now.getTime() + days * 86_400_000)),
      cutoff.day,
      cutoff.day,
      cutoff.time,
      ...owner.args,
    ) as Array<{
    id: string;
    title: string;
    held_at: string;
    held_time: string | null;
    brief_json: string | null;
    raw_notes: string | null;
    attendees_json: string;
    account_id: string;
    account_name: string;
  }>;
  return rows.map((r) => {
    let attendees = 0;
    try {
      const parsed = JSON.parse(r.attendees_json) as unknown;
      attendees = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      attendees = 0;
    }
    return {
      id: r.id,
      title: r.title,
      heldAt: r.held_at.slice(0, 10),
      heldTime: r.held_time,
      // Everything the query returned is not over, so "started" is the whole
      // condition. This is the hour the partition deliberately leaves here
      // rather than in "write the notes", and saying so is the point of
      // leaving it here.
      inProgress: r.held_at.slice(0, 10) === today && r.held_time !== null && r.held_time <= clock,
      accountId: r.account_id,
      accountName: r.account_name,
      hasBrief: r.brief_json !== null,
      hasNotes: (r.raw_notes ?? "").trim().length > 0,
      attendees,
      href: `/accounts/${r.account_id}/meetings/${r.id}`,
    };
  });
}

// Meetings that have just happened and have no notes yet — the thing to do in
// the car park, and otherwise the thing that gets forgotten.
export function meetingsAwaitingNotes(now = new Date(), days = 7, scope?: OwnerScope): UpcomingMeeting[] {
  const cutoff = meetingCutoff(now);
  const owner = ownerClause(scope);
  const rows = db()
    .prepare(
      `SELECT m.id, m.title, m.held_at, m.held_time, m.brief_json, m.attendees_json, a.id AS account_id, a.name AS account_name
       FROM meetings m JOIN accounts a ON a.id = m.account_id
       WHERE m.archived_at IS NULL AND a.archived_at IS NULL
         AND (m.held_at < ? OR (m.held_at = ? AND m.held_time IS NOT NULL AND m.held_time <= ?))
         AND m.held_at >= ?
         AND (m.raw_notes IS NULL OR TRIM(m.raw_notes) = '')${owner.sql}
       -- Today counts once the meeting is over. It used to be held_at < today
       -- flat, so the prompt to write notes arrived the following morning
       -- rather than in the ten minutes after the call, which is when the
       -- notes exist and the app's own stated case for a phone. Then it
       -- counted from the *start* time, which asked for the notes while you
       -- were still in the room — and left the meeting on "Coming up" at the
       -- same time, because only this query had learned that a meeting has
       -- one. It is the cutoff now, on both sides.
       ORDER BY m.held_at DESC, m.held_time DESC`,
    )
    .all(cutoff.day, cutoff.day, cutoff.time, isoDay(new Date(now.getTime() - days * 86_400_000)), ...owner.args) as Array<{
    id: string;
    title: string;
    held_at: string;
    held_time: string | null;
    brief_json: string | null;
    attendees_json: string;
    account_id: string;
    account_name: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    heldAt: r.held_at.slice(0, 10),
    heldTime: r.held_time,
    // Everything in this list is over by definition.
    inProgress: false,
    accountId: r.account_id,
    accountName: r.account_name,
    hasBrief: r.brief_json !== null,
    hasNotes: false,
    attendees: 0,
    href: `/accounts/${r.account_id}/meetings/${r.id}`,
  }));
}

// What moved recently. Changes that came from accepting a proposal collapse
// to one row per batch — the batch is the thing the person decided on, and a
// twenty-eight-row import used to push every hand edit off the list. Changes
// someone typed keep a row each, because each of those really was a separate
// decision.
// How many raw change_log rows the hand-edit half of the feed will read.
//
// Hand edits cannot be grouped in SQL, because the group has to include the
// calendar day and the calendar day is in APP_TIMEZONE — no fixed offset
// survives a DST boundary inside a thirty-day window. So the rows come back
// ungrouped and bounded, and the fold happens below. Two people's hand edits
// over a month do not come near this, and an accepted import never reaches
// this branch at all (`proposal_id IS NULL`). If it is ever hit, the oldest
// day is truncated, which is what any limit does.
const RAW_EDIT_ROWS = 2000;

export function recentChanges(sinceMs: number, limit = 12, accountId?: string | null, scope?: OwnerScope): RecentChange[] {
  const conn = db();
  // The account filter is the shape idx_change_log_account was built for, and
  // nothing had that shape until now.
  const only = accountId ? " AND c.account_id = ?" : "";
  const owner = ownerClause(scope);
  const args = (n: number) => [sinceMs, ...(accountId ? [accountId] : []), ...owner.args, n];
  const batches = conn
    .prepare(
      // A batch is one decision at one moment, so grouping it whole is right —
      // unlike the hand edits below. The actor list is DISTINCT rather than
      // MAX: MAX on a uuid picks whichever id sorts higher, which is neither
      // the first nor the last person, and a batch decided by both of them
      // should say so.
      `SELECT p.batch_id, CASE WHEN p.origin_id LIKE 'ask:%' THEN 'ask' WHEN p.origin_id = 'salesforce' THEN 'salesforce' WHEN p.origin_id = 'playbook_refresh' THEN 'quarterly_refresh' WHEN p.origin_id LIKE 'playbook_%' THEN 'playbook' ELSE p.origin_kind END AS origin_kind, a.id AS account_id, a.name AS account_name,
              COUNT(*) AS fields,
              COUNT(DISTINCT c.entity_type || ':' || c.entity_id) AS records,
              MAX(c.created_at) AS at,
              GROUP_CONCAT(DISTINCT c.actor_user_id) AS actors
       FROM change_log c
       JOIN proposals p ON p.id = c.proposal_id
       JOIN accounts a ON a.id = c.account_id
       WHERE c.created_at >= ?${only} AND a.archived_at IS NULL${owner.sql}
       GROUP BY p.batch_id
       ORDER BY at DESC LIMIT ?`,
    )
    .all(...args(limit)) as Array<{
    batch_id: string;
    origin_kind: string;
    account_id: string;
    account_name: string;
    fields: number;
    records: number;
    at: number;
    actors: string | null;
  }>;

  const rows = conn
    .prepare(
      // old_value and new_value, which this deliberately did not select — so
      // the page built to answer "what did my partner do while I was away"
      // said *"close_date, tcv_usd"* and never whether he pulled a $1K deal
      // into this quarter or pushed it out. change_log has held both in full
      // fidelity since Phase 1 and nothing had ever read them.
      //
      // Long values are replaced by their size in the query rather than after
      // it: CAST to BLOB so length() counts bytes, which is the unit
      // sizeMarker prints and the unit history already uses for notes.
      `SELECT c.entity_type, c.entity_id, c.field, c.created_at, c.actor_user_id,
              CASE WHEN length(c.old_value) > ${VALUE_CHARS} THEN NULL ELSE c.old_value END AS old_value,
              CASE WHEN length(c.new_value) > ${VALUE_CHARS} THEN NULL ELSE c.new_value END AS new_value,
              length(CAST(c.old_value AS BLOB)) AS old_bytes,
              length(CAST(c.new_value AS BLOB)) AS new_bytes,
              a.id AS account_id, a.name AS account_name
       FROM change_log c JOIN accounts a ON a.id = c.account_id
       WHERE c.created_at >= ?${only} AND c.proposal_id IS NULL AND a.archived_at IS NULL${owner.sql}
       ORDER BY c.created_at DESC, c.rowid DESC LIMIT ?`,
    )
    .all(...args(RAW_EDIT_ROWS)) as Array<{
    entity_type: string;
    entity_id: string;
    field: string;
    created_at: number;
    actor_user_id: string | null;
    old_value: string | null;
    new_value: string | null;
    old_bytes: number | null;
    new_bytes: number | null;
    account_id: string;
    account_name: string;
  }>;

  // One row per record per day. The day is part of the key on purpose: this
  // used to group on the record alone, across the whole window, so a deal
  // edited on the 1st and again on the 28th collapsed into a single row dated
  // the 28th — and on a page that renders its rows under day headings, the
  // edit from the 1st did not move, it disappeared.
  type Edit = Extract<RecentChange, { kind: "edit" }>;
  const edits = new Map<string, Edit>();
  for (const r of rows) {
    // Rows arrive newest first, so the first one seen for a key is the newest:
    // it stamps the group and leads the actor list.
    const key = `${r.entity_type}\u0000${r.entity_id}\u0000${dayOf(r.created_at)}`;
    const group = edits.get(key);
    if (!group) {
      edits.set(key, {
        kind: "edit",
        accountId: r.account_id,
        accountName: r.account_name,
        entityType: r.entity_type,
        entityId: r.entity_id,
        changes: [change(r)],
        at: r.created_at,
        actors: r.actor_user_id ? [r.actor_user_id] : [],
      });
      continue;
    }
    // A field edited twice in one day is one line, from where it started that
    // day to where it ended: rows arrive newest first, so the entry already
    // there holds the newer `to` and this older row holds the truer `from`.
    const seen = group.changes.find((c) => c.field === r.field);
    if (seen) {
      seen.from = r.old_value;
      seen.fromBytes = r.old_bytes ?? 0;
    } else {
      group.changes.push(change(r));
    }
    if (r.actor_user_id && !group.actors.includes(r.actor_user_id)) group.actors.push(r.actor_user_id);
  }

  const all: RecentChange[] = [
    ...batches.map(
      (r): RecentChange => ({
        kind: "batch",
        accountId: r.account_id,
        accountName: r.account_name,
        batchId: r.batch_id,
        origin: r.origin_kind,
        records: r.records,
        fields: r.fields,
        at: r.at,
        actors: (r.actors ?? "").split(",").filter(Boolean),
      }),
    ),
    ...edits.values(),
  ];
  return all.sort((a, b) => b.at - a.at).slice(0, limit);
}

function change(r: {
  field: string;
  old_value: string | null;
  new_value: string | null;
  old_bytes: number | null;
  new_bytes: number | null;
}): FieldChange {
  return { field: r.field, from: r.old_value, to: r.new_value, fromBytes: r.old_bytes ?? 0, toBytes: r.new_bytes ?? 0 };
}

export type DayCounts = { meetingsToday: number; pendingProposals: number; overdue: number; noNextStep: number };

export function dayCounts(now = new Date(), scope?: OwnerScope): DayCounts {
  const conn = db();
  const today = isoDay(now);
  const fq = currentFiscalQuarter(now).label;
  const owner = ownerClause(scope);
  // Every count here already joins accounts, so the owner clause is the last
  // thing in the WHERE and its bindings are the last arguments.
  const one = (sql: string, ...args: unknown[]) =>
    (conn.prepare(sql + owner.sql).get(...args, ...owner.args) as { n: number }).n;
  return {
    meetingsToday: one(
      `SELECT COUNT(*) AS n FROM meetings m JOIN accounts a ON a.id = m.account_id
       WHERE m.archived_at IS NULL AND a.archived_at IS NULL AND m.held_at = ?`,
      today,
    ),
    pendingProposals: one(
      `SELECT COUNT(*) AS n FROM proposals p JOIN accounts a ON a.id = p.account_id
       WHERE p.status = 'pending' AND a.archived_at IS NULL`,
    ),
    overdue: one(
      `SELECT COUNT(*) AS n FROM action_items i JOIN accounts a ON a.id = i.account_id
       WHERE i.status = 'open' AND i.archived_at IS NULL AND a.archived_at IS NULL AND i.due IS NOT NULL AND i.due < ?`,
      today,
    ),
    noNextStep: one(
      `SELECT COUNT(*) AS n FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE d.status = 'open' AND d.archived_at IS NULL AND a.archived_at IS NULL
         AND d.fiscal_quarter = ? AND ${needsNextStepSql("d")}`,
      fq,
      today,
    ),
  };
}

// What the other one of you wrote down recently, as a count rather than a
// feed. Today says "Jamie changed 5 things on 2 accounts" and links to
// /activity, which is the page that says what each one was. A digest at the
// edge of the page, not a stream in the middle of it.
export type PartnerDigest = { actorId: string; actorName: string; records: number; accounts: Array<{ id: string; name: string }>; latestAt: number };

export function partnerDigest(now = new Date(), me: string, scope?: OwnerScope, hours = 24): PartnerDigest[] {
  const owner = ownerClause(scope);
  const rows = db()
    .prepare(
      `SELECT c.actor_user_id AS actor_id, u.display_name AS actor_name, a.id AS account_id, a.name AS account_name,
              COUNT(DISTINCT c.entity_type || ':' || c.entity_id) AS records, MAX(c.created_at) AS latest
       FROM change_log c JOIN accounts a ON a.id = c.account_id JOIN users u ON u.id = c.actor_user_id
       WHERE c.actor_user_id IS NOT NULL AND c.actor_user_id <> ? AND c.created_at >= ? AND a.archived_at IS NULL${owner.sql}
       GROUP BY c.actor_user_id, a.id
       ORDER BY latest DESC`,
    )
    .all(me, now.getTime() - hours * 3_600_000, ...owner.args) as Array<{
    actor_id: string;
    actor_name: string;
    account_id: string;
    account_name: string;
    records: number;
    latest: number;
  }>;
  const byActor = new Map<string, PartnerDigest>();
  for (const r of rows) {
    const d = byActor.get(r.actor_id) ?? { actorId: r.actor_id, actorName: r.actor_name, records: 0, accounts: [], latestAt: r.latest };
    d.records += r.records;
    d.accounts.push({ id: r.account_id, name: r.account_name });
    d.latestAt = Math.max(d.latestAt, r.latest);
    byActor.set(r.actor_id, d);
  }
  return [...byActor.values()];
}

// What you finished today: follow-ups you marked done and proposals you
// decided. Read from history, so it counts what happened rather than what a
// screen remembers, and it is yours alone — the other person's work is theirs
// to be pleased about.
export function clearedToday(now = new Date(), me: string): number {
  const today = isoDay(now);
  // A day and a half back covers every timezone's midnight; the calendar day
  // is then decided in code, by the one clock (DECISIONS #12).
  const since = now.getTime() - 36 * 3_600_000;
  const done = db()
    .prepare(
      `SELECT entity_id, MAX(created_at) AS at FROM change_log
       WHERE entity_type = 'action_item' AND field = 'status' AND new_value = '"done"' AND actor_user_id = ? AND created_at >= ?
       GROUP BY entity_id`,
    )
    .all(me, since) as Array<{ entity_id: string; at: number }>;
  const decided = db()
    .prepare(`SELECT decided_at AS at FROM proposals WHERE decided_by = ? AND decided_at >= ? AND status IN ('accepted', 'rejected')`)
    .all(me, since) as Array<{ at: number }>;
  return [...done, ...decided].filter((r) => dayOf(r.at) === today).length;
}
