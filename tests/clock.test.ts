import { afterEach, describe, expect, it } from "vitest";
import { addDays, appTimeZone, dayOf, daysBetween, formatter, isRealDay, todayISO, todayLabel } from "@/lib/clock";
import { readDate } from "@/lib/sheet/readDeals";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { relativeDays } from "@/lib/format";

// 9:30pm Pacific on 12 September, which is already the 13th in UTC. Every bug
// this file guards against lives in that gap.
const PACIFIC_EVENING = new Date("2026-09-13T04:30:00Z");

afterEach(() => {
  delete process.env.APP_TIMEZONE;
});

describe("what day it is", () => {
  it("is the user's day, not the UTC day", () => {
    expect(todayISO(PACIFIC_EVENING)).toBe("2026-09-12");
    // The same instant really is the next day elsewhere; this is not the
    // formatter being lenient.
    expect(todayISO(PACIFIC_EVENING, "Europe/London")).toBe("2026-09-13");
    expect(PACIFIC_EVENING.toISOString().slice(0, 10)).toBe("2026-09-13");
  });

  it("follows APP_TIMEZONE and falls back rather than throwing", () => {
    process.env.APP_TIMEZONE = "America/New_York";
    expect(appTimeZone()).toBe("America/New_York");
    expect(todayISO(PACIFIC_EVENING)).toBe("2026-09-13");

    process.env.APP_TIMEZONE = "Mars/Olympus_Mons";
    expect(appTimeZone()).toBe("America/Los_Angeles");
    expect(todayISO(PACIFIC_EVENING)).toBe("2026-09-12");
  });

  // The formatters are cached because building one costs about 0.2ms and dayOf
  // runs once per history row — 250ms of a 287ms Home render, at a year of use.
  // The cache is the whole point; these two say what it must not swallow.
  it("hands back the same formatter for the same shape, and a different one for a different shape", () => {
    expect(formatter("en-CA", { timeZone: "America/Los_Angeles" })).toBe(formatter("en-CA", { timeZone: "America/Los_Angeles" }));
    expect(formatter("en-CA", { timeZone: "America/Los_Angeles" })).not.toBe(formatter("en-CA", { timeZone: "Europe/London" }));
    expect(formatter("en-CA", { timeZone: "America/Los_Angeles" })).not.toBe(formatter("en-GB", { timeZone: "America/Los_Angeles" }));
  });

  it("still follows a zone change in the same process", () => {
    // The temptation is to memoise appTimeZone() as well, since it reads an
    // environment variable that does not change at runtime. It does change
    // here, twice, and an answer cached on first call would make both of the
    // assertions below read the first zone forever.
    process.env.APP_TIMEZONE = "Europe/London";
    expect(dayOf(PACIFIC_EVENING.getTime())).toBe("2026-09-13");
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    expect(dayOf(PACIFIC_EVENING.getTime())).toBe("2026-09-12");
  });

  it("names the day the way the page header does", () => {
    expect(todayLabel(PACIFIC_EVENING)).toBe("Saturday 12 September");
  });

  it("reads an epoch timestamp as the user's calendar day", () => {
    expect(dayOf(PACIFIC_EVENING.getTime())).toBe("2026-09-12");
  });
});

describe("calendar arithmetic", () => {
  it("counts whole days, including across a daylight-saving change", () => {
    expect(daysBetween("2026-09-12", "2026-09-13")).toBe(1);
    expect(daysBetween("2026-09-13", "2026-09-12")).toBe(-1);
    expect(daysBetween("2026-09-12", "2026-09-12")).toBe(0);
    // US clocks go back on 2026-11-01: an hour-based count would say 7.04.
    expect(daysBetween("2026-10-29", "2026-11-05")).toBe(7);
  });

  it("adds days without drifting", () => {
    expect(addDays("2026-09-12", 7)).toBe("2026-09-19");
    expect(addDays("2026-09-12", -1)).toBe("2026-09-11");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("what depends on the day", () => {
  it("does not turn the fiscal quarter over early", () => {
    // 31 October, 9:30pm Pacific: UTC has already rolled into November, which
    // with an August fiscal start is the first day of Q2.
    const lastNightOfQ1 = new Date("2026-11-01T04:30:00Z");
    expect(currentFiscalQuarter(lastNightOfQ1).label).toBe("FY27 Q1");
    expect(currentFiscalQuarter(new Date("2026-11-01T12:00:00Z")).label).toBe("FY27 Q2");
  });

  it("counts 'yesterday' by the calendar, not by elapsed hours", () => {
    // Eleven last night to nine this morning is ten hours, and was yesterday.
    const lastNight = new Date("2026-09-12T06:00:00Z").getTime(); // 11pm Pacific on the 11th
    const thisMorning = new Date("2026-09-12T16:00:00Z").getTime(); // 9am Pacific on the 12th
    expect(relativeDays(lastNight, thisMorning)).toBe("yesterday");
    expect(relativeDays(thisMorning, thisMorning)).toBe("today");
  });
});

describe("a date that is only date-shaped", () => {
  // `as_of` on an install-base snapshot is what orders the snapshots, so a
  // value that is not a real day sorts into that order forever. The report
  // import validated it with /^\d{4}-\d{2}-\d{2}$/ alone, which takes all of
  // the first list below.
  it("is not a real day", () => {
    for (const bad of ["2026-13-45", "2026-02-31", "2026-00-10", "2026-04-31", "2025-02-29", "2026-12-32", "", "today", "2026-6-30", "20260630"]) {
      expect(isRealDay(bad), bad).toBe(false);
    }
  });

  it("and these are", () => {
    for (const good of ["2026-06-30", "2024-02-29", "2026-01-01", "2026-12-31", " 2026-06-30 "]) {
      expect(isRealDay(good), good).toBe(true);
    }
  });

  it("agrees with the spreadsheet reader, which had its own copy of the rule", () => {
    // Two copies of a validation rule is how the two disagree — this round has
    // already paid for that once, with email addresses.
    expect(() => readDate("2026-02-31")).toThrow(/not a real date/);
    expect(readDate("2024-02-29")).toBe("2024-02-29");
  });
});
