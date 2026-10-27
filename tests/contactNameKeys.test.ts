// SYNTHETIC ONLY: invented identity labels.
import { expect, it } from "vitest";
import { nameKey, sameName } from "@/lib/format";
import { readContacts } from "@/lib/sheet/readContacts";

it("retains distinct non-Latin names and mixed-script names", () => {
  const names = ["合成甲", "合成乙", "合成甲 Lee", "合成乙 Lee"];
  expect(new Set(names.map(nameKey)).size).toBe(names.length);
  expect(sameName(names[0]!, names[1]!)).toBe(false);
  const result = readContacts(names.map((name) => [name]), { name: 0 });
  expect(result.contacts.map((person) => person.name)).toEqual(names);
  expect(result.skipped).toEqual([]);
});

it("preserves combining vowel marks that distinguish names", () => {
  const names = ["कला", "कलि"];
  expect(sameName(names[0]!, names[1]!)).toBe(false);
  const result = readContacts(names.map((name) => [name]), { name: 0 });
  expect(result.contacts.map((person) => person.name)).toEqual(names);
  expect(result.skipped).toEqual([]);
});

it("still recognises repeated names across whitespace and canonical Unicode forms", () => {
  expect(sameName("Synthetic  Sam", "synthetic sam")).toBe(true);
  expect(sameName("Synthétique", "Synthe\u0301tique")).toBe(true);
  const result = readContacts([["合成甲"], [" 合成甲 "]], { name: 0 });
  expect(result.contacts).toHaveLength(1);
  expect(result.skipped.map((row) => row.row)).toEqual([3]);
});

it("does not collapse distinct symbol-only labels onto an empty key", () => {
  const result = readContacts([["★"], ["♪"]], { name: 0 });
  expect(result.contacts).toHaveLength(2);
  expect(result.skipped).toEqual([]);
});
