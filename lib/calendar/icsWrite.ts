// Dated work as an iCalendar file (RFC 5545) to open in Outlook or any
// calendar: each item an all-day event on its day, with a reminder the
// morning before. Written by code from the records; the file is downloaded,
// nothing is sent. The reader of calendars is lib/calendar/ics.ts.
export type IcsItem = { uid: string; day: string; title: string; description?: string | null; url?: string | null };

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 octets are folded with a leading space (RFC 5545 3.1).
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return parts.join("\r\n ");
}

const compact = (day: string) => day.replace(/-/g, "");
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function icsCalendar(name: string, items: IcsItem[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//strategy//playbook//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escape(name)}`];
  for (const item of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.day)) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(item.day)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(item.day))}`,
      `SUMMARY:${escape(item.title)}`,
      ...(item.description ? [`DESCRIPTION:${escape(item.description)}`] : []),
      ...(item.url ? [`URL:${item.url}`] : []),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escape(item.title)}`,
      // The morning before: 15 hours before the start of the day.
      "TRIGGER:-PT15H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function icsResponseHeaders(filename: string): Record<string, string> {
  const safe = filename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "calendar";
  return { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${safe}.ics"`, "cache-control": "no-store" };
}
