import { describe, expect, it } from "vitest";
import { fiscalQuarter, fiscalQuarterFor, keyFromLabel } from "@/lib/fiscal";

describe("fiscalQuarter (FY starts 1 Aug)", () => {
  const cases: Array<[string, string]> = [
    ["2026-12-01", "FY27 Q2"],
    ["2026-11-20", "FY27 Q2"],
    ["2026-10-30", "FY27 Q1"],
    ["2026-09-18", "FY27 Q1"],
    ["2027-07-31", "FY27 Q4"],
    ["2030-07-16", "FY30 Q4"],
    ["2026-07-31", "FY26 Q4"],
    ["2026-08-01", "FY27 Q1"],
    ["2027-02-01", "FY27 Q3"],
    ["2027-01-31", "FY27 Q2"],
  ];
  for (const [date, label] of cases) {
    it(`${date} -> ${label}`, () => {
      expect(fiscalQuarter(date, 8)?.label).toBe(label);
    });
  }

  it("rejects non-dates", () => {
    expect(fiscalQuarter("soon", 8)).toBeNull();
    expect(fiscalQuarter("2026-13-01", 8)).toBeNull();
  });

  it("keys sort chronologically", () => {
    expect(fiscalQuarter("2026-10-30", 8)!.key).toBeLessThan(fiscalQuarter("2026-12-01", 8)!.key);
    expect(fiscalQuarter("2027-07-31", 8)!.key).toBeLessThan(fiscalQuarter("2027-08-01", 8)!.key);
  });

  it("calendar-year fiscal (start month 1) names FY by the same year", () => {
    expect(fiscalQuarterFor(2026, 3, 1).label).toBe("FY26 Q1");
    expect(fiscalQuarterFor(2026, 12, 1).label).toBe("FY26 Q4");
  });

  it("keyFromLabel round-trips", () => {
    expect(keyFromLabel("FY27 Q2")).toBe(20272);
    expect(keyFromLabel("fy2030 q4")).toBe(20304);
    expect(keyFromLabel("Q2 FY27")).toBeNull();
  });
});
