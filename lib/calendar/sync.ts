// Reading each calendar into calendar_events, and keeping its push channel
// alive. Called by the scheduler every fifteen minutes, by a provider's hook
// when something changed, and by Sync now. Nothing here writes a meeting:
// that is a person's tap on /calendar.
import { randomBytes } from "node:crypto";
import { db, OWN_WORK_ACCOUNT_ID, type CalendarSourceRow } from "../db";
import { newId } from "../ids";
import { addDays, todayISO } from "../clock";
import { listUsers } from "../auth";
import { buildIndex, domainOf, isTimeOff, matchEvent } from "./match";
import { graphConfigured, googleConfigured, provider, type SourceConfig, type SourceKind } from "./providers";
import { normaliseFeedUrl } from "./fetchSafe";
import type { CalEvent, SyncWindow } from "./types";

export const SYNC_EVERY_MS = 15 * 60_000;
export const WINDOW_BACK_DAYS = 7;
export const WINDOW_AHEAD_DAYS = 30;
/** A watch is renewed when it has less than this left. */
export const RENEW_BEFORE_MS = 24 * 3600_000;
/** A hook within this long of the last read does not cause another. */
const HOOK_QUIET_MS = 20_000;

export function calendarWindow(today = todayISO()): SyncWindow {
  return { from: addDays(today, -WINDOW_BACK_DAYS), to: addDays(today, WINDOW_AHEAD_DAYS) };
}

export function readConfig(s: Pick<CalendarSourceRow, "config_json">): SourceConfig {
  try {
    return JSON.parse(s.config_json) as SourceConfig;
  } catch {
    return {};
  }
}

export function listSources(opts: { includeArchived?: boolean } = {}): CalendarSourceRow[] {
  return db()
    .prepare(`SELECT * FROM calendar_sources ${opts.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY created_at`)
    .all() as CalendarSourceRow[];
}

export function getSource(id: string): CalendarSourceRow | null {
  return (db().prepare(`SELECT * FROM calendar_sources WHERE id = ?`).get(id) as CalendarSourceRow | undefined) ?? null;
}

/** Where providers call us, or null when the box has no public name to give them. */
export function hookUrl(sourceId: string): string | null {
  const base = (process.env.CALENDAR_HOOK_BASE ?? "").trim() || ((process.env.APP_HOSTNAME ?? "").trim() ? `https://${process.env.APP_HOSTNAME!.trim()}` : "");
  return base ? `${base.replace(/\/$/, "")}/api/calendar/hook/${sourceId}` : null;
}

// Our own side: the users' domains, any listed in the environment, and the
// mailbox Strategy reads.
function internalDomains(sources: CalendarSourceRow[]): Set<string> {
  const set = new Set<string>();
  for (const u of listUsers()) if (u.email?.includes("@")) set.add(domainOf(u.email));
  for (const d of (process.env.INTERNAL_EMAIL_DOMAINS ?? "").split(",")) if (d.trim()) set.add(d.trim().toLowerCase());
  for (const s of sources) {
    const m = readConfig(s).mailbox;
    if (m?.includes("@")) set.add(domainOf(m));
  }
  return set;
}

export function matchIndex() {
  const accounts = db().prepare(`SELECT id, name FROM accounts WHERE archived_at IS NULL AND id != ?`).all(OWN_WORK_ACCOUNT_ID) as Array<{ id: string; name: string }>;
  const contacts = db()
    .prepare(`SELECT account_id AS accountId, email, name FROM contacts WHERE archived_at IS NULL AND email IS NOT NULL AND email != ''`)
    .all() as Array<{ accountId: string; email: string; name: string }>;
  return buildIndex({ contacts, accounts, internalDomains: internalDomains(listSources()) });
}

/** For a "Which account?" question: the accounts the invite half-points at, if any. */
export function suggestAccounts(attendees: CalEvent["attendees"], organizer: CalEvent["organizer"] = null): string[] {
  const m = matchEvent({ attendees, organizer }, matchIndex());
  return m.kind === "question" ? m.candidates : m.kind === "account" ? [m.accountId] : [];
}

export type SyncResult = { seen: number; added: number; removed: number; skipped: number };

// Writes what a read saw. Pure of the network, so tests drive it directly.
export function storeEvents(source: CalendarSourceRow, events: CalEvent[], window: SyncWindow, now = Date.now()): Omit<SyncResult, "skipped"> {
  const index = matchIndex();
  const owner = source.owner_user_id ? listUsers().find((u) => u.id === source.owner_user_id) : null;
  const own = [readConfig(source).mailbox, owner?.email].filter((x): x is string => !!x);
  const existing = new Map(
    (db().prepare(`SELECT id, event_key FROM calendar_events WHERE source_id = ? AND day >= ? AND day <= ?`).all(source.id, window.from, window.to) as Array<{ id: string; event_key: string }>).map((r) => [r.event_key, r.id]),
  );
  const upsert = db().prepare(`
    INSERT INTO calendar_events (id, source_id, event_key, title, day, time, end_day, all_day, organizer_json, attendees_json, busy, cancelled, time_off, internal, account_id, match_reason, first_seen_at, updated_at)
    VALUES (@id, @source_id, @event_key, @title, @day, @time, @end_day, @all_day, @organizer_json, @attendees_json, @busy, @cancelled, @time_off, @internal, @account_id, @match_reason, @now, @now)
    ON CONFLICT(source_id, event_key) DO UPDATE SET
      title = excluded.title, day = excluded.day, time = excluded.time, end_day = excluded.end_day, all_day = excluded.all_day,
      organizer_json = excluded.organizer_json, attendees_json = excluded.attendees_json, busy = excluded.busy,
      cancelled = excluded.cancelled, time_off = excluded.time_off, internal = excluded.internal,
      -- A person's choice of account stands; until there is one, the match follows the invite.
      account_id = CASE WHEN calendar_events.decision IS NULL THEN excluded.account_id ELSE calendar_events.account_id END,
      match_reason = CASE WHEN calendar_events.decision IS NULL THEN excluded.match_reason ELSE calendar_events.match_reason END,
      removed_at = NULL, updated_at = excluded.updated_at`);
  let added = 0;
  const seen = new Set<string>();
  db().transaction(() => {
    for (const e of events) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      const off = !!source.owner_user_id && isTimeOff(e);
      const m = off ? null : matchEvent(e, index, own);
      if (!existing.has(e.key)) added += 1;
      upsert.run({
        id: newId(),
        source_id: source.id,
        event_key: e.key,
        title: e.title.slice(0, 300),
        day: e.day,
        time: e.time,
        end_day: e.endDay,
        all_day: e.allDay ? 1 : 0,
        organizer_json: e.organizer ? JSON.stringify(e.organizer) : null,
        attendees_json: JSON.stringify(e.attendees.slice(0, 100)),
        busy: e.busy,
        cancelled: e.cancelled ? 1 : 0,
        time_off: off ? 1 : 0,
        internal: m?.kind === "internal" ? 1 : 0,
        account_id: m?.kind === "account" ? m.accountId : null,
        match_reason: m && m.kind !== "internal" ? m.reason : null,
        now,
      });
    }
  })();
  // Gone from the window: kept, and marked, so an added meeting can say so.
  const gone = [...existing].filter(([key]) => !seen.has(key)).map(([, id]) => id);
  const mark = db().prepare(`UPDATE calendar_events SET removed_at = ? WHERE id = ? AND removed_at IS NULL`);
  let removed = 0;
  for (const id of gone) removed += mark.run(now, id).changes;
  return { seen: seen.size, added, removed };
}

const inFlight = new Map<string, Promise<SyncResult>>();

export function syncSource(id: string): Promise<SyncResult> {
  const running = inFlight.get(id);
  if (running) return running;
  const job = (async () => {
    const source = getSource(id);
    if (!source || source.archived_at) throw new Error("That calendar is not connected.");
    const window = calendarWindow();
    try {
      const { events, skipped } = await provider(source.kind).read(readConfig(source), window);
      const r = storeEvents(source, events, window);
      db().prepare(`UPDATE calendar_sources SET last_synced_at = ?, last_error = NULL, last_count = ? WHERE id = ?`).run(Date.now(), r.seen, id);
      return { ...r, skipped };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      db().prepare(`UPDATE calendar_sources SET last_synced_at = ?, last_error = ? WHERE id = ?`).run(Date.now(), message.slice(0, 500), id);
      throw e;
    }
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

/** The scheduler's part: read what is due, keep watches alive. Never throws. */
export async function calendarTick(now = Date.now()): Promise<Array<{ source: string; result: string }>> {
  const out: Array<{ source: string; result: string }> = [];
  for (const s of listSources()) {
    if (!s.last_synced_at || now - s.last_synced_at >= SYNC_EVERY_MS) {
      try {
        const r = await syncSource(s.id);
        out.push({ source: s.label, result: `${r.seen} events` });
      } catch (e) {
        out.push({ source: s.label, result: `failed: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    await keepWatch(s, now).catch((e: unknown) => out.push({ source: s.label, result: `push updates: ${e instanceof Error ? e.message : String(e)}` }));
  }
  return out;
}

// Starts a push channel where the provider has one and the box has a public
// name, and renews it before it lapses. Without one, the poll still runs.
export async function keepWatch(s: CalendarSourceRow, now = Date.now()) {
  const p = provider(s.kind);
  const url = hookUrl(s.id);
  if (!p.startWatch || !url) return;
  const secret = s.watch_secret ?? randomBytes(24).toString("hex");
  let watch: { id: string; expiresAt: number } | null = null;
  if (!s.watch_id || !s.watch_expires_at || s.watch_expires_at < now) watch = await p.startWatch(readConfig(s), url, secret);
  else if (s.watch_expires_at - now < RENEW_BEFORE_MS) watch = await p.renewWatch!(readConfig(s), { id: s.watch_id, expiresAt: s.watch_expires_at }, url, secret);
  if (watch) db().prepare(`UPDATE calendar_sources SET watch_id = ?, watch_secret = ?, watch_expires_at = ? WHERE id = ?`).run(watch.id, secret, watch.expiresAt, s.id);
}

// ---- hooks -----------------------------------------------------------------

/** A provider says something changed. Reads again unless it just did. */
export function hookPoke(source: CalendarSourceRow, now = Date.now()): "reading" | "quiet" {
  if (inFlight.has(source.id)) return "quiet";
  if (source.last_synced_at && now - source.last_synced_at < HOOK_QUIET_MS) return "quiet";
  void syncSource(source.id).catch(() => undefined);
  return "reading";
}

// ---- connecting and disconnecting ------------------------------------------

export class SourceError extends Error {}

export function addSource(input: { kind: SourceKind; label: string; ownerUserId: string | null; value: string; userId: string }): CalendarSourceRow {
  const label = input.label.trim().slice(0, 80);
  const value = input.value.trim();
  if (!value) throw new SourceError("Fill in the calendar's address.");
  let config: SourceConfig;
  if (input.kind === "ics") {
    config = { url: normaliseFeedUrl(value).toString() };
  } else if (input.kind === "graph") {
    const problem = graphConfigured();
    if (problem) throw new SourceError(problem);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new SourceError("Give the mailbox's address, like strategy@example.com.");
    config = { mailbox: value.toLowerCase() };
  } else {
    const problem = googleConfigured();
    if (problem) throw new SourceError(problem);
    config = { calendarId: value };
  }
  if (input.ownerUserId && !listUsers().some((u) => u.id === input.ownerUserId)) throw new SourceError("That person is not one of us.");
  const id = newId();
  db()
    .prepare(`INSERT INTO calendar_sources (id, kind, label, owner_user_id, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.kind, label || defaultLabel(input.kind), input.ownerUserId, JSON.stringify(config), input.userId, Date.now());
  return getSource(id)!;
}

function defaultLabel(kind: SourceKind): string {
  return kind === "graph" ? "Strategy's Outlook calendar" : kind === "google" ? "Shared Google calendar" : "Published calendar";
}

export async function disconnectSource(id: string) {
  const s = getSource(id);
  if (!s || s.archived_at) throw new SourceError("That calendar is not connected.");
  db().prepare(`UPDATE calendar_sources SET archived_at = ?, watch_id = NULL, watch_secret = NULL, watch_expires_at = NULL WHERE id = ?`).run(Date.now(), id);
  // Best effort: an orphaned channel expires on its own, and its calls are refused once the secret is gone.
  if (s.watch_id) await provider(s.kind).stopWatch?.(readConfig(s), s.watch_id).catch(() => undefined);
}

/** What a page may show about where a calendar comes from: never the full link. */
export function describeSource(s: CalendarSourceRow): string {
  const c = readConfig(s);
  if (s.kind === "graph") return `Outlook mailbox ${c.mailbox}`;
  if (s.kind === "google") return `Google calendar ${c.calendarId}`;
  try {
    return `iCal link on ${new URL(c.url ?? "").host}`;
  } catch {
    return "iCal link";
  }
}
