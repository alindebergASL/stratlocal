// Wall-clock times in a named zone, to and from instants. Calendars give
// "09:30 in Pacific Standard Time"; the app keeps days and times in its own
// zone (DECISIONS #12), so every event passes through here once.
import { appTimeZone, formatter } from "../clock";

// Outlook writes Windows zone names into its iCal feeds. The common ones,
// mapped to IANA; anything else falls back to the app's zone and says so.
const WINDOWS: Record<string, string> = {
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "Atlantic Standard Time": "America/Halifax",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Canada Central Standard Time": "America/Regina",
  "Mexico Standard Time": "America/Mexico_City",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "SA Pacific Standard Time": "America/Bogota",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "UTC": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Israel Standard Time": "Asia/Jerusalem",
  "Russian Standard Time": "Europe/Moscow",
  "Arabian Standard Time": "Asia/Dubai",
  "India Standard Time": "Asia/Kolkata",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Taipei Standard Time": "Asia/Taipei",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "E. Australia Standard Time": "Australia/Brisbane",
  "W. Australia Standard Time": "Australia/Perth",
  "New Zealand Standard Time": "Pacific/Auckland",
  "South Africa Standard Time": "Africa/Johannesburg",
};

// Building an Intl formatter to test a name is slow, and a feed names the
// same few zones on every line, so each name is tested once.
const validity = new Map<string, boolean>();
function valid(zone: string): boolean {
  const known = validity.get(zone);
  if (known !== undefined) return known;
  let ok = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    ok = false;
  }
  if (validity.size > 1000) validity.clear();
  validity.set(zone, ok);
  return ok;
}

/** An IANA zone for whatever a calendar called it, or null when we cannot tell. */
export function resolveZone(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name.trim().replace(/^"|"$/g, "");
  // Some feeds prefix a path, e.g. "/mozilla.org/20050126_1/America/New_York".
  const tail = clean.match(/([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/)?.[1];
  for (const candidate of [clean, tail]) {
    if (candidate && valid(candidate) && (candidate.includes("/") || candidate === "UTC")) return candidate;
  }
  return WINDOWS[clean] ?? null;
}

// The zone's offset from UTC at an instant, in milliseconds. Asking Intl
// costs tens of microseconds, and a large feed asks thousands of times, so
// each zone's answer is kept per quarter hour of UTC. Offsets are whole
// quarter hours and clocks change on a whole local hour, so a change always
// falls on a quarter-hour boundary and no quarter holds two offsets.
const offsets = new Map<string, number>();
function offsetAt(ms: number, zone: string): number {
  if (zone === "UTC") return 0;
  const key = `${zone}|${Math.floor(ms / 900_000)}`;
  const known = offsets.get(key);
  if (known !== undefined) return known;
  if (offsets.size > 20_000) offsets.clear();
  const off = askOffset(ms, zone);
  offsets.set(key, off);
  return off;
}

function askOffset(ms: number, zone: string): number {
  const parts = formatter("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") === 24 ? 0 : get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

/** The instant a wall-clock time in `zone` names. In a spring-forward gap it lands just after. */
export function wallToInstant(w: Wall, zone: string): number {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const first = guess - offsetAt(guess, zone);
  const second = guess - offsetAt(first, zone);
  return second;
}

/** The app's day and HH:MM for an instant. */
export function appDayTime(ms: number, zone = appTimeZone()): { day: string; time: string } {
  const parts = formatter("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}` };
}

/** The wall clock in `zone` at an instant. */
export function instantToWall(ms: number, zone: string): Wall {
  const off = offsetAt(ms, zone);
  const d = new Date(ms + off);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
