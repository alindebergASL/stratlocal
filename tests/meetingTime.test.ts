// When is the next one, and has it happened yet?
//
// A meeting was a bare date. So "Coming up" ordered `held_at, account name`,
// and three calls on a Tuesday sorted alphabetically by customer on the page
// whose whole job is what happens next. And "happened, no notes yet" filtered
// `held_at < today`, so the prompt to write notes arrived the following
// morning rather than in the ten minutes after the call — which is the app's
// own stated case for a phone, and the only moment the notes exist.
//
// Nothing caught either, because no fixture in this repository has ever had
// two meetings on the same day.
import { beforeEach, describe, expect, it } from "vitest";
import { applyEntityChange } from "@/lib/proposals/apply";
import { meetingsAwaitingNotes, upcomingMeetings } from "@/lib/queries/today";
import { byWhen, getMeeting, listMeetings } from "@/lib/queries/meetings";
import { nowHHMM } from "@/lib/clock";
import { seedAccount, USER, type Seed } from "./helpers";

// 2026-09-15 is a Tuesday. Times are Pacific, which is what APP_TIMEZONE
// defaults to and what held_time means.
const TUESDAY = "2026-09-15";
const EARLY_PACIFIC = new Date("2026-09-15T15:00:00Z"); // 08:00
const MIDDAY_PACIFIC = new Date("2026-09-15T19:00:00Z"); // 12:00
const EVENING_PACIFIC = new Date("2026-09-15T23:30:00Z"); // 16:30

let seed: Seed;

// held_time is passed through as given, null included — the first draft of
// this dropped a falsy value before it reached the schema, so the case that
// was meant to prove an empty string is refused proved nothing at all.
function meeting(title: string, heldAt: string, heldTime: string | null): string {
  return applyEntityChange({
    accountId: seed.accountId,
    entityType: "meeting",
    op: "create",
    payload: { title, held_at: heldAt, held_time: heldTime },
    actorUserId: USER,
  }).entityId;
}

beforeEach(() => {
  seed = seedAccount({ heldAt: "2020-01-01" });
});

describe("what is coming up", () => {
  // Evaluated first thing, so every meeting in these two is still ahead. They
  // used to run at midday and expect a nine o'clock call to be "coming up" —
  // which was true only because upcomingMeetings did not know a meeting had a
  // time, the same blind spot that put one call in both of Home's lists at
  // once. Amended deliberately: the ordering is what these test, and asking
  // about the ordering of a morning that has already happened does not.
  it("orders a day by time, not by the customer's initial", () => {
    meeting("Zebra Holdings review", TUESDAY, "15:00");
    meeting("Apex Industrial review", TUESDAY, "09:00");
    meeting("Mid-morning sync", TUESDAY, "11:00");
    expect(upcomingMeetings(EARLY_PACIFIC).map((m) => m.title)).toEqual([
      "Apex Industrial review",
      "Mid-morning sync",
      "Zebra Holdings review",
    ]);
  });

  it("puts a meeting nobody gave a time to after the ones that have one", () => {
    // Same rule as an undated follow-up: known first, unknown last. A meeting
    // really can be "some time on Thursday", and guessing a time would make
    // the order confidently wrong rather than honestly unknown.
    meeting("Some time Tuesday", TUESDAY, null);
    meeting("Four o'clock", TUESDAY, "16:00");
    meeting("Nine o'clock", TUESDAY, "09:00");
    expect(upcomingMeetings(EARLY_PACIFIC).map((m) => m.title)).toEqual(["Nine o'clock", "Four o'clock", "Some time Tuesday"]);
  });

  it("carries the time through to the page", () => {
    meeting("Quarterly review", TUESDAY, "14:30");
    expect(upcomingMeetings(MIDDAY_PACIFIC)[0]?.heldTime).toBe("14:30");
  });

  it("keeps a meeting that is happening right now", () => {
    // The hour a meeting is running belongs to "Coming up", not to "write the
    // notes": what you want on a phone at five past nine is the brief.
    const id = meeting("Sizing call", TUESDAY, "09:00");
    const fivePast = new Date("2026-09-15T16:05:00Z"); // 09:05
    expect(upcomingMeetings(fivePast).map((m) => m.id)).toContain(id);
    expect(meetingsAwaitingNotes(fivePast).map((m) => m.id)).not.toContain(id);
  });

  it("drops one once it is over", () => {
    const id = meeting("Sizing call", TUESDAY, "09:00");
    expect(upcomingMeetings(MIDDAY_PACIFIC).map((m) => m.id)).not.toContain(id);
  });

  it("still works for every meeting already on file, which has no time", () => {
    meeting("Wednesday", "2026-09-16", null);
    meeting("Tuesday", TUESDAY, null);
    expect(upcomingMeetings(MIDDAY_PACIFIC).map((m) => m.title)).toEqual(["Tuesday", "Wednesday"]);
  });
});

describe("what has happened and has no notes", () => {
  it("asks for the notes in the hour after the call, not the next morning", () => {
    const id = meeting("Sizing call", TUESDAY, "14:00");
    // At midday it has not happened.
    expect(meetingsAwaitingNotes(MIDDAY_PACIFIC).map((m) => m.id)).not.toContain(id);
    // At half past four it has, and the notes are the thing to do now.
    expect(meetingsAwaitingNotes(EVENING_PACIFIC).map((m) => m.id)).toContain(id);
  });

  it("leaves today's undated meetings alone until tomorrow", () => {
    // Without a time there is nothing to compare, and claiming a meeting has
    // happened when it may be at six is worse than waiting a day.
    const id = meeting("Some time Tuesday", TUESDAY, null);
    expect(meetingsAwaitingNotes(EVENING_PACIFIC).map((m) => m.id)).not.toContain(id);
    expect(meetingsAwaitingNotes(new Date("2026-09-16T19:00:00Z")).map((m) => m.id)).toContain(id);
  });

  it("drops one once its notes are written", () => {
    const id = meeting("Sizing call", TUESDAY, "09:00");
    expect(meetingsAwaitingNotes(MIDDAY_PACIFIC).map((m) => m.id)).toContain(id);
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: id,
      payload: { raw_notes: "They walked us through the footprint." },
      actorUserId: USER,
    });
    expect(meetingsAwaitingNotes(MIDDAY_PACIFIC).map((m) => m.id)).not.toContain(id);
  });
});

describe("a meeting is in one place at a time", () => {
  // The assertion that would have caught this, and the one that survives any
  // future change to either query.
  //
  // Giving a meeting a time taught exactly one query about it. At noon a nine
  // o'clock call was in *both* of Home's lists: under "Coming up" with a "No
  // brief yet" chip, and under "Happened, no notes yet" with an "Add notes"
  // chip — one screen asking you to prepare for a call that had ended two
  // hours earlier. Before the time existed the two sets were disjoint by
  // construction (held_at >= today against held_at < today); afterwards
  // nothing held them apart, and the test file that introduced the time seeded
  // precisely this state and only ever checked one side of it.
  //
  // So check both sides, at every hour of the day, for every shape of meeting.
  const HOURS = Array.from({ length: 24 }, (_, h) => h);

  function atPacific(hour: number): Date {
    // 2026-09-15 is PDT, UTC-7. 00:00 Pacific is 07:00Z the same day.
    return new Date(Date.UTC(2026, 8, 15, 7 + hour, 0, 0));
  }

  it.each([["09:00"], ["12:00"], ["16:30"], ["23:45"], ["00:15"]])(
    "a meeting at %s is never in both lists on the same day",
    (time) => {
      const id = meeting("Sizing call", TUESDAY, time);
      for (const h of HOURS) {
        const now = atPacific(h);
        const inUpcoming = upcomingMeetings(now).some((m) => m.id === id);
        const inAwaiting = meetingsAwaitingNotes(now).some((m) => m.id === id);
        expect(
          { hour: h, inUpcoming, inAwaiting },
          `a ${time} meeting was in both lists at ${String(h).padStart(2, "0")}:00`,
        ).not.toEqual({ hour: h, inUpcoming: true, inAwaiting: true });
      }
    },
  );

  it("a meeting with no time is never in both either", () => {
    const id = meeting("Some time Tuesday", TUESDAY, null);
    for (const h of HOURS) {
      const now = atPacific(h);
      const both =
        upcomingMeetings(now).some((m) => m.id === id) && meetingsAwaitingNotes(now).some((m) => m.id === id);
      expect(both, `an undated meeting was in both lists at ${String(h).padStart(2, "0")}:00`).toBe(false);
    }
  });

  it("and it is in one of them all day, never in neither", () => {
    // The other half of the partition. Dropping it from "Coming up" at its
    // start time and picking it up an hour later would leave an hour where the
    // meeting is nowhere on Home at all, which is worse than either bug.
    const id = meeting("Sizing call", TUESDAY, "09:00");
    for (const h of HOURS) {
      const now = atPacific(h);
      const somewhere =
        upcomingMeetings(now).some((m) => m.id === id) || meetingsAwaitingNotes(now).some((m) => m.id === id);
      expect(somewhere, `the meeting was in neither list at ${String(h).padStart(2, "0")}:00`).toBe(true);
    }
  });
});

describe("the time itself", () => {
  it("is stored as written and reads back", () => {
    const id = meeting("Quarterly review", TUESDAY, "09:05");
    expect(getMeeting(id)?.held_time).toBe("09:05");
  });

  it("refuses anything that would not sort", () => {
    // This feeds an ORDER BY and a string comparison against nowHHMM(), so a
    // value that sorts wrong sorts wrong forever.
    for (const bad of ["9:05", "24:00", "09:60", "2pm", "09:05:00", ""]) {
      expect(() => meeting("Bad", TUESDAY, bad)).toThrow();
    }
  });

  it("is zero-padded now, so the comparison holds all morning", () => {
    // "9:00" < "14:00" is false as a string. Every hour before ten would
    // otherwise count as later than every hour after it.
    expect(nowHHMM(new Date("2026-09-15T16:05:00Z"))).toBe("09:05");
    expect(nowHHMM(MIDDAY_PACIFIC)).toBe("12:00");
    expect(nowHHMM(new Date("2026-09-15T07:30:00Z"))).toBe("00:30");
  });
});

describe("the account's own list", () => {
  it("orders a day by time, and puts the next one first", () => {
    // The account page and the printable one-pager both picked "next meeting"
    // with `held_at.localeCompare`, so two meetings on one day tied and the
    // winner was whichever listMeetings returned first — the header could name
    // the five o'clock call while the nine o'clock one was next. Meanwhile the
    // list below had started printing "at 14:30" against rows ordered by date
    // alone, so a day was visibly out of order on the screen showing the time.
    meeting("Four o'clock", TUESDAY, "16:00");
    meeting("Nine o'clock", TUESDAY, "09:00");
    meeting("Some time Tuesday", TUESDAY, null);
    const rows = listMeetings(seed.accountId).filter((m) => m.held_at === TUESDAY);
    // Newest first in the list, undated last.
    expect(rows.map((m) => m.title)).toEqual(["Four o'clock", "Nine o'clock", "Some time Tuesday"]);
    // And chronological when something asks what is next.
    expect([...rows].sort(byWhen).map((m) => m.title)).toEqual(["Nine o'clock", "Four o'clock", "Some time Tuesday"]);
  });

  it("byWhen still orders across days when only one has a time", () => {
    const rows = [
      { held_at: "2026-09-16", held_time: null },
      { held_at: "2026-09-15", held_time: "16:00" },
      { held_at: "2026-09-15", held_time: null },
    ];
    expect([...rows].sort(byWhen)).toEqual([
      { held_at: "2026-09-15", held_time: "16:00" },
      { held_at: "2026-09-15", held_time: null },
      { held_at: "2026-09-16", held_time: null },
    ]);
  });
});
