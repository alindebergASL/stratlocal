// Synthetic names and example domains only.
import { expect, it } from "vitest";
import { findingAge, newestFirst, sourceKind } from "@/lib/research/provenance";

it("says what kind of source a finding came from, from its address alone", () => {
  expect(sourceKind("https://www.sec.gov/Archives/edgar/data/1/x.htm")).toBe("Filing");
  expect(sourceKind("https://www.businesswire.com/news/home/1/en")).toBe("Company");
  expect(sourceKind("https://www.reuters.com/technology/x")).toBe("Press");
  expect(sourceKind("https://www.datacenterdynamics.com/en/news/x")).toBe("Trade");
  expect(sourceKind("https://procurement.state.example.gov/bid/1")).toBe("Public record");
  expect(sourceKind("https://investors.example.test/news")).toBe("Company");
  expect(sourceKind("https://example.test/a")).toBe("Other");
  expect(sourceKind("not a url")).toBe("Other");
});

it("knows the account's own site by its name, but not by a generic word in it", () => {
  expect(sourceKind("https://www.examplehealth.example/about", "Example Health")).toBe("Company");
  expect(sourceKind("https://news.northwind.example/2026/x", "Northwind Systems")).toBe("Company");
  expect(sourceKind("https://ehs.example/about", "Example Health Services")).toBe("Company");
  // "Health" alone is not the account: a health trade site is not its own page.
  expect(sourceKind("https://www.healthnews.example/x", "Example Health")).toBe("Other");
  // A trade outlet stays trade even when the account's name is in the path.
  expect(sourceKind("https://www.fiercehealthcare.com/example-health", "Example Health")).toBe("Trade");
});

it("says how old a finding is, and flags a year or more", () => {
  expect(findingAge("2026-10-03", "2026-10-22")).toEqual({ label: "this month", stale: false, months: 0 });
  expect(findingAge("2026-09-01", "2026-10-22")).toEqual({ label: "1 month old", stale: false, months: 1 });
  expect(findingAge("2025-11-30", "2026-10-22")).toEqual({ label: "10 months old", stale: false, months: 10 });
  expect(findingAge("2025-10-22", "2026-10-22")).toEqual({ label: "12 months old", stale: true, months: 12 });
  expect(findingAge("2023-04-01", "2026-10-22")).toEqual({ label: "3 years old", stale: true, months: 42 });
  expect(findingAge("2027-01-15", "2026-10-22")).toEqual({ label: "dated ahead", stale: false, months: 0 });
  expect(findingAge(null, "2026-10-22")).toBeNull();
});

it("puts the newest first, by the finding's own date before the run's", () => {
  const rows = [
    { id: "a", date: "2024-01-01", asOf: "2026-10-01T00:00:00Z" },
    { id: "b", date: null, asOf: "2026-05-01T00:00:00Z" },
    { id: "c", date: "2026-08-01", asOf: "2026-09-01T00:00:00Z" },
  ];
  expect([...rows].sort(newestFirst).map((r) => r.id)).toEqual(["c", "b", "a"]);
});

it("turns a search or a fetch into a line a person can follow, and nothing else", async () => {
  const { stepOf } = await import("@/lib/ai/runWebResearch");
  expect(stepOf({ type: "server_tool_use", name: "web_search", input: { query: "synthetic capital plan" } })).toEqual({ kind: "search", detail: "synthetic capital plan" });
  expect(stepOf({ type: "server_tool_use", name: "web_fetch", input: { url: "https://www.example.test/news/plan?x=1" } })).toEqual({ kind: "read", detail: "www.example.test/news/plan" });
  expect(stepOf({ type: "text", text: "hello" })).toBeNull();
  expect(stepOf({ type: "server_tool_use", name: "web_fetch", input: { url: "not a url" } })).toBeNull();
});
