// An iCalendar (RFC 5545) feed, read by code (DECISIONS #27). Enough of the
// format for a work calendar: folded lines, escaped text, time zones (IANA
// and the Windows names Outlook writes), all-day events, cancellations, busy
// status, and recurring meetings — expanded inside the sync window, with
// their exceptions and moved occurrences.
import { appTimeZone } from "../clock";
import type { CalEvent, CalPerson, SyncWindow } from "./types";
import { appDayTime, instantToWall, resolveZone, wallToInstant, type Wall } from "./zones";

export type IcsLine = { name: string; params: Record<string, string>; value: string };

export function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter((l) => l.length > 0);
}

export function parseLine(line: string): IcsLine | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let buf = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(buf);
      buf = "";
    } else buf += ch;
  }
  parts.push(buf);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0]!.toUpperCase(), params, value };
}

export function unescapeText(v: string): string {
  return v.replace(/\\([\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

type Stamp = { kind: "date"; y: number; mo: number; d: number } | { kind: "time"; wall: Wall; zone: string | null; utc: boolean };

export function parseStamp(value: string, params: Record<string, string>): Stamp | null {
  const v = value.trim();
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || params.VALUE === "DATE") {
    const m = date ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { kind: "date", y: +m[1]!, mo: +m[2]!, d: +m[3]! };
  }
  const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!t) return null;
  return {
    kind: "time",
    wall: { y: +t[1]!, mo: +t[2]!, d: +t[3]!, h: +t[4]!, mi: +t[5]!, s: +(t[6] ?? 0) },
    zone: t[7] ? "UTC" : (params.TZID ?? null),
    utc: !!t[7],
  };
}

const iso = (y: number, mo: number, d: number) => `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function shiftDay(day: string, n: number): string {
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function addDaysWall(w: Wall, n: number): Wall {
  const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + n, w.h, w.mi, w.s));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: w.h, mi: w.mi, s: w.s };
}

type Rule = { freq: string; interval: number; count: number | null; until: Stamp | null; byday: Array<{ n: number | null; wd: number }>; bymonthday: number[] };

const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRule(v: string): Rule | "never" | null {
  const kv = Object.fromEntries(v.split(";").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2).map(([k, x]) => [k.toUpperCase(), x]));
  if (!kv.FREQ) return null;
  const rule: Rule = {
    freq: kv.FREQ.toUpperCase(),
    // Past a thousand periods a rule has nothing left in any window, and a
    // number much larger overflows a date.
    interval: Math.min(1000, Math.max(1, Math.floor(Number(kv.INTERVAL ?? 1)) || 1)),
    count: kv.COUNT ? Number(kv.COUNT) : null,
    until: kv.UNTIL ? parseStamp(kv.UNTIL, {}) : null,
    // A month has at most five of any weekday and 31 days: anything past
    // that can never match, and a feed that lists it many times over only
    // costs time. Repeats are dropped for the same reason.
    byday: [
      ...new Map(
        (kv.BYDAY ?? "")
          .split(",")
          .filter(Boolean)
          .map((b) => {
            const m = b.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i);
            return m ? { n: m[1] ? Number(m[1]) : null, wd: WD[m[2]!.toUpperCase()]! } : null;
          })
          .filter((x): x is { n: number | null; wd: number } => !!x && (x.n === null || (x.n !== 0 && Math.abs(x.n) <= 5)))
          .map((x) => [`${x.n}:${x.wd}`, x] as const),
      ).values(),
    ],
    bymonthday: [...new Set((kv.BYMONTHDAY ?? "").split(",").filter(Boolean).map(Number))].filter((d) => Number.isInteger(d) && d !== 0 && Math.abs(d) <= 31),
  };
  // A list given with nothing valid in it names no day at all. Read as absent,
  // it would become "the start day", a meeting nobody set.
  if ((kv.BYDAY && !rule.byday.length) || (kv.BYMONTHDAY && !rule.bymonthday.length)) return "never";
  return rule;
}

const MAX_INSTANCES = 500;
const MAX_STEPS = 5000;
// Across a whole feed, in candidate days: a feed is parsed on the web
// process, so no feed, however it is written, may hold it for long. A work
// calendar's two months need a few thousand; past this, the remaining series
// are skipped and counted.
export const FEED_STEPS = 50_000;
export const MAX_EVENTS = 5000;

const dow = (w: { y: number; mo: number; d: number }) => new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
const daysIn = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

export type StepBudget = { steps: number };

// How many periods of the rule lie wholly before `from`, less one to spare, so
// a series that began years ago starts near the window instead of walking up
// to it (and running out of instances before it arrives). Only for a rule with
// no COUNT, which has to be counted from its first occurrence.
function stepsBefore(start: Wall, rule: Rule, from: { y: number; mo: number; d: number }): number {
  if (rule.count !== null) return 0;
  const days = Math.floor((Date.UTC(from.y, from.mo - 1, from.d) - Date.UTC(start.y, start.mo - 1, start.d)) / 86400000) - 7;
  if (days <= 0) return 0;
  const units =
    rule.freq === "DAILY" ? days
    : rule.freq === "WEEKLY" ? Math.floor(days / 7)
    : rule.freq === "MONTHLY" ? (from.y - start.y) * 12 + (from.mo - start.mo) - 1
    : rule.freq === "YEARLY" ? from.y - start.y - 1
    : 0;
  return Math.max(0, Math.floor(units / rule.interval) - 1);
}

// Occurrence starts as wall clocks, in order, from the first. `stop` says when
// a candidate is past the window, so an open-ended rule ends. `from`, when
// given, is the window's first day; `budget` is shared by every rule in a feed.
export function expandRule(
  start: Wall,
  rule: Rule,
  stop: (w: Wall) => boolean,
  untilOk: (w: Wall) => boolean,
  opts: { from?: { y: number; mo: number; d: number }; budget?: StepBudget } = {},
): Wall[] {
  const out: Wall[] = [];
  const push = (w: Wall) => {
    if (!untilOk(w)) return false;
    out.push(w);
    return !(rule.count !== null && out.length >= rule.count) && out.length < MAX_INSTANCES;
  };
  const cmp = (a: Wall, b: Wall) => Date.UTC(a.y, a.mo - 1, a.d, a.h, a.mi) - Date.UTC(b.y, b.mo - 1, b.d, b.h, b.mi);
  const first = opts.from ? stepsBefore(start, rule, opts.from) : 0;
  for (let step = first; step < first + MAX_STEPS; step++) {
    if (opts.budget && opts.budget.steps <= 0) return out;
    let batch: Wall[] = [];
    if (rule.freq === "DAILY") batch = [addDaysWall(start, step * rule.interval)];
    else if (rule.freq === "WEEKLY") {
      // Weeks start on Monday (WKST default). The week holding DTSTART, then every `interval` weeks.
      const monday = addDaysWall(start, -((dow(start) + 6) % 7) + step * 7 * rule.interval);
      const days = rule.byday.length ? rule.byday.map((b) => b.wd) : [dow(start)];
      batch = [...new Set(days)].map((wd) => addDaysWall(monday, (wd + 6) % 7)).sort(cmp);
    } else if (rule.freq === "MONTHLY") {
      const m0 = start.mo - 1 + step * rule.interval;
      const y = start.y + Math.floor(m0 / 12);
      const mo = (m0 % 12) + 1;
      if (rule.byday.length) {
        const len = daysIn(y, mo), first = dow({ y, mo, d: 1 });
        for (const b of rule.byday) {
          const all: number[] = [];
          for (let d = 1 + ((b.wd - first + 7) % 7); d <= len; d += 7) all.push(d);
          const pick = b.n === null ? all : [b.n > 0 ? all[b.n - 1] : all[all.length + b.n]].filter((x): x is number => x !== undefined);
          for (const d of pick) batch.push({ ...start, y, mo, d });
        }
      } else {
        const days = rule.bymonthday.length ? rule.bymonthday : [start.d];
        for (const md of days) {
          const d = md < 0 ? daysIn(y, mo) + md + 1 : md;
          if (d >= 1 && d <= daysIn(y, mo)) batch.push({ ...start, y, mo, d });
        }
      }
      batch.sort(cmp);
    } else if (rule.freq === "YEARLY") {
      const y = start.y + step * rule.interval;
      if (start.d <= daysIn(y, start.mo)) batch = [{ ...start, y }];
    } else return [start];
    // A step that lists many days costs as many; the budget counts them.
    if (opts.budget) opts.budget.steps -= Math.max(1, batch.length);
    for (const w of batch) {
      // A date past what a Date can hold: nothing later can be read either.
      if (!Number.isFinite(w.y)) return out;
      if (cmp(w, start) < 0) continue;
      if (stop(w)) return out;
      if (!push(w)) return out;
    }
  }
  return out;
}

function people(lines: IcsLine[], name: string): CalPerson[] {
  return lines
    .filter((l) => l.name === name)
    .filter((l) => !/^(ROOM|RESOURCE)$/i.test(l.params.CUTYPE ?? ""))
    .map((l) => ({ email: l.value.replace(/^mailto:/i, "").trim().toLowerCase(), name: l.params.CN ? unescapeText(l.params.CN) : null }))
    .filter((p) => p.email.includes("@"));
}

function busyOf(lines: IcsLine[]): CalEvent["busy"] {
  const ms = lines.find((l) => l.name === "X-MICROSOFT-CDO-BUSYSTATUS")?.value.trim().toUpperCase();
  if (ms === "OOF") return "oof";
  if (ms === "FREE") return "free";
  if (ms === "TENTATIVE") return "tentative";
  if (ms === "BUSY") return "busy";
  const transp = lines.find((l) => l.name === "TRANSP")?.value.trim().toUpperCase();
  return transp === "TRANSPARENT" ? "free" : null;
}

function durationMs(v: string): number | null {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const n = (x?: string) => Number(x ?? 0);
  return (n(m[2]) * 7 * 86400 + n(m[3]) * 86400 + n(m[4]) * 3600 + n(m[5]) * 60 + n(m[6])) * 1000 * (m[1] === "-" ? -1 : 1);
}

type Raw = { lines: IcsLine[] };

function components(text: string): Raw[] {
  const out: Raw[] = [];
  let current: IcsLine[] | null = null;
  let depth = 0;
  for (const raw of unfold(text)) {
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === "BEGIN") {
      if (l.value.toUpperCase() === "VEVENT" && depth === 0) {
        current = [];
        depth = 1;
      } else if (current) depth += 1;
      continue;
    }
    if (l.name === "END") {
      if (current && depth === 1 && l.value.toUpperCase() === "VEVENT") {
        out.push({ lines: current });
        current = null;
        depth = 0;
      } else if (current) depth -= 1;
      continue;
    }
    // Only the event's own properties: an alarm's lines are nested deeper.
    if (current && depth === 1) current.push(l);
  }
  return out;
}

export type IcsResult = { events: CalEvent[]; skipped: number };

// Every occurrence that touches the window, in the app's clock.
export function parseIcs(text: string, window: SyncWindow, zone = appTimeZone()): IcsResult {
  const all = components(text);
  const raws = all.slice(0, MAX_EVENTS);
  const events: CalEvent[] = [];
  let skipped = all.length - raws.length;
  const budget: StepBudget = { steps: FEED_STEPS };
  const [fy, fm, fd] = window.from.split("-").map(Number) as [number, number, number];
  // Moved or cancelled occurrences of a series, by the series uid and the
  // occurrence's original start.
  const overrides = new Map<string, Raw>();
  for (const r of raws) {
    const rid = r.lines.find((l) => l.name === "RECURRENCE-ID");
    const uid = r.lines.find((l) => l.name === "UID")?.value.trim();
    if (rid && uid) {
      const s = parseStamp(rid.value, rid.params);
      if (s) overrides.set(`${uid}|${stampKey(s, zone)}`, r);
    }
  }

  function stampKey(s: Stamp, fallbackZone: string): string {
    if (s.kind === "date") return iso(s.y, s.mo, s.d);
    const tz = s.utc ? "UTC" : (resolveZone(s.zone) ?? fallbackZone);
    return String(wallToInstant(s.wall, tz));
  }

  // `single` is a one-off event: its UID alone names it, so moving it keeps
  // its identity. An occurrence of a series is named by the series and the
  // start it was originally given, which a move does not change.
  // Most of a large feed is the past. A one-off event whose written dates
  // fall days outside the window cannot reach it in any zone, so it is
  // dropped before any zone is looked up.
  const lo = shiftDay(window.from, -2), hi = shiftDay(window.to, 2);
  function farOutside(r: Raw, start: Stamp): boolean {
    const day = (st: Stamp) => (st.kind === "date" ? iso(st.y, st.mo, st.d) : iso(st.wall.y, st.wall.mo, st.wall.d));
    if (day(start) > hi) return true;
    if (r.lines.some((l) => l.name === "DURATION")) return false;
    const end = r.lines.find((l) => l.name === "DTEND");
    const endStamp = end ? parseStamp(end.value, end.params) : start;
    return !!endStamp && day(endStamp) < lo;
  }

  function emit(r: Raw, uid: string, occurrence: Stamp, startOverride?: Stamp, single = false) {
    const get = (n: string) => r.lines.find((l) => l.name === n);
    const s = startOverride ?? occurrence;
    const dtend = get("DTEND");
    const dur = get("DURATION");
    const title = unescapeText(get("SUMMARY")?.value ?? "").trim() || "(no title)";
    const cancelled = (get("STATUS")?.value ?? "").trim().toUpperCase() === "CANCELLED";
    const organizer = people(r.lines, "ORGANIZER")[0] ?? null;
    const attendees = people(r.lines, "ATTENDEE");
    const busy = busyOf(r.lines);
    const key = single ? uid : `${uid}|${stampKey(occurrence, zone)}`;
    if (s.kind === "date") {
      const startDay = iso(s.y, s.mo, s.d);
      let endDay = startDay;
      const e = dtend ? parseStamp(dtend.value, dtend.params) : null;
      if (e?.kind === "date") {
        // DTEND of an all-day event is exclusive.
        const span = Math.round((Date.UTC(e.y, e.mo - 1, e.d) - Date.UTC(s.y, s.mo - 1, s.d)) / 86400000);
        if (span > 1) endDay = iso(...((): [number, number, number] => { const t = new Date(Date.UTC(s.y, s.mo - 1, s.d + span - 1)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; })());
      } else if (dur) {
        const ms = durationMs(dur.value.trim());
        if (ms && ms > 86400000) {
          const t = new Date(Date.UTC(s.y, s.mo - 1, s.d) + ms - 86400000);
          endDay = iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
        }
      }
      if (endDay < window.from || startDay > window.to) return;
      events.push({ key, title, day: startDay, time: null, endDay, allDay: true, organizer, attendees, busy, cancelled });
      return;
    }
    const tz = s.utc ? "UTC" : resolveZone(s.zone);
    const startMs = wallToInstant(s.wall, tz ?? zone);
    let endMs = startMs;
    const e = dtend ? parseStamp(dtend.value, dtend.params) : null;
    if (e?.kind === "time") {
      // A series occurrence arrives with its DTEND already shifted (see
      // `shifted`), and a moved occurrence carries its own.
      endMs = Math.max(startMs, wallToInstant(e.wall, e.utc ? "UTC" : (resolveZone(e.zone) ?? zone)));
    } else if (dur) endMs = startMs + Math.max(0, durationMs(dur.value.trim()) ?? 0);
    const start = appDayTime(startMs, zone);
    const end = appDayTime(Math.max(startMs, endMs - 1), zone);
    if (end.day < window.from || start.day > window.to) return;
    events.push({ key, title, day: start.day, time: start.time, endDay: end.day, allDay: false, organizer, attendees, busy, cancelled, zoneGuessed: !s.utc && !!s.zone && !tz });
  }

  // One event that cannot be read is skipped and counted; the rest of the
  // feed still syncs. Anything it emitted before failing is taken back.
  for (const r of raws) {
    const before = events.length;
    try {
      readEvent(r);
    } catch {
      events.length = before;
      skipped += 1;
    }
  }
  return { events, skipped };

  function readEvent(r: Raw) {
    if (r.lines.some((l) => l.name === "RECURRENCE-ID")) return;
    const uid = r.lines.find((l) => l.name === "UID")?.value.trim();
    const dt = r.lines.find((l) => l.name === "DTSTART");
    const start = dt ? parseStamp(dt.value, dt.params) : null;
    if (!uid || !start) {
      skipped += 1;
      return;
    }
    const rrule = r.lines.find((l) => l.name === "RRULE");
    const rule = rrule ? parseRule(rrule.value) : null;
    if (!rule) {
      if (!farOutside(r, start)) emit(r, uid, start, undefined, true);
      return;
    }
    if (rule === "never") {
      skipped += 1;
      return;
    }
    if (budget.steps <= 0) {
      skipped += 1;
      return;
    }
    const exdates = new Set(
      r.lines
        .filter((l) => l.name === "EXDATE")
        .flatMap((l) => l.value.split(",").map((v) => parseStamp(v, l.params)))
        .filter((x): x is Stamp => !!x)
        .map((x) => stampKey(x, zone)),
    );
    const tz = start.kind === "time" ? (start.utc ? "UTC" : (resolveZone(start.zone) ?? zone)) : zone;
    const startWall: Wall = start.kind === "date" ? { y: start.y, mo: start.mo, d: start.d, h: 0, mi: 0, s: 0 } : start.wall;
    const dayOfWall = (w: Wall) => (start.kind === "date" ? iso(w.y, w.mo, w.d) : appDayTime(wallToInstant(w, tz), zone).day);
    const untilOk = (w: Wall) => {
      if (!rule.until) return true;
      const u = rule.until;
      if (u.kind === "date") return iso(w.y, w.mo, w.d) <= iso(u.y, u.mo, u.d);
      const uMs = wallToInstant(u.wall, u.utc ? "UTC" : (resolveZone(u.zone) ?? tz));
      return (start.kind === "date" ? Date.UTC(w.y, w.mo - 1, w.d) : wallToInstant(w, tz)) <= uMs;
    };
    const occurrences = expandRule(startWall, rule, (w) => dayOfWall(w) > window.to, untilOk, { from: { y: fy, mo: fm, d: fd }, budget });
    for (const w of occurrences) {
      const occ: Stamp = start.kind === "date" ? { kind: "date", y: w.y, mo: w.mo, d: w.d } : { kind: "time", wall: w, zone: start.zone, utc: start.utc };
      const k = stampKey(occ, zone);
      if (exdates.has(k)) continue;
      const moved = overrides.get(`${uid}|${k}`);
      if (moved) {
        const mdt = moved.lines.find((l) => l.name === "DTSTART");
        const ms = mdt ? parseStamp(mdt.value, mdt.params) : null;
        emit(moved, uid, occ, ms ?? occ);
        continue;
      }
      // Shift DTEND with the occurrence: emit with this occurrence as the start.
      emit(shifted(r, start, occ), uid, occ);
    }
  }

  // A copy of the series event whose DTEND moved by the same amount as the start.
  function shifted(r: Raw, first: Stamp, occ: Stamp): Raw {
    if (first.kind !== occ.kind) return r;
    const dtendLine = r.lines.find((l) => l.name === "DTEND");
    if (!dtendLine) return r;
    const end = parseStamp(dtendLine.value, dtendLine.params);
    if (!end) return r;
    let value: string;
    if (first.kind === "date" && occ.kind === "date" && end.kind === "date") {
      const shift = Date.UTC(occ.y, occ.mo - 1, occ.d) - Date.UTC(first.y, first.mo - 1, first.d);
      const t = new Date(Date.UTC(end.y, end.mo - 1, end.d) + shift);
      value = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
      return { lines: r.lines.map((l) => (l === dtendLine ? { ...l, params: { ...l.params, VALUE: "DATE" }, value } : l)) };
    }
    if (first.kind === "time" && occ.kind === "time" && end.kind === "time") {
      const fz = first.utc ? "UTC" : (resolveZone(first.zone) ?? zone);
      const length = wallToInstant(end.wall, end.utc ? "UTC" : (resolveZone(end.zone) ?? zone)) - wallToInstant(first.wall, fz);
      const w = instantToWall(wallToInstant(occ.wall, fz) + length, "UTC");
      value = `${w.y}${String(w.mo).padStart(2, "0")}${String(w.d).padStart(2, "0")}T${String(w.h).padStart(2, "0")}${String(w.mi).padStart(2, "0")}${String(w.s).padStart(2, "0")}Z`;
      return { lines: r.lines.map((l) => (l === dtendLine ? { name: "DTEND", params: {}, value } : l)) };
    }
    return r;
  }
}
