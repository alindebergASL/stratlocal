// Is this person already on file?
//
// The one rule two importers share — the team named on a report, and a
// spreadsheet of people — which is why it is worth pinning on its own rather
// than through either of them. A person has no id in any export, so this is
// the whole of their identity as far as an import is concerned, and every way
// it can be wrong produces a duplicate person or an edit to the wrong one
// rather than an error anybody would see.
import { describe, expect, it } from "vitest";
import { matchContact } from "@/lib/matchContact";

type Row = { id: string; name: string; email?: string | null; archived_at?: string | null };

const rows = (...r: Row[]) => r;

describe("matching a person", () => {
  it("prefers the address, because a name is not an identifier", () => {
    const found = matchContact(
      rows({ id: "by-name", name: "Finley Example" }, { id: "by-email", name: "F. Example", email: "finley@example.com" }),
      { name: "Finley Example", email: "finley@example.com" },
    );
    expect(found?.row.id).toBe("by-email");
    expect(found?.by).toBe("email");
  });

  it("falls back to the name, by the rule the rest of the app uses", () => {
    // sameName ignores case, punctuation and repeated spaces. The report path
    // used to compare lowercased strings, which is stricter by exactly the
    // differences a spreadsheet introduces.
    for (const name of ["finley example", "Finley  Example", " Finley Example ", "Finley-Example"]) {
      const found = matchContact(rows({ id: "c1", name: "Finley Example" }), { name });
      expect(found?.row.id, name).toBe("c1");
      expect(found?.by).toBe("name");
    }
  });

  it("does not match somebody who is simply not there", () => {
    expect(matchContact(rows({ id: "c1", name: "Finley Example" }), { name: "Rowan Example" })).toBeUndefined();
    expect(matchContact([], { name: "Finley Example", email: "f@example.com" })).toBeUndefined();
  });

  it("still finds an archived person, so an import offers them back instead of duplicating them", () => {
    const found = matchContact(rows({ id: "gone", name: "Finley Example", archived_at: "2026-01-01" }), { name: "Finley Example" });
    expect(found?.row.id).toBe("gone");
  });

  it("but prefers the live one when both exist", () => {
    // Inherited from the report diff, where it was a plain Array.find: with an
    // archived and a live contact of the same name, the archived one came
    // back. The import then proposed lifting the duplicate out of the archive
    // and left the person you actually work with untouched — and the review
    // card cannot tell you which of the two it means.
    const both = rows(
      { id: "archived", name: "Finley Example", archived_at: "2026-01-01" },
      { id: "live", name: "Finley Example" },
    );
    expect(matchContact(both, { name: "Finley Example" })?.row.id).toBe("live");
    // Order in the list must not decide it either way.
    expect(matchContact([...both].reverse(), { name: "Finley Example" })?.row.id).toBe("live");
  });

  it("prefers the live one on the address too", () => {
    const both = rows(
      { id: "archived", name: "Old Record", email: "finley@example.com", archived_at: "2026-01-01" },
      { id: "live", name: "Finley Example", email: "finley@example.com" },
    );
    expect(matchContact(both, { name: "Finley Example", email: "finley@example.com" })?.row.id).toBe("live");
  });

  it("an archived match on the address still beats a live one on the name", () => {
    // The precedence between the two keys does not change: an address is an
    // identifier and a name is a guess, so a hidden row carrying the address
    // is still the better answer than a different live person who happens to
    // share the name.
    const both = rows(
      { id: "archived-email", name: "F. Example", email: "finley@example.com", archived_at: "2026-01-01" },
      { id: "live-name", name: "Finley Example" },
    );
    const found = matchContact(both, { name: "Finley Example", email: "finley@example.com" });
    expect(found?.row.id).toBe("archived-email");
    expect(found?.by).toBe("email");
  });
});
