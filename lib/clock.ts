// What day is it?
//
// Every "today" in this app used to be `new Date().toISOString().slice(0, 10)`,
// which is the UTC day. For someone on US Pacific that means the app believes
// it is already tomorrow from 5pm: the date under "Today" is wrong, that
// evening's meeting drops out of what is coming up, a follow-up due today
// flips to overdue, and an import stamps tomorrow onto its snapshot.
//
// Dates are stored as plain YYYY-MM-DD calendar days, which is right and does
// not change. Only the question "which day is now" was wrong, and it is
// answered here, once.

const DEFAULT_ZONE = "America/Los_Angeles";

// Building an Intl.DateTimeFormat is expensive — about 0.2ms — and this app
// built one per call, twice: once here to validate the zone and once to do the
// formatting. `dayOf` runs once per change_log row, so at a year of use Home
// spent 250ms of a 287ms render constructing formatters, against 2-6ms for
// every SQL query behind the page. Measured: 2,000 calls went from 415ms to
// 14.6ms once the objects were reused.
//
// Keyed on the locale and the option shape, because both vary: "en-CA" for the
// stored YYYY-MM-DD shape, "en-GB" for what a person reads. The set of shapes
// is fixed by the callers below and by lib/format.ts, and the timezone comes
// from one environment variable, so this cannot grow unboundedly.
const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

// Deliberately not memoised, unlike the formatters it builds. APP_TIMEZONE is
// read on every call because tests change it mid-process and expect the answer
// to follow — and because a cached answer would outlive a restart-free config
// change in a way nothing would explain. The expensive half was never the env
// read; it was the object.
export function appTimeZone(): string {
  const raw = (process.env.APP_TIMEZONE ?? "").trim();
  if (!raw) return DEFAULT_ZONE;
  // A bad zone would throw on every render, which is a worse failure than
  // quietly using the default and saying so once.
  try {
    formatter("en-CA", { timeZone: raw });
    return raw;
  } catch {
    console.warn(`[clock] APP_TIMEZONE="${raw}" is not a known timezone; using ${DEFAULT_ZONE}`);
    return DEFAULT_ZONE;
  }
}

// "en-CA" formats as YYYY-MM-DD, which is exactly the shape everything stores.
export function todayISO(now: Date = new Date(), timeZone: string = appTimeZone()): string {
  return formatter("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Is this a real calendar day, and not merely date-shaped?
 *
 * `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-13-45`, which is what the report
 * import checked — and `as_of` is what orders the install-base snapshots, so a
 * value that is not a day sorts into that order forever. `Date.UTC` happily
 * rolls February the 31st into March, so the round trip is the check.
 *
 * Lives here rather than beside its caller because `readDate` in
 * lib/sheet/readDeals.ts already needed exactly this and wrote its own; two
 * copies of a validation rule is how the two disagree, which this round has
 * already paid for once with email addresses.
 */
export function isRealDay(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Whole calendar days from a to b. Both are YYYY-MM-DD, so this is exact:
// there is no hour arithmetic to get wrong across a daylight-saving change.
export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// The calendar day an epoch timestamp fell on, in the app's timezone.
export function dayOf(ms: number, timeZone: string = appTimeZone()): string {
  return todayISO(new Date(ms), timeZone);
}

// The time of day, now, in the app's timezone — "HH:MM", 24-hour, which is
// exactly what meetings.held_time holds so the two compare as strings.
//
// This is what lets "happened, no notes yet" fire in the hour after a call
// rather than the following morning. hourCycle "h23" is named rather than
// implied by a locale: the value is compared as a string against stored
// "HH:MM", so it has to be zero-padded 00-23 whatever locale is in play, and
// leaving that to "en-GB" happening to agree is the kind of thing that holds
// until it does not.
export function nowHHMM(now: Date = new Date(), timeZone: string = appTimeZone()): string {
  return formatter("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

// How long a meeting is assumed to run.
//
// A meeting has a start time and no duration, and it needs one, because two
// separate questions are asked about the same row: "what is coming up" and
// "what has happened and has no notes yet". With only a start time the two
// answers were both wrong at once — for one phase a nine o'clock call was in
// *both* lists on Home at noon, one of them asking for a brief and the other
// for the notes, because `meetingsAwaitingNotes` learned about the time and
// `upcomingMeetings` never did.
//
// An hour is the assumption, and it is deliberately not configurable: the
// point is that the two lists agree, not that the boundary is precise. It also
// fixes the thing the old cut got wrong in the other direction — cutting at
// the *start* time meant a nine o'clock call asked for its notes at 09:01,
// while you were still in it.
export const MEETING_RUNS_FOR_MINUTES = 60;

// The instant before which a meeting counts as finished, as the day and clock
// time its stored columns are compared against.
//
// Returned as a pair rather than a single "HH:MM" because of midnight: at
// 00:30 the cutoff is 23:30 *yesterday*, and comparing today's meetings
// against a bare "23:30" would call every one of them already over. Both
// halves are needed, and the SQL on either side of this reads:
//
//   over:     held_at < day OR (held_at = day AND held_time IS NOT NULL AND held_time <= time)
//   not over: NOT (the above)
export function meetingCutoff(now: Date = new Date()): { day: string; time: string } {
  const at = new Date(now.getTime() - MEETING_RUNS_FOR_MINUTES * 60_000);
  return { day: todayISO(at), time: nowHHMM(at) };
}

export function todayParts(now: Date = new Date()): { year: number; month: number; day: number } {
  const iso = todayISO(now);
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) };
}

// The long date under the page title, in the app's timezone.
export function todayLabel(now: Date = new Date(), timeZone: string = appTimeZone()): string {
  return formatter("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(now);
}
