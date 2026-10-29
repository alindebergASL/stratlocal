// SYNTHETIC ONLY. Picker data is account scoped and never exposes disk paths.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { linkArtifact, type Segment } from "@/lib/local/evidence";
import { sourceSelection } from "@/lib/local/sourcePicker";
import { seedAccount, USER } from "./helpers";

function source(accountId: string, segments: Segment[], warnings: string[] = []) {
  const artifactId = "synthetic-source";
  db().prepare("INSERT INTO local_artifacts VALUES(?,?,?,?,?,?,?,?,?)").run(
    artifactId, "synthetic-hash", "synthetic-notes.md", "text/markdown", "/private/synthetic-source.bin", 123,
    JSON.stringify(segments), JSON.stringify(warnings), 1,
  );
  linkArtifact(artifactId, accountId, USER);
  return artifactId;
}

function notFound(fn: () => unknown) {
  try {
    fn();
    throw new Error("Expected source access to be refused");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    return (error as HttpError).body;
  }
}

it("checks account membership before reading source content and conceals missing sources", () => {
  const a = seedAccount();
  const b = seedAccount({ name: "Synthetic Harbor Lab", dealId: "SYN-HARBOR" });
  const id = source(a.accountId, [{ locator: "section:1", label: "Meeting", text: "Synthetic quotation" }]);
  db().prepare("UPDATE local_artifacts SET segments_json='invalid-json' WHERE id=?").run(id);
  expect(notFound(() => sourceSelection(b.accountId, id))).toEqual(notFound(() => sourceSelection(a.accountId, "missing")));
});

it("handles sources with no extracted text without inventing locations", () => {
  const a = seedAccount();
  const id = source(a.accountId, [{ locator: "section:1", label: "Empty", text: " \n " }], ["No readable source text"]);
  expect(sourceSelection(a.accountId, id)).toEqual({
    artifactId: id, filename: "synthetic-notes.md", locations: [], page: 1, pages: 1, totalLocations: 0,
    preview: null, warnings: ["No readable source text"], warningCount: 1,
  });
  notFound(() => sourceSelection(a.accountId, id, 1, "section:1"));
});

it("keeps all locations reachable through bounded pages and handles invalid page numbers", () => {
  const a = seedAccount();
  const id = source(a.accountId, Array.from({ length: 205 }, (_, i) => ({ locator: `page:${i + 1}`, label: `Page ${i + 1}`, text: `Synthetic page ${i + 1}` })));
  const pages = [1, 2, 3].map(page => sourceSelection(a.accountId, id, page));
  expect(pages.map(page => page.locations.length)).toEqual([100, 100, 5]);
  expect(new Set(pages.flatMap(page => page.locations.map(location => location.locator))).size).toBe(205);
  expect(pages[0]?.totalLocations).toBe(205);
  expect(sourceSelection(a.accountId, id, 999).page).toBe(3);
  for (const page of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) expect(sourceSelection(a.accountId, id, page).page).toBe(1);
  // A selection stays inspectable even while browsing another locations page.
  expect(sourceSelection(a.accountId, id, 1, "page:205").preview?.text).toBe("Synthetic page 205");
});

it("bounds previews, labels and warnings while preserving full counts and stored content", () => {
  const a = seedAccount();
  const id = source(a.accountId, [{ locator: "section:1", label: "L".repeat(250), text: "Q".repeat(12_001) }], Array.from({ length: 12 }, (_, i) => `Synthetic warning ${i}`));
  const before = db().prepare("SELECT * FROM local_artifacts WHERE id=?").get(id);
  const selected = sourceSelection(a.accountId, id, 1, "section:1");
  expect(selected.preview).toMatchObject({ locator: "section:1", fullLength: 12_001, truncated: true });
  expect(selected.preview?.text).toHaveLength(12_000);
  expect(selected.preview?.label).toHaveLength(200);
  expect(selected.locations[0]?.label).toHaveLength(200);
  expect(selected.warnings).toHaveLength(10);
  expect(selected.warningCount).toBe(12);
  expect(JSON.stringify(selected)).not.toMatch(/storage_path|\/private\/|synthetic-hash/);
  expect(db().prepare("SELECT * FROM local_artifacts WHERE id=?").get(id)).toEqual(before);
});

it("rejects unavailable locators and preserves short exact quotations", () => {
  const a = seedAccount();
  const id = source(a.accountId, [{ locator: "section:1", label: "Meeting", text: "Synthetic quotation\nSecond line" }]);
  notFound(() => sourceSelection(a.accountId, id, 1, "section:2"));
  expect(sourceSelection(a.accountId, id, 1, "section:1").preview).toEqual({
    locator: "section:1", label: "Meeting", text: "Synthetic quotation\nSecond line", fullLength: 31, truncated: false,
  });
});
