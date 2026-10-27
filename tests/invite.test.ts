// Paste the invite instead of typing it.
//
// The two things that decide whether this is worth having: it must not invent
// an attendee, and it must not put a meeting an hour out. The first is the
// same code-side guard every model surface in this app has — a name must be
// quotable from the paste. The second is arithmetic, which the model is told
// not to do and which is done here instead.
import { describe, expect, it, vi } from "vitest";
import { checkInvite, matchAttendees, resolveZone, sanitizeInvite, toAppTime } from "@/lib/meetings/invite";
import { MeetingInvite } from "@/lib/meetings/inviteSchema";
import { fakeAnswer } from "@/lib/ai/fake";

const PASTE = `Quarterly business review — SyntheticOrchard

When: Wednesday 15 September 2027, 10:00 - 11:00 (Eastern Time)
Where: Microsoft Teams

Required attendees:
  Finley Example <finley.example@example.com>
  Sam Okafor <sam.okafor@example.com>
Optional:
  Avery Example
`;

function invite(over: Partial<MeetingInvite> = {}): MeetingInvite {
  return {
    title: "Quarterly business review — SyntheticOrchard",
    held_at: "2027-09-15",
    held_time: "10:00",
    time_zone: "Eastern Time",
    attendees: [{ name: "Finley Example", email: "finley.example@example.com", quote: "Finley Example <finley.example@example.com>" }],
    ...over,
  };
}

describe("what the paste has to support", () => {
  it("accepts a title and attendees that are actually in it", () => {
    expect(checkInvite(invite(), { text: PASTE })).toEqual([]);
  });

  it("refuses a title the paste does not contain", () => {
    const findings = checkInvite(invite({ title: "Catch-up about the renewal" }), { text: PASTE });
    expect(findings.map((f) => f.path)).toContain("title");
  });

  it("refuses an attendee whose quote is not in the paste", () => {
    // The failure that matters: a plausible-sounding person who was never
    // there, arriving on the form already ticked.
    const bad = invite({ attendees: [{ name: "Blake Example", email: null, quote: "Blake Example will join" }] });
    expect(checkInvite(bad, { text: PASTE }).map((f) => f.path)).toContain("attendees[0].quote");
  });

  it("refuses an attendee whose name is not in their own quote", () => {
    // A real quote with a name bolted onto it is the subtler version of the
    // same thing, and the URL check in the research path taught this lesson.
    const bad = invite({ attendees: [{ name: "Blake Example", email: null, quote: "Required attendees:" }] });
    expect(checkInvite(bad, { text: PASTE }).map((f) => f.path)).toContain("attendees[0].name");
  });

  it("drops what a retry did not fix rather than losing the whole paste", () => {
    const { invite: kept, dropped } = sanitizeInvite(
      invite({
        attendees: [
          { name: "Finley Example", email: null, quote: "Finley Example <finley.example@example.com>" },
          { name: "Blake Example", email: null, quote: "Blake Example will join" },
        ],
      }),
      { text: PASTE },
    );
    expect(kept.attendees.map((a) => a.name)).toEqual(["Finley Example"]);
    expect(dropped).toHaveLength(1);
    expect(kept.title).toBe("Quarterly business review — SyntheticOrchard");
  });
});

describe("the time the invite means", () => {
  it("converts from the zone the invite names into the app's", () => {
    // 10:00 Eastern on a September day is 07:00 Pacific. The model reports
    // both halves as written; this is the arithmetic.
    const local = toAppTime("2027-09-15", "10:00", "Eastern Time", "America/Los_Angeles");
    expect(local.time).toBe("07:00");
    expect(local.note).toMatch(/10:00 Eastern Time is 07:00 here/);
  });

  it("gets a winter date right too, which a fixed offset would not", () => {
    // 15 January: both zones are on standard time, still three hours apart —
    // but a naive offset read off today's date would be wrong for one of them
    // half the year.
    expect(toAppTime("2027-01-15", "10:00", "ET", "America/Los_Angeles").time).toBe("07:00");
    // And across a date line, where the day changes.
    expect(toAppTime("2027-01-15", "09:00", "JST", "America/Los_Angeles").time).toBe("16:00");
  });

  it("handles a zone that is not on the hour", () => {
    expect(toAppTime("2027-09-15", "18:30", "IST", "UTC").time).toBe("13:00");
  });

  it("refuses a local time that does not exist rather than inventing one", () => {
    // 02:30 Eastern on 14 March 2027 never happens: the clock goes straight
    // from 01:59 to 03:00. An invite can say it anyway — a system in another
    // zone generated it — and the honest answer is the time as written with a
    // visible flag, not a confident hour either side of a gap.
    const local = toAppTime("2027-03-14", "02:30", "ET", "America/Los_Angeles");
    expect(local.time).toBe("02:30");
    expect(local.note).toMatch(/could not convert/i);
  });

  it("picks one side of an hour that happens twice, and says what it did", () => {
    // The other end of the same problem: 01:30 Eastern on 7 November 2027
    // happens twice. Either answer is defensible; saying nothing is not.
    const local = toAppTime("2027-11-07", "01:30", "ET", "America/Los_Angeles");
    expect(local.time).toBe("22:30");
    expect(local.note).toMatch(/01:30 ET is 22:30 here/);
  });

  it("carries a meeting across the date line without losing an hour", () => {
    // Midnight in Tokyo is the previous morning here, which is the case a
    // naive same-day offset gets wrong by a whole day.
    expect(toAppTime("2027-09-15", "00:00", "JST", "America/Los_Angeles").time).toBe("08:00");
    expect(toAppTime("2027-09-15", "23:59", "ET", "Asia/Tokyo").time).toBe("12:59");
  });

  it("leaves the time alone and says so when it does not know the zone", () => {
    // A meeting stored an hour out is worse than one with no time at all,
    // which is why held_time is nullable. Guessing is not an option.
    const local = toAppTime("2027-09-15", "10:00", "Chatham Standard Time", "America/Los_Angeles");
    expect(local.time).toBe("10:00");
    expect(local.note).toMatch(/does not recognise/);
  });

  it("says nothing when the invite names no zone, or gives no time", () => {
    expect(toAppTime("2027-09-15", "10:00", null, "America/Los_Angeles")).toEqual({ time: "10:00", note: null });
    expect(toAppTime("2027-09-15", null, "Eastern Time", "America/Los_Angeles")).toEqual({ time: null, note: null });
  });

  it("says nothing when the zone is the app's own", () => {
    expect(toAppTime("2027-09-15", "10:00", "Pacific Time", "America/Los_Angeles")).toEqual({ time: "10:00", note: null });
  });

  it("knows an IANA name as well as an abbreviation", () => {
    expect(resolveZone("Europe/London")).toBe("Europe/London");
    // A valid IANA alias is passed through as given rather than canonicalised:
    // Intl accepts it, so the conversion works, and rewriting it would be
    // making a claim about a table this does not own.
    expect(resolveZone("US/Pacific")).toBe("US/Pacific");
    expect(resolveZone("PT")).toBe("America/Los_Angeles");
    expect(resolveZone("(Eastern Time)")).toBe("America/New_York");
    expect(resolveZone("Nowhere/Nothing")).toBeNull();
    expect(resolveZone("")).toBeNull();
  });
});

describe("who is already on file", () => {
  const contacts = [
    { id: "c-dana", name: "Finley Example", email: "finley.example@example.com" },
    { id: "c-sam", name: "Sam Okafor", email: null },
  ];

  it("matches by email first and then by name, the rule the import already uses", () => {
    const matched = matchAttendees(
      [
        { name: "D. Example", email: "FINLEY.EXAMPLE@example.com", quote: "x" },
        { name: "Sam Okafor", email: null, quote: "y" },
        { name: "Avery Example", email: null, quote: "z" },
      ],
      contacts,
    );
    // Email wins even though the name does not match.
    expect(matched[0]).toMatchObject({ contactId: "c-dana" });
    expect(matched[1]).toMatchObject({ contactId: "c-sam" });
    // Nobody on file: offered, not created silently.
    expect(matched[2]).toMatchObject({ contactId: null, name: "Avery Example" });
  });

  it("collapses the same person listed twice", () => {
    const matched = matchAttendees(
      [
        { name: "Finley Example", email: null, quote: "x" },
        { name: "Finley Example", email: "finley.example@example.com", quote: "y" },
      ],
      contacts,
    );
    expect(matched).toHaveLength(1);
  });
});

describe("under AI_FAKE", () => {
  it("builds its answer from the real paste, so the guards still bite", () => {
    // Every browser flow and every width check runs under AI_FAKE, so a canned
    // answer that ignored the input would wave both guards through — the
    // reason fake.ts builds its other answers from real records too.
    vi.stubEnv("AI_FAKE", "1");
    const answer = MeetingInvite.parse(fakeAnswer("meeting_invite", { text: PASTE, today: "2027-09-01" }));
    expect(answer.title).toBe("Quarterly business review — SyntheticOrchard");
    expect(answer.held_at).toBe("2027-09-15");
    expect(answer.held_time).toBe("10:00");
    expect(answer.time_zone).toMatch(/Eastern/);
    expect(answer.attendees.map((a) => a.name)).toEqual(["Finley Example", "Sam Okafor"]);
    // And what it produces passes the real checks, which is the point.
    expect(checkInvite(answer, { text: PASTE })).toEqual([]);
    vi.unstubAllEnvs();
  });
});
