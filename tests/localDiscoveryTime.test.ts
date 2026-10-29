import { afterEach, expect, it, vi } from "vitest";
import { discoveryTimestamp } from "@/lib/local/discoveryTime";

afterEach(() => vi.unstubAllEnvs());

it("preserves the browser-local clock time with the applicable timezone offset", () => {
  vi.stubEnv("TZ", "America/Los_Angeles");
  expect(discoveryTimestamp("2026-10-29T10:30")).toBe("2026-10-29T17:30:00.000Z");
  expect(discoveryTimestamp("2026-12-01T10:30")).toBe("2026-12-01T18:30:00.000Z");
});

it("rejects invalid dates and nonexistent daylight-saving times without shifting them", () => {
  vi.stubEnv("TZ", "America/Los_Angeles");
  for (const value of ["2026-03-08T02:30", "2026-02-30T10:30", "2026-10-29T25:30", "2026-10-29", ""]) expect(discoveryTimestamp(value)).toBeNull();
  expect(discoveryTimestamp("2026-03-08T03:30")).toBe("2026-03-08T10:30:00.000Z");
});
