// A pasted calendar invite, read into the New meeting form.
//
// Meetings are the loop this whole app is built around, and creating one was
// still a title, a date, a time and a checkbox per attendee, typed by hand
// before every call. This fills the form in; the Create button is still the
// accept, so it needs no new proposal origin and no migration, and DECISIONS
// #1 holds — a person presses the thing that writes.
import { containsQuote, UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";
import { formatter, todayISO } from "../clock";
import { sameName } from "../format";
import type { StageUsage } from "../ai/cost";
import { MeetingInvite } from "./inviteSchema";

const SYSTEM = `You read a calendar invite, an agenda, or an email a seller has pasted, and pull out the meeting it describes.

${UNTRUSTED_RULES}

Produce:
- title: the invite's subject, as written. Not a summary of it.
- held_at: the date, as YYYY-MM-DD. If the invite gives a weekday and no year, use the year that makes the date fall closest to the date given below as today.
- held_time: the START time, as HH:MM on a 24-hour clock, exactly as the invite writes it. Null if the invite gives no time.
- time_zone: the timezone the invite names, copied verbatim — "Pacific Time", "PT", "Europe/London", "GMT+1". Null if it names none.
- attendees: every person named as attending, with their email if the invite gives one, and a quote copied verbatim from the paste that contains their name.

Rules specific to this task:
- Do NOT convert the time between timezones. Report the time as written and the zone as written, separately. Converting is not your job here and getting it wrong by an hour is worse than not doing it.
- Do NOT invent an attendee. A distribution list, a room, a dial-in bridge or a calendar resource is not a person.
- Every attendee must carry a quote copied verbatim from the paste. Someone you cannot quote does not belong in the answer.
- Report only what the paste says. If it does not give a time, say null rather than guessing a plausible one.`;

export type InviteCheckArgs = { text: string };

// Every attendee's name must appear verbatim in the paste, checked in code —
// the same discipline meeting extraction uses for a quoted claim. This is what
// stops a plausible-sounding invented attendee reaching the form pre-ticked.
export function checkInvite(x: MeetingInvite, args: InviteCheckArgs): Finding[] {
  const findings: Finding[] = [];
  if (!containsQuote(args.text, x.title)) {
    findings.push({ path: "title", message: `the title ${JSON.stringify(x.title.slice(0, 60))} does not appear in the paste; copy the subject line verbatim` });
  }
  x.attendees.forEach((a, i) => {
    if (!containsQuote(args.text, a.quote)) {
      findings.push({ path: `attendees[${i}].quote`, message: `the quote ${JSON.stringify(a.quote.slice(0, 60))} does not appear in the paste; quote verbatim or drop the person` });
      return;
    }
    if (!containsQuote(a.quote, a.name)) {
      findings.push({ path: `attendees[${i}].name`, message: `"${a.name}" is not in the quote you gave for them; quote a line that contains their name` });
    }
  });
  return findings;
}

// What survives when a retry did not fix it. Dropping beats failing: a title
// and a date are still worth having when one attendee could not be quoted.
export function sanitizeInvite(x: MeetingInvite, args: InviteCheckArgs): { invite: MeetingInvite; dropped: string[] } {
  const dropped: string[] = [];
  const attendees = x.attendees.filter((a) => {
    const ok = containsQuote(args.text, a.quote) && containsQuote(a.quote, a.name);
    if (!ok) dropped.push(`${a.name} — not quoted from the paste`);
    return ok;
  });
  return { invite: { ...x, attendees }, dropped };
}

// What the invite's time means in the app's timezone.
//
// The model reports the time and the zone as written; this does the
// arithmetic, because it is arithmetic. An unrecognised zone leaves the time
// as given and says so, rather than storing a number that is confidently an
// hour out — a meeting filed at the wrong hour is worse than one with no time
// at all, which is the whole reason held_time is nullable.
export type LocalTime = { time: string | null; note: string | null };

export function toAppTime(heldAt: string, heldTime: string | null, zone: string | null, appZone: string): LocalTime {
  if (!heldTime) return { time: null, note: null };
  if (!zone) return { time: heldTime, note: null };
  const iana = resolveZone(zone);
  if (!iana) {
    return { time: heldTime, note: `The invite says "${zone}", which this does not recognise — check the time is right for you.` };
  }
  const shifted = shift(heldAt, heldTime, iana, appZone);
  if (shifted === null) return { time: heldTime, note: `Could not convert from "${zone}" — check the time is right for you.` };
  if (shifted === heldTime) return { time: heldTime, note: null };
  return { time: shifted, note: `${heldTime} ${zone} is ${shifted} here.` };
}

// The abbreviations a real invite actually uses, and anything already an IANA
// name. Deliberately short: a zone this does not know produces a visible note
// rather than a guess, and the list grows when a real invite needs it to.
const ZONES: Record<string, string> = {
  pt: "America/Los_Angeles",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  "pacific time": "America/Los_Angeles",
  "us/pacific": "America/Los_Angeles",
  mt: "America/Denver",
  mst: "America/Denver",
  mdt: "America/Denver",
  "mountain time": "America/Denver",
  ct: "America/Chicago",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  "central time": "America/Chicago",
  et: "America/New_York",
  est: "America/New_York",
  edt: "America/New_York",
  "eastern time": "America/New_York",
  "us/eastern": "America/New_York",
  utc: "UTC",
  gmt: "UTC",
  bst: "Europe/London",
  cet: "Europe/Paris",
  cest: "Europe/Paris",
  ist: "Asia/Kolkata",
  jst: "Asia/Tokyo",
  aest: "Australia/Sydney",
};

export function resolveZone(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  // Something already IANA-shaped: try it, and let Intl say whether it exists.
  if (text.includes("/")) {
    try {
      formatter("en-CA", { timeZone: text });
      return text;
    } catch {
      // Fall through to the table; "US/Pacific" is in it.
    }
  }
  const key = text.toLowerCase().replace(/[()]/g, "").trim();
  return ZONES[key] ?? ZONES[key.replace(/\s*\(.*\)\s*/, "")] ?? null;
}

// HH:MM on `day` in `from`, expressed in `to`.
//
// Done by search rather than by arithmetic on offsets: an offset has to come
// from somewhere, and reading one out of Intl for a specific instant is the
// part that goes wrong around a DST boundary. This walks candidate UTC
// instants for the day and picks the one that renders as the wanted local
// time in the source zone, then renders that instant in the target zone.
function shift(day: string, time: string, from: string, to: string): string | null {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  const reader = formatter("en-GB", { timeZone: from, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dayReader = formatter("en-CA", { timeZone: from, year: "numeric", month: "2-digit", day: "2-digit" });
  // ±14 hours covers every real offset, and a half-hour step covers the zones
  // that are not on the hour (India, parts of Australia).
  for (let half = -28; half <= 28; half += 1) {
    const at = new Date(Date.UTC(y, mo - 1, d, h, m) + half * 30 * 60_000);
    if (reader.format(at) !== time) continue;
    if (dayReader.format(at) !== day) continue;
    return formatter("en-GB", { timeZone: to, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  }
  return null;
}

/** An attendee matched against the people already on the account. */
export type InviteAttendee = {
  name: string;
  email: string | null;
  /** The contact this is, when one is on file. */
  contactId: string | null;
};

// Email first, then exact name — the rule lib/import/diffExtraction.ts already
// uses, so the two never disagree about who is already on file.
export function matchAttendees(
  attendees: MeetingInvite["attendees"],
  contacts: Array<{ id: string; name: string; email: string | null }>,
): InviteAttendee[] {
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c.id]));
  const seen = new Set<string>();
  const out: InviteAttendee[] = [];
  for (const a of attendees) {
    const email = a.email?.trim().toLowerCase() ?? "";
    const contactId = (email ? byEmail.get(email) : undefined) ?? contacts.find((c) => sameName(c.name, a.name))?.id ?? null;
    // The same human listed twice — as a name and as an address — is one row.
    const key = contactId ?? `${email}|${a.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: a.name, email: a.email, contactId });
  }
  return out;
}

export type ReadInviteResult = {
  invite: MeetingInvite;
  local: LocalTime;
  attendees: InviteAttendee[];
  dropped: string[];
};

export async function readInvite(input: {
  text: string;
  contacts: Array<{ id: string; name: string; email: string | null }>;
  appZone: string;
  stages: StageUsage[];
  now?: Date;
}): Promise<ReadInviteResult> {
  const today = todayISO(input.now ?? new Date());
  const parsed = await runStructured({
    role: "meeting_invite",
    stageName: "read invite",
    system: SYSTEM,
    // The paste is untrusted text, wrapped exactly as an uploaded report is:
    // it arrives from a calendar system and may contain anything.
    user: `Today is ${today}.\n\n${wrapUntrusted("calendar_invite", input.text)}`,
    schema: MeetingInvite,
    effort: "low",
    maxTokens: 4000,
    check: (x) => checkInvite(x, { text: input.text }),
    fakeContext: { text: input.text, today },
    stages: input.stages,
  });
  const { invite, dropped } = sanitizeInvite(parsed.data, { text: input.text });
  return {
    invite,
    local: toAppTime(invite.held_at, invite.held_time, invite.time_zone, input.appZone),
    attendees: matchAttendees(invite.attendees, input.contacts),
    dropped,
  };
}
