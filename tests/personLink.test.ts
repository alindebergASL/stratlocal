// One human, at more than one account.
//
// `contacts.account_id` is NOT NULL and stays that way, so this is not an
// identity table — it is a link between rows that each keep their own role,
// title and notes. The thing worth testing hardest is therefore not what it
// joins but what it must never reach: a context pack is per account and a
// handoff goes to another account team, so naming this person's other
// customers in either is one customer's information leaking into another's.
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDbForTests } from "@/lib/db";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { entityHistory, getAccount, getContact, listContacts } from "@/lib/queries/accounts";
import { buildContextPack } from "@/lib/meetings/contextPack";
import { buildHandoff } from "@/lib/handoff/build";
import { likelySamePerson, linkPeople, otherAccountsFor, unlinkPerson } from "@/lib/people";
import { accountRevision } from "@/lib/queries/freshness";
import { isNewerRevision } from "@/lib/freshness";
import { mergeContacts } from "@/lib/proposals/merge";
import { seedAccount, USER, type Seed } from "./helpers";

let a: Seed;
let b: Seed;

function personOn(accountId: string, name: string, email?: string) {
  return applyEntityChange({
    accountId,
    entityType: "contact",
    op: "create",
    payload: { name, org: "vendor", ...(email ? { email } : {}) },
    actorUserId: USER,
  }).entityId;
}

beforeEach(() => {
  resetDbForTests();
  a = seedAccount({ name: "Synthetic Orchard Lab" });
  b = seedAccount({ name: "Barton Synthetic Health", dealId: "SYN-DEAL-900" });
});

describe("linking one person across two accounts", () => {
  it("shows each row the other, by account", () => {
    const here = personOn(a.accountId, "Jaime Example", "jaime@example.com");
    const there = personOn(b.accountId, "Jaime Example", "jaime@example.com");
    linkPeople({ aId: here, bId: there });

    const seen = otherAccountsFor(getContact(here)!);
    expect(seen.map((c) => c.account_name)).toEqual(["Barton Synthetic Health"]);
    // And symmetrically, because a group id has no direction to get backwards.
    expect(otherAccountsFor(getContact(there)!).map((c) => c.account_name)).toEqual(["Synthetic Orchard Lab"]);
  });

  it("joins a third account to the same group rather than starting a second", () => {
    const c = seedAccount({ name: "Crestline Synthetic", dealId: "SYN-DEAL-901" });
    const one = personOn(a.accountId, "Jaime Example");
    const two = personOn(b.accountId, "Jaime Example");
    const three = personOn(c.accountId, "Jaime Example");
    linkPeople({ aId: one, bId: two });
    linkPeople({ aId: three, bId: two });
    expect(otherAccountsFor(getContact(one)!)).toHaveLength(2);
    expect(new Set([one, two, three].map((id) => getContact(id)!.person_id)).size).toBe(1);
  });

  it("makes one group of two that were already grouped separately", () => {
    const c = seedAccount({ name: "Crestline Synthetic", dealId: "SYN-DEAL-902" });
    const d = seedAccount({ name: "Dunmore Synthetic", dealId: "SYN-DEAL-903" });
    const one = personOn(a.accountId, "Jaime Example");
    const two = personOn(b.accountId, "Jaime Example");
    const three = personOn(c.accountId, "Jaime Example");
    const four = personOn(d.accountId, "Jaime Example");
    linkPeople({ aId: one, bId: two });
    linkPeople({ aId: three, bId: four });
    linkPeople({ aId: two, bId: three });
    expect(otherAccountsFor(getContact(one)!)).toHaveLength(3);
  });

  it("refuses two rows on one account, and says to merge them instead", () => {
    const one = personOn(a.accountId, "Jaime Example");
    const two = personOn(a.accountId, "Jaime Example");
    expect(() => linkPeople({ aId: one, bId: two })).toThrow(/merge them instead/);
    expect(() => linkPeople({ aId: one, bId: one })).toThrow(/same record/);
  });

  it("unlinks one row and leaves the rest linked to each other", () => {
    const c = seedAccount({ name: "Crestline Synthetic", dealId: "SYN-DEAL-904" });
    const one = personOn(a.accountId, "Jaime Example");
    const two = personOn(b.accountId, "Jaime Example");
    const three = personOn(c.accountId, "Jaime Example");
    linkPeople({ aId: one, bId: two });
    linkPeople({ aId: three, bId: two });
    unlinkPerson(one);
    expect(getContact(one)!.person_id).toBeNull();
    expect(otherAccountsFor(getContact(two)!)).toHaveLength(1);
  });

  it("clears the last one too, because a group of one is not a group", () => {
    const one = personOn(a.accountId, "Jaime Example");
    const two = personOn(b.accountId, "Jaime Example");
    linkPeople({ aId: one, bId: two });
    unlinkPerson(one);
    // Left set, the remaining row would offer "also at" with nothing after it.
    expect(getContact(two)!.person_id).toBeNull();
  });

  it("does not show an archived row, or one on an archived account", () => {
    const one = personOn(a.accountId, "Jaime Example");
    const two = personOn(b.accountId, "Jaime Example");
    linkPeople({ aId: one, bId: two });
    archiveEntity({ accountId: b.accountId, entityType: "contact", entityId: two, actorUserId: USER });
    expect(otherAccountsFor(getContact(one)!)).toEqual([]);
  });
});

describe("who the picker offers", () => {
  it("offers a match on the address, and on the name the import actually produces", () => {
    const here = personOn(a.accountId, "Jaime Example", "jaime@example.com");
    personOn(b.accountId, "J. Example", "jaime@example.com");
    personOn(b.accountId, "Jaime Example");
    personOn(b.accountId, "Somebody Else", "else@example.com");
    const offered = likelySamePerson(getContact(here)!).map((c) => c.name).sort();
    expect(offered).toEqual(["J. Example", "Jaime Example"]);
  });

  it("never offers somebody on this same account", () => {
    const here = personOn(a.accountId, "Jaime Example", "jaime@example.com");
    personOn(a.accountId, "Jaime Example", "jaime@example.com");
    expect(likelySamePerson(getContact(here)!)).toEqual([]);
  });

  it("stops offering the ones already linked", () => {
    const here = personOn(a.accountId, "Jaime Example");
    const there = personOn(b.accountId, "Jaime Example");
    expect(likelySamePerson(getContact(here)!)).toHaveLength(1);
    linkPeople({ aId: here, bId: there });
    expect(likelySamePerson(getContact(here)!)).toEqual([]);
  });
});

describe("the boundary the link must not cross", () => {
  // The one that matters. A context pack is built for one account and a
  // handoff is a document handed to another account team; either one naming
  // this person's other customers is a leak, and it would be an easy field to
  // add in the wrong place. Read from the sources so it survives a refactor
  // rather than depending on nobody doing it — the shape
  // tests/untrustedBoundary.test.ts uses for the research boundary.
  const sourceOf = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("is not read by anything that builds a prompt or a handoff", () => {
    for (const file of [
      "lib/meetings/contextPack.ts",
      "lib/handoff/build.ts",
      "lib/meetings/brief.ts",
      "lib/plan/draft.ts",
      "lib/research/notes.ts",
      "lib/queries/export.ts",
      // Ask's tools and loop: an agent over everything must not see one
      // person across accounts either.
      "lib/ask/tools.ts",
      "lib/ask/run.ts",
      "lib/ask/focus.ts",
    ]) {
      const src = sourceOf(file);
      expect(src, `${file} must not read the cross-account link`).not.toMatch(/person_id|otherAccountsFor|likelySamePerson/);
    }
  });

  it("and a pack for one account names no other account's rows", () => {
    const here = personOn(a.accountId, "Jaime Example", "jaime@example.com");
    const there = personOn(b.accountId, "Jaime Example", "jaime@example.com");
    linkPeople({ aId: here, bId: there });
    const pack = JSON.stringify(buildContextPack(a.accountId));
    expect(pack).not.toContain("Barton Synthetic Health");
    expect(pack).not.toContain(there);
    // The person is in it — it is their account too — just not their other one.
    expect(pack).toContain("Jaime Example");
  });

  it("and a handoff for one account names no other account's rows", () => {
    const here = personOn(a.accountId, "Jaime Example", "jaime@example.com");
    const there = personOn(b.accountId, "Jaime Example", "jaime@example.com");
    linkPeople({ aId: here, bId: there });
    const report = buildHandoff({ account: getAccount(a.accountId)!, by: "Alex", asks: "Keep the cadence.", note: null });
    const text = JSON.stringify(report);
    expect(text).not.toContain("Barton Synthetic Health");
    expect(text).not.toContain(there);
  });

  it("and listContacts, which everything reads through, does not gain a join", () => {
    // Cheap and load-bearing: the moment `listContacts` starts returning the
    // other accounts, every prompt in the app gets them for free.
    const here = personOn(a.accountId, "Jaime Example");
    const there = personOn(b.accountId, "Jaime Example");
    linkPeople({ aId: here, bId: there });
    const rows = listContacts(a.accountId);
    expect(rows.map((c) => c.account_id).every((id) => id === a.accountId)).toBe(true);
  });
});

// ---- the audit finding: a merge must not silently break the link ------------

describe("merging a duplicate keeps the link the duplicate carried", () => {
  it("carries person_id to the keeper, and it reads both ways", () => {
    // The duplicate at account A is the row that happened to get linked, which
    // is the ordinary case: you link the row you were looking at, and find the
    // duplicate later. Archiving it took the link with it — the survivor was
    // not connected to anything, the other account's row no longer named this
    // one, and nothing said so.
    const dup = personOn(a.accountId, "Finley Example", "finley.example@example.com");
    linkPeople({ aId: dup, bId: b.contactId });

    mergeContacts({ accountId: a.accountId, keeperId: a.contactId, loserId: dup, actorUserId: USER });

    const keeper = getContact(a.contactId)!;
    expect(keeper.person_id).not.toBeNull();
    expect(otherAccountsFor(keeper).map((c) => c.id)).toEqual([b.contactId]);
    expect(otherAccountsFor(getContact(b.contactId)!).map((c) => c.id)).toEqual([a.contactId]);
    // And it is in history, not just in the column.
    expect(entityHistory("contact", a.contactId, 50).some((h) => h.field === "person_link")).toBe(true);
  });

  it("keeps its own link when both rows have one, and says the other was not carried", () => {
    // Two groups is two claims about who this is; a merge is not the place to
    // decide that. The keeper's stands and the other is reported.
    const c = seedAccount({ name: "Account C", dealId: "SYN-C-1" });
    const dup = personOn(a.accountId, "Finley Example", "finley.example@example.com");
    linkPeople({ aId: a.contactId, bId: b.contactId });
    linkPeople({ aId: dup, bId: c.contactId });
    const before = getContact(a.contactId)!.person_id;

    mergeContacts({ accountId: a.accountId, keeperId: a.contactId, loserId: dup, actorUserId: USER });

    expect(getContact(a.contactId)!.person_id).toBe(before);
    expect(otherAccountsFor(getContact(a.contactId)!).map((x) => x.id)).toEqual([b.contactId]);
    const said = entityHistory("contact", a.contactId, 50).some(
      (h) => h.field === "merged_not_copied" && /different person at another account/.test(h.new_value ?? ""),
    );
    expect(said).toBe(true);
  });
});

describe("a link is a write like any other", () => {
  // It used to leave no trace at all: no history line, no actor, no new
  // version — so Activity never showed it, the Refresh notice never moved,
  // and an editor open on the row kept a version the link had made old.
  it("leaves a history line on each account, with who did it, and moves each row's version", () => {
    const here = personOn(a.accountId, "Jaime Example");
    const there = personOn(b.accountId, "Jaime Example");
    const beforeHere = getContact(here)!.updated_at;
    const revA = accountRevision(a.accountId);
    const revB = accountRevision(b.accountId);
    linkPeople({ aId: here, bId: there, actorUserId: USER });
    for (const [id, acct, rev] of [[here, a.accountId, revA], [there, b.accountId, revB]] as const) {
      const line = entityHistory("contact", id, 50).find((h) => h.field === "person_link");
      expect(line, `no history on ${acct}`).toBeTruthy();
      expect((line as unknown as { actor_user_id: string | null }).actor_user_id).toBe(USER);
      expect(isNewerRevision(accountRevision(acct), rev)).toBe(true);
    }
    expect(getContact(here)!.updated_at).toBeGreaterThan(beforeHere);
    // The conflict check is per field, so an editor that opened before the
    // link can still save the fields it shows: the link is not one of them.
    expect(() =>
      applyEntityChange({ accountId: a.accountId, entityType: "contact", op: "update", entityId: here, payload: { title: "Synthetic title" }, actorUserId: USER, baseVersion: beforeHere }),
    ).not.toThrow();
  });

  it("records the unlink too, on both rows when the group falls to one", () => {
    const here = personOn(a.accountId, "Jaime Example");
    const there = personOn(b.accountId, "Jaime Example");
    linkPeople({ aId: here, bId: there, actorUserId: USER });
    const revB = accountRevision(b.accountId);
    unlinkPerson(here, USER);
    const lines = (id: string) => entityHistory("contact", id, 50).filter((h) => h.field === "person_link").length;
    expect(lines(here)).toBe(2);
    expect(lines(there)).toBe(2);
    expect(isNewerRevision(accountRevision(b.accountId), revB)).toBe(true);
  });
});
