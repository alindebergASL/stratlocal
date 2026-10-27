// SYNTHETIC ONLY: invented people, addresses (example.com) and meetings.
import { describe, expect, it } from "vitest";
import { parseIcs, unfold } from "@/lib/calendar/ics";
import { appDayTime, resolveZone, wallToInstant } from "@/lib/calendar/zones";

const ZONE = "America/Los_Angeles";
const WINDOW = { from: "2026-10-14", to: "2026-11-15" };
const feed = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//EN", ...events, "END:VCALENDAR"].join("\r\n");

describe("time zones", () => {
  it("knows IANA names, Outlook's Windows names and prefixed paths", () => {
    expect(resolveZone("Europe/London")).toBe("Europe/London");
    expect(resolveZone("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(resolveZone("/mozilla.org/20050126_1/America/New_York")).toBe("America/New_York");
    expect(resolveZone("Mars Standard Time")).toBeNull();
  });

  it("turns a wall clock into the right instant on both sides of a clock change", () => {
    expect(new Date(wallToInstant({ y: 2026, mo: 10, d: 22, h: 9, mi: 0, s: 0 }, ZONE)).toISOString()).toBe("2026-10-22T16:00:00.000Z");
    expect(new Date(wallToInstant({ y: 2026, mo: 11, d: 2, h: 9, mi: 0, s: 0 }, ZONE)).toISOString()).toBe("2026-11-02T17:00:00.000Z");
    expect(appDayTime(Date.parse("2026-10-23T05:30:00Z"), ZONE)).toEqual({ day: "2026-10-22", time: "22:30" });
  });
});

describe("an iCal feed", () => {
  it("reads a meeting in Outlook's zone names, with folded and escaped text, people and no rooms", () => {
    const { events } = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:syn-1@example.com",
        "SUMMARY:Synthetic depot review\\, with the operations tea",
        " m",
        "DTSTART;TZID=Pacific Standard Time:20261022T113000",
        "DTEND;TZID=Pacific Standard Time:20261022T123000",
        'ORGANIZER;CN="Alex Example":mailto:Alex@Example.com',
        "ATTENDEE;CN=Finley Example;ROLE=REQ-PARTICIPANT:mailto:finley@customer.example.com",
        "ATTENDEE;CUTYPE=ROOM;CN=Room 4:mailto:room4@example.com",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "DESCRIPTION:Reminder",
        "END:VALARM",
        "END:VEVENT",
      ),
      WINDOW,
      ZONE,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "Synthetic depot review, with the operations team",
      day: "2026-10-22",
      time: "11:30",
      allDay: false,
      organizer: { email: "alex@example.com", name: "Alex Example" },
      attendees: [{ email: "finley@customer.example.com", name: "Finley Example" }],
      cancelled: false,
    });
  });

  it("puts a UTC or London meeting on the app's own clock", () => {
    const { events } = parseIcs(
      feed(
        "BEGIN:VEVENT", "UID:syn-utc", "SUMMARY:UTC call", "DTSTART:20261023T170000Z", "DTEND:20261023T173000Z", "END:VEVENT",
        "BEGIN:VEVENT", "UID:syn-ldn", "SUMMARY:London call", "DTSTART;TZID=Europe/London:20261022T090000", "DTEND;TZID=Europe/London:20261022T100000", "END:VEVENT",
      ),
      WINDOW,
      ZONE,
    );
    expect(events.map((e) => [e.title, e.day, e.time])).toEqual([["UTC call", "2026-10-23", "10:00"], ["London call", "2026-10-22", "01:00"]]);
  });

  it("reads an all-day, out-of-office span with an exclusive end, and a cancellation", () => {
    const { events } = parseIcs(
      feed(
        "BEGIN:VEVENT", "UID:syn-off", "SUMMARY:Out of office", "DTSTART;VALUE=DATE:20261030", "DTEND;VALUE=DATE:20261102", "X-MICROSOFT-CDO-BUSYSTATUS:OOF", "END:VEVENT",
        "BEGIN:VEVENT", "UID:syn-x", "SUMMARY:Synthetic cancelled call", "STATUS:CANCELLED", "DTSTART:20261024T170000Z", "DTEND:20261024T180000Z", "END:VEVENT",
      ),
      WINDOW,
      ZONE,
    );
    expect(events[0]).toMatchObject({ allDay: true, day: "2026-10-30", endDay: "2026-11-01", busy: "oof", time: null });
    expect(events[1]).toMatchObject({ cancelled: true });
  });

  it("expands a weekly series in the window, without the excluded day, with the moved one moved, across the clock change", () => {
    const { events } = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:syn-weekly",
        "SUMMARY:Synthetic weekly sync",
        "DTSTART;TZID=America/Los_Angeles:20261005T090000",
        "DTEND;TZID=America/Los_Angeles:20261005T093000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10",
        "EXDATE;TZID=America/Los_Angeles:20261021T090000",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:syn-weekly",
        "RECURRENCE-ID;TZID=America/Los_Angeles:20261019T090000",
        "SUMMARY:Synthetic weekly sync (moved)",
        "DTSTART;TZID=America/Los_Angeles:20261019T140000",
        "DTEND;TZID=America/Los_Angeles:20261019T143000",
        "END:VEVENT",
      ),
      WINDOW,
      ZONE,
    );
    expect(events.map((e) => `${e.day} ${e.time}`)).toEqual(["2026-10-14 09:00", "2026-10-19 14:00", "2026-10-26 09:00", "2026-10-28 09:00", "2026-11-02 09:00", "2026-11-04 09:00"]);
    expect(events[1]!.title).toBe("Synthetic weekly sync (moved)");
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
  });

  it("expands a monthly rule by weekday ordinal, and stops at UNTIL", () => {
    const { events } = parseIcs(
      feed("BEGIN:VEVENT", "UID:syn-monthly", "SUMMARY:Synthetic monthly review", "DTSTART:20260908T160000Z", "DTEND:20260908T170000Z", "RRULE:FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261031T000000Z", "END:VEVENT"),
      { from: "2026-09-01", to: "2026-12-31" },
      ZONE,
    );
    expect(events.map((e) => e.day)).toEqual(["2026-09-08", "2026-10-13"]);
  });

  it("keeps a one-off event's identity when it moves, so a moved invite is not a new one", () => {
    const at = (t: string) => parseIcs(feed("BEGIN:VEVENT", "UID:syn-move", "SUMMARY:Synthetic call", `DTSTART:20261022T${t}00Z`, "END:VEVENT"), WINDOW, ZONE).events[0]!.key;
    expect(at("1700")).toBe(at("2100"));
  });

  it("skips an event with no start rather than guessing one", () => {
    expect(parseIcs(feed("BEGIN:VEVENT", "UID:syn-broken", "SUMMARY:No start", "END:VEVENT"), WINDOW, ZONE)).toEqual({ events: [], skipped: 1 });
    expect(unfold("A:1\r\n B\r\nC:2")).toEqual(["A:1B", "C:2"]);
  });
});

describe("a feed written to be slow", () => {
  const ev = (uid: string, start: string, rule: string) => ["BEGIN:VEVENT", `UID:${uid}@example.com`, "SUMMARY:Synthetic series", `DTSTART:${start}`, `RRULE:${rule}`, "END:VEVENT"].join("\r\n");

  it("reads a monthly rule from the year 1000 with a padded BYDAY quickly", () => {
    const byday = Array.from({ length: 20 }, () => "9MO").join(",");
    const text = feed(...[1, 2, 3, 4].map((n) => ev(`slow-${n}`, "10000101T090000Z", `FREQ=MONTHLY;BYDAY=${byday}`)));
    const t = performance.now();
    expect(parseIcs(text, WINDOW, ZONE)).toEqual({ events: [], skipped: 4 });
    expect(performance.now() - t).toBeLessThan(250);
  });

  it("still finds this week's occurrence of a daily series that began years ago", () => {
    const { events } = parseIcs(feed(ev("daily", "20190107T170000Z", "FREQ=DAILY")), WINDOW, ZONE);
    expect(events.length).toBe(33);
    expect(events[0]!.day).toBe("2026-10-14");
  });

  it("stops expanding once the feed's budget is spent and counts what it skipped", () => {
    // Each never matches, so each spends its full allowance.
    const text = feed(...Array.from({ length: 20 }, (_, n) => ev(`never-${n}`, "20260210T090000Z", "COUNT=3;FREQ=MONTHLY;BYMONTHDAY=31;INTERVAL=12")));
    const { skipped } = parseIcs(text, WINDOW, ZONE);
    expect(skipped).toBeGreaterThan(0);
  });
});

describe("one bad event in a feed", () => {
  const good = ["BEGIN:VEVENT", "UID:good@example.com", "SUMMARY:Synthetic review", "DTSTART:20261022T170000Z", "DTEND:20261022T180000Z", "END:VEVENT"].join("\r\n");

  it("is skipped and counted, and the rest of the feed still reads", () => {
    // A duration no date can hold.
    const bad = ["BEGIN:VEVENT", "UID:endless@example.com", "SUMMARY:Synthetic hold", "DTSTART:20261015T170000Z", "DURATION:P999999999999W", "END:VEVENT"].join("\r\n");
    const { events, skipped } = parseIcs(feed(bad, good), WINDOW, ZONE);
    expect(events.map((e) => e.key)).toEqual(["good@example.com"]);
    expect(skipped).toBe(1);
  });

  it("caps INTERVAL, so a huge one still reads its first occurrence", () => {
    const bad = ["BEGIN:VEVENT", "UID:huge@example.com", "SUMMARY:Synthetic series", "DTSTART:20261015T170000Z", "RRULE:FREQ=DAILY;INTERVAL=999999999", "END:VEVENT"].join("\r\n");
    const { events } = parseIcs(feed(bad), WINDOW, ZONE);
    expect(events.map((e) => e.day)).toEqual(["2026-10-15"]);
  });
});
