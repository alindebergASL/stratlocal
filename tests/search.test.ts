import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { newId } from "@/lib/ids";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { narrowKind, search } from "@/lib/queries/search";
import { seedAccount, USER } from "./helpers";

function kinds(q: string): string[] {
  return search(q).map((g) => g.kind);
}

function labels(q: string, kind: string): string[] {
  return search(q).find((g) => g.kind === kind)?.hits.map((h) => h.label) ?? [];
}

describe("search", () => {
  beforeEach(() => resetDbForTests());

  it("finds an account, a deal by name, a person, a play and a meeting", () => {
    seedAccount();
    expect(labels("Synthetic Orchard", "account")).toEqual(["Synthetic Orchard Lab"]);
    expect(labels("EHR Refresh", "deal")).toEqual(["EHR Refresh"]);
    expect(labels("Example", "contact")).toEqual(["Finley Example"]);
    expect(labels("platform defense", "play")).toEqual(["EHR platform defense"]);
    expect(labels("Quarterly", "meeting")).toEqual(["Quarterly review"]);
  });

  // A deal id is the thing most likely to be pasted into the box.
  it("finds a deal by its id and links straight to it", () => {
    const seed = seedAccount();
    const hit = search(seed.dealId).find((g) => g.kind === "deal")?.hits[0];
    expect(hit?.label).toBe("EHR Refresh");
    // The deal's own page. The anchor it used to return stopped resolving
    // once deals past the first dozen moved behind a disclosure.
    expect(hit?.href).toBe(`/accounts/${seed.accountId}/deals/${seed.dealId}`);
    expect(hit?.accountName).toBe("Synthetic Orchard Lab");
  });

  it("reads the three columns it used to walk straight past", () => {
    // An account's thesis is the most considered paragraph in the whole app —
    // the sentence the plan turns on — and `accounts.name` was the only column
    // of that table search looked at. A contact's notes and a deal's
    // architecture were the same: written, displayed, exported, unfindable.
    const seed = seedAccount();
    for (const [entityType, entityId, payload] of [
      ["account", seed.accountId, { thesis: "They are consolidating three data centres into two." }],
      ["contact", seed.contactId, { notes: "Sceptical about the migration window." }],
      ["deal", seed.dealId, { architecture: "Campus fabric refresh" }],
    ] as const) {
      applyEntityChange({ accountId: seed.accountId, entityType, op: "update", entityId, payload, actorUserId: USER });
    }
    expect(labels("consolidating", "account")).toEqual(["Synthetic Orchard Lab"]);
    expect(labels("Sceptical", "contact")).toEqual(["Finley Example"]);
    expect(labels("Campus fabric", "deal")).toEqual(["EHR Refresh"]);
    // And a hit shows the line it matched, not the record's job title.
    expect(search("Sceptical").find((g) => g.kind === "contact")?.hits[0]?.detail).toMatch(/migration window/);
  });

  it("still hides an archived record found through one of those columns", () => {
    // The point of the archive filters is that they hold on every column, not
    // only the ones that existed when they were written.
    const seed = seedAccount();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "update",
      entityId: seed.contactId,
      payload: { notes: "Sceptical about the migration window." },
      actorUserId: USER,
    });
    expect(labels("Sceptical", "contact")).toEqual(["Finley Example"]);
    archiveEntity({ accountId: seed.accountId, entityType: "contact", entityId: seed.contactId, actorUserId: USER });
    expect(labels("Sceptical", "contact")).toEqual([]);
  });

  it("finds a contact by email and a follow-up by its text", () => {
    const seed = seedAccount();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "update",
      entityId: seed.contactId,
      payload: { email: "finley.example@example.com" },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the sizing document", status: "open" },
      actorUserId: USER,
    });
    expect(labels("finley.example@example.com", "contact")).toEqual(["Finley Example"]);
    expect(labels("sizing document", "action_item")).toEqual(["Send the sizing document"]);
  });

  it("ignores archived records and everything under an archived account", () => {
    const seed = seedAccount();
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER });
    expect(kinds("EHR Refresh")).not.toContain("deal");
    expect(kinds("Example")).toContain("contact");

    archiveEntity({ accountId: seed.accountId, entityType: "account", entityId: seed.accountId, actorUserId: USER });
    expect(search("SyntheticOrchard")).toEqual([]);
    expect(kinds("Example")).toEqual([]);
  });

  it("needs two characters, and treats wildcards literally", () => {
    seedAccount();
    expect(search("N")).toEqual([]);
    expect(search("%%")).toEqual([]);
    expect(search("__")).toEqual([]);
  });
});

describe("searching what was actually said", () => {
  beforeEach(() => resetDbForTests());

  function details(q: string, kind: string): string[] {
    return search(q).find((g) => g.kind === kind)?.hits.map((h) => h.detail ?? "") ?? [];
  }

  it("finds a meeting by something in its notes, and shows the line", () => {
    const seed = seedAccount();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: {
        raw_notes:
          "Attendees ran long on introductions. They are midway through an Epic migration and want the storage decision settled before it lands. Budget is with finance.",
      },
      actorUserId: USER,
    });
    // The title says nothing about Epic; before this the meeting was
    // unfindable by the only word anyone would remember.
    expect(labels("Epic migration", "meeting")).toEqual(["Quarterly review"]);
    expect(details("Epic migration", "meeting")[0]).toContain("Epic migration");
  });

  it("finds a meeting by its summary", () => {
    const seed = seedAccount();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { summary: "They confirmed the refresh is funded for the next fiscal year." },
      actorUserId: USER,
    });
    expect(labels("refresh is funded", "meeting")).toEqual(["Quarterly review"]);
  });

  it("finds a deal by its next step and a play by its thesis", () => {
    const seed = seedAccount();
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "Walk the storage sizing through with their architect" },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { thesis: "Hold the platform by getting ahead of the storage refresh." },
      actorUserId: USER,
    });
    expect(labels("storage sizing", "deal")).toEqual(["EHR Refresh"]);
    expect(labels("storage refresh", "play")).toEqual(["EHR platform defense"]);
  });

  it("does not match a hidden part of a research note", () => {
    // meta_json holds URLs, topic names and the findings a person unticked.
    // A LIKE over the blob would report matches nobody can see on the page.
    const seed = seedAccount();
    const meta = {
      title: "SyntheticOrchard: public signals",
      summary: "What is published about them.",
      findings: [
        { text: "They are standardising on flash storage.", quote: "standardising on flash storage", url: "https://example.com/procurement-notice", confidence: "high", date: null, topic: "technology" },
        { text: "A rumour about layoffs.", quote: "a rumour about layoffs", url: "https://example.com/b", confidence: "low", date: null, topic: "risk" },
      ],
      open_questions: [],
      focus: null,
      depth: "standard",
      generated_at: "2026-09-12",
      searches: 1,
      fetches: 0,
      dropped: [],
      accepted_finding_indexes: [0],
    };
    db()
      .prepare(
        `INSERT INTO documents (id, account_id, kind, filename, byte_size, content_text, meta_json, status, created_by, created_at)
         VALUES (?, ?, 'research_note', 'r.md', 10, 'prose', ?, 'accepted', ?, ?)`,
      )
      .run(newId(), seed.accountId, JSON.stringify(meta), USER, Date.now());

    expect(labels("flash storage", "research")).toEqual(["SyntheticOrchard: public signals"]);
    // Unticked: the person said this was not worth carrying.
    expect(labels("layoffs", "research")).toEqual([]);
    // A URL is not something anyone reads on the page.
    expect(labels("procurement-notice", "research")).toEqual([]);

    // And the hit has to land on the note it found, which is two hops of
    // capping away from where it used to point. It linked to the account
    // page's Research section, which renders the three newest notes — so a
    // hit on the fourth landed on an anchor that page does not have. The
    // research page has every note, but leaves all but its two newest as
    // cards, so the anchor alone would land on a collapsed one. Both halves
    // are asserted here because each is invisible from the other end.
    const hit = search("flash storage")
      .flatMap((g) => g.hits)
      .find((h) => h.kind === "research")!;
    // `?read=`: it opens the note to read, not to change what it keeps.
    expect(hit.href).toMatch(/\/research\?read=[^#]+#research-/);
    const [, noteId, anchored] = /\?read=([^#]+)#research-(.+)$/.exec(hit.href)!;
    expect(noteId, "the note it opens is the note it anchors to").toBe(anchored);
  });

  it("lets one group be opened past the ten it shows", () => {
    const seed = seedAccount();
    for (let i = 0; i < 14; i++) {
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "action_item",
        op: "create",
        payload: { text: `Send the sizing document, part ${i}`, status: "open" },
        actorUserId: USER,
      });
    }
    const collapsed = search("sizing document").find((g) => g.kind === "action_item");
    expect(collapsed?.hits).toHaveLength(10);
    expect(collapsed?.more).toBe(4);

    const opened = search("sizing document", "action_item");
    expect(opened).toHaveLength(1);
    expect(opened[0]?.hits).toHaveLength(14);
    expect(opened[0]?.more).toBe(0);
  });

  // ?kind=toString used to reach KIND_LABELS[kind].toLowerCase() — a function,
  // not a string — and return a 500 on a URL anyone can type. The first
  // version of this test asserted that KIND_LABELS has no "toString" of its
  // own, which is a property of every object literal and would pass with the
  // bug put back. This drives the guard the page actually uses.
  it("treats a name off Object.prototype as no kind at all", () => {
    const seed = seedAccount();
    for (const notAKind of ["toString", "valueOf", "constructor", "hasOwnProperty"]) {
      expect(narrowKind(notAKind)).toBeNull();
      // And searching with it narrows nothing rather than throwing.
      expect(() => search("SyntheticOrchard", narrowKind(notAKind))).not.toThrow();
    }
    expect(narrowKind("deal")).toBe("deal");
    expect(narrowKind(undefined)).toBeNull();
    expect(search(seed.dealId, narrowKind("deal")).every((g) => g.kind === "deal")).toBe(true);
  });
});
