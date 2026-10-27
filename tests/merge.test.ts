import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type ContactRow, type DealRow, type MeetingRow, type PlayRow } from "@/lib/db";
import { applyEntityChange, archiveEntity, createProposalBatch, restoreEntity } from "@/lib/proposals/apply";
import { mergeContacts, mergeDeals, moveDeal } from "@/lib/proposals/merge";
import {
  entityHistory,
  entityHistoryFor,
  likelyDuplicateDeals,
  listAccountSummaries,
  listContacts,
  listDeals,
  mergedDealIds,
} from "@/lib/queries/accounts";
import { listArchived } from "@/lib/queries/meetings";
import { newLocalDealId } from "@/lib/ids";
import { buildContextPack } from "@/lib/meetings/contextPack";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;
let duplicateId: string;

function contact(id: string): ContactRow {
  return db().prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow;
}
function play(id: string): PlayRow {
  return db().prepare(`SELECT * FROM plays WHERE id = ?`).get(id) as PlayRow;
}
function dealRow(id: string): DealRow {
  return db().prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(id) as DealRow;
}
function meeting(id: string): MeetingRow {
  return db().prepare(`SELECT * FROM meetings WHERE id = ?`).get(id) as MeetingRow;
}

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
  // The keeper has no email or title; the duplicate — created from a meeting's
  // notes, where a signature block gave more away — has both.
  duplicateId = applyEntityChange({
    accountId: seed.accountId,
    entityType: "contact",
    op: "create",
    payload: { name: "Finley Example", org: "customer", email: "dana@example.com", title: "Director of IT" },
    actorUserId: USER,
  }).entityId;
  // The play links the duplicate, not the keeper.
  applyEntityChange({
    accountId: seed.accountId,
    entityType: "play",
    op: "update",
    entityId: seed.playId,
    payload: { contact_ids: [duplicateId] },
    actorUserId: USER,
  });
});

describe("merging two rows for one person", () => {
  it("moves everything to the keeper and archives the loser", () => {
    const result = mergeContacts({
      accountId: seed.accountId,
      keeperId: seed.contactId,
      loserId: duplicateId,
      actorUserId: USER,
    });

    expect(result.playsRelinked).toBe(1);
    expect(JSON.parse(play(seed.playId).contact_ids_json ?? "[]")).toEqual([seed.contactId]);

    // The keeper's blanks are filled from the loser, and nothing that was
    // already on the keeper is touched.
    expect(result.fieldsFilled.sort()).toEqual(["email", "title"]);
    expect(contact(seed.contactId).email).toBe("dana@example.com");
    expect(contact(seed.contactId).title).toBe("Director of IT");
    expect(contact(seed.contactId).role).toBe("it_leader");

    expect(contact(duplicateId).archived_at).not.toBeNull();
    expect(listContacts(seed.accountId).map((c) => c.id)).toEqual([seed.contactId]);
  });

  it("rewrites the attendee on every meeting they were in", () => {
    const second = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "create",
      payload: {
        title: "Architecture deep dive",
        held_at: "2026-09-20",
        attendees: [{ contact_id: duplicateId, name: "Finley Example", note: "brought the diagrams" }],
      },
      actorUserId: USER,
    }).entityId;

    const result = mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicateId, actorUserId: USER });
    expect(result.meetingsRewritten).toBe(1);
    const attendees = JSON.parse(meeting(second).attendees_json) as Array<{ contact_id: string; note: string | null }>;
    expect(attendees).toHaveLength(1);
    expect(attendees[0]?.contact_id).toBe(seed.contactId);
    // What was written about them at the time is a record of that meeting.
    expect(attendees[0]?.note).toBe("brought the diagrams");
  });

  it("collapses both rows to one attendee when a meeting had them twice", () => {
    const both = applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "create",
      payload: {
        title: "Both listed",
        held_at: "2026-09-21",
        attendees: [
          { contact_id: seed.contactId, name: "Finley Example", note: null },
          { contact_id: duplicateId, name: "Dana W", note: null },
        ],
      },
      actorUserId: USER,
    }).entityId;

    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicateId, actorUserId: USER });
    const attendees = JSON.parse(meeting(both).attendees_json) as unknown[];
    expect(attendees).toHaveLength(1);
  });

  it("records every step in history", () => {
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicateId, actorUserId: USER });
    const fields = (type: string, id: string) => entityHistory(type, id).map((h) => h.field);
    expect(fields("play", seed.playId)).toContain("contact_ids");
    expect(fields("contact", seed.contactId)).toEqual(expect.arrayContaining(["email", "title"]));
    expect(fields("contact", duplicateId)).toContain("archived_at");
  });

  it("says why, on both rows, and not only what", () => {
    // Every step above is a field change, which is the mechanical record and
    // not the reason. Without a narrative row the keeper's page shows an email
    // appearing out of nowhere and a play they were never on — and the person
    // reading it a month later has no way to tell a merge from a mistake. The
    // deal merge has written this since Phase 6; the contact merge, four
    // phases older, never did.
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicateId, actorUserId: USER });
    const keeper = entityHistory("contact", seed.contactId).find((h) => h.field === "merged_from");
    expect(keeper?.new_value).toContain("Finley");
    const loser = entityHistory("contact", duplicateId).find((h) => h.field === "merged_into");
    expect(loser?.new_value).toBeTruthy();
    // Written under the right entity type. `logRow` hardcoded 'deal', which is
    // why this went unwritten rather than written to the wrong place.
    expect(
      db().prepare(`SELECT COUNT(*) n FROM change_log WHERE entity_type = 'deal' AND field LIKE 'merged%'`).get(),
    ).toEqual({ n: 0 });
  });

  it("leaves the merged-away person out of what a model reads", () => {
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicateId, actorUserId: USER });
    const pack = buildContextPack(seed.accountId);
    expect(pack.contacts.map((c) => c.id)).toEqual([seed.contactId]);
  });

  it("refuses the merges that would lose or corrupt something", () => {
    expect(() =>
      mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: seed.contactId, actorUserId: USER }),
    ).toThrow(/same person/);

    expect(() =>
      mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: "no-such-id", actorUserId: USER }),
    ).toThrow(/not found/);

    // Someone on another account is not a duplicate of this one, however
    // alike the names look.
    const otherAccount = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name: "Fabrikam Health" },
      actorUserId: USER,
    }).entityId;
    const stranger = applyEntityChange({
      accountId: otherAccount,
      entityType: "contact",
      op: "create",
      payload: { name: "Finley Example", org: "customer" },
      actorUserId: USER,
    }).entityId;
    expect(() =>
      mergeContacts({ accountId: seed.accountId, keeperId: stranger, loserId: duplicateId, actorUserId: USER }),
    ).toThrow(/same account/);
  });

  it("does not overwrite a field the keeper already has", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "update",
      entityId: seed.contactId,
      payload: { email: "d.whitfield@example.com" },
      actorUserId: USER,
    });
    const result = mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicateId, actorUserId: USER });
    expect(result.fieldsFilled).toEqual(["title"]);
    expect(contact(seed.contactId).email).toBe("d.whitfield@example.com");
  });
});

describe("moving a deal to another account", () => {
  let target: string;

  beforeEach(() => {
    target = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name: "SyntheticOrchard Physician Group" },
      actorUserId: USER,
    }).entityId;
  });

  it("takes the deal, its id and its history with it", () => {
    // Something in its history from before the move.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { next_step: "Confirm the sizing" },
      actorUserId: USER,
    });

    moveDeal({ dealId: seed.dealId, fromAccountId: seed.accountId, toAccountId: target, actorUserId: USER });

    expect(listDeals(seed.accountId).map((d) => d.deal_id)).not.toContain(seed.dealId);
    expect(listDeals(target).map((d) => d.deal_id)).toEqual([seed.dealId]);
    // The id is the primary key, so recreating it elsewhere was never even
    // possible; what matters is that the history came too.
    const fields = entityHistory("deal", seed.dealId).map((h) => h.field);
    expect(fields).toContain("next_step");
    expect(fields).toContain("account_id");
  });

  it("unlinks it from plays on the account it left", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { deal_ids: [seed.dealId] },
      actorUserId: USER,
    });
    const result = moveDeal({ dealId: seed.dealId, fromAccountId: seed.accountId, toAccountId: target, actorUserId: USER });
    expect(result.unlinkedFromPlays).toBe(1);
    expect(JSON.parse(play(seed.playId).deal_ids_json ?? "[]")).toEqual([]);
    // A play that still pointed at a departed deal would make the next edit of
    // that play fail outright.
    expect(() =>
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "play",
        op: "update",
        entityId: seed.playId,
        payload: { next_step: "anything" },
        actorUserId: USER,
      }),
    ).not.toThrow();
  });

  it("rejects anything still proposed for it", () => {
    createProposalBatch(
      seed.accountId,
      { kind: "import", id: "doc-1", aiRunId: null },
      [
        {
          entity_type: "deal",
          op: "update",
          entity_id: seed.dealId,
          payload: { stage: 4 },
          rationale: null,
          source_ref: null,
        },
      ],
    );
    const pending = () =>
      (db().prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'`).get() as { n: number }).n;
    expect(pending()).toBe(1);
    moveDeal({ dealId: seed.dealId, fromAccountId: seed.accountId, toAccountId: target, actorUserId: USER });
    expect(pending()).toBe(0);
  });

  it("refuses the moves that make no sense", () => {
    expect(() =>
      moveDeal({ dealId: seed.dealId, fromAccountId: seed.accountId, toAccountId: seed.accountId, actorUserId: USER }),
    ).toThrow(/already on that account/);

    expect(() =>
      moveDeal({ dealId: "no-such-deal", fromAccountId: seed.accountId, toAccountId: target, actorUserId: USER }),
    ).toThrow(/not found/);

    expect(() =>
      moveDeal({ dealId: seed.dealId, fromAccountId: target, toAccountId: seed.accountId, actorUserId: USER }),
    ).toThrow(/not on that account/);

    archiveEntity({ accountId: target, entityType: "account", entityId: target, actorUserId: USER });
    expect(() =>
      moveDeal({ dealId: seed.dealId, fromAccountId: seed.accountId, toAccountId: target, actorUserId: USER }),
    ).toThrow(/archived/);
  });
});

describe("merging two rows for one deal", () => {
  let local: string;

  beforeEach(() => {
    // The shape this feature exists for: a deal opened before the CRM had an
    // id for it, worked for a fortnight, and then the report arrives.
    local = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: newLocalDealId(), name: "EHR Refresh", next_step: "Confirm the sizing", owner: "Casey Example" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { deal_ids: [local] },
      actorUserId: USER,
    });
  });

  it("keeps the CRM row, relinks the plays and leaves a tombstone", () => {
    const r = mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    expect(r.playsRelinked).toBe(1);
    expect(JSON.parse(play(seed.playId).deal_ids_json ?? "[]")).toEqual([seed.dealId]);
    expect(listDeals(seed.accountId).map((d) => d.deal_id)).toEqual([seed.dealId]);
    expect(dealRow(local).merged_into).toBe(seed.dealId);
    expect(dealRow(local).archived_at).not.toBeNull();
  });

  it("fills the blanks but never moves a number", () => {
    // The keeper came from the report: it has the money and the dates and no
    // next step. The loser has a fortnight of the seller's work.
    const r = mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    expect(r.fieldsFilled.sort()).toEqual(["next_step", "owner"]);
    expect(dealRow(seed.dealId).next_step).toBe("Confirm the sizing");
    // A merge says "these are the same deal". It must not change what the
    // account is worth, and whether the keeper happened to be blank must not
    // decide that either.
    expect(dealRow(seed.dealId).tcv_usd).toBe(1_000);
    expect(listAccountSummaries()[0]?.open_pipeline_usd).toBe(1_000);
  });

  it("records what it did not copy rather than dropping it", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: local,
      payload: { tcv_usd: 1_800_000, stage: 5 },
      actorUserId: USER,
    });
    const r = mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    // As money, not as a raw integer. This used to read "tcv 1800000" beside
    // "close date 2026-03-31", and the figure is the thing the line is read
    // for.
    expect(r.notCopied.join(" ")).toContain("$1,800,000");
    expect(r.notCopied.join(" ")).not.toMatch(/\b1800000\b/);
    const note = entityHistory("deal", seed.dealId).find((h) => h.field === "merged_not_copied");
    expect(note?.new_value).toContain("$1,800,000");
    // Plain strings only: the history renderer JSON.parses and String()s a
    // value, so an object would read as [object Object].
    expect(note?.new_value).not.toContain("[object");
  });

  it("carries the history across without rewriting it", () => {
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    const resolved = entityHistoryFor("deal", [seed.dealId, ...mergedDealIds(seed.dealId)], 200);
    expect(resolved.some((h) => h.entity_id === local && h.field === "next_step")).toBe(true);
    // And the loser's own history still reads under the id it was made under.
    expect(entityHistory("deal", local).some((h) => h.field === "next_step")).toBe(true);
  });

  it("follows a chain and terminates", () => {
    const third = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: newLocalDealId(), name: "EHR Refresh (again)" },
      actorUserId: USER,
    }).entityId;
    mergeDeals({ accountId: seed.accountId, keeperId: local, loserId: third, actorUserId: USER });
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    expect(mergedDealIds(seed.dealId).sort()).toEqual([local, third].sort());
  });

  it("refuses to keep the local id over the CRM one", () => {
    // This is the direction that would have the real CRM id sitting on an
    // archived row — and the import reads archived rows, so the next report
    // would propose restoring it. Every time.
    expect(() =>
      mergeDeals({ accountId: seed.accountId, keeperId: local, loserId: seed.dealId, actorUserId: USER }),
    ).toThrow(/merge this deal into that one instead/);
  });

  it("refuses to merge two real CRM ids", () => {
    // Two CRM ids are two real opportunities, and merging them is worse than
    // wrong: the import follows merged_into, so from then on every report
    // line for the loser is redirected onto the keeper, and nothing anywhere
    // un-merges. The picker only offers a local and a CRM row, but the action
    // reads the id off the form, so the select was the only thing in the way.
    const secondCrm = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: "SYN-EXTRA-006", name: "EHR Refresh", stage: 2 },
      actorUserId: USER,
    }).entityId;
    expect(() =>
      mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: secondCrm, actorUserId: USER }),
    ).toThrow(/archive the one you do not want instead/);
  });

  it("rejects what was still proposed for the loser, even if it was archived first", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: local, actorUserId: USER });
    createProposalBatch(seed.accountId, { kind: "import", id: "doc-1", aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: local, payload: { stage: 4 }, rationale: null, source_ref: null },
    ]);
    const pending = () => (db().prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'`).get() as { n: number }).n;
    expect(pending()).toBe(1);
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    expect(pending()).toBe(0);
  });

  it("refuses a merged-away deal being restored", () => {
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    expect(() =>
      restoreEntity({ accountId: seed.accountId, entityType: "deal", entityId: local, actorUserId: USER }),
    ).toThrow(/merged into/);
    expect(listArchived(seed.accountId).deals.map((d) => d.id)).not.toContain(local);
  });

  it("leaves one deal in what a model reads", () => {
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    const pack = buildContextPack(seed.accountId);
    expect(pack.deals.map((d) => d.deal_id)).toEqual([seed.dealId]);
    expect(pack.plays[0]?.deal_ids).toEqual([seed.dealId]);
  });

  it("refuses the merges that make no sense", () => {
    expect(() => mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: seed.dealId, actorUserId: USER })).toThrow(/same deal/);
    expect(() => mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: "nope", actorUserId: USER })).toThrow(/not found/);
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    expect(() => mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER })).toThrow(/already been merged/);
  });

  it("suggests the pair without being asked", () => {
    expect(likelyDuplicateDeals(seed.accountId, seed.dealId).map((d) => d.deal_id)).toEqual([local]);
    // Two real CRM ids with the same name are two opportunities, not a
    // duplicate.
    const other = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: "SYN-EXTRA-009", name: "EHR Refresh" },
      actorUserId: USER,
    }).entityId;
    expect(likelyDuplicateDeals(seed.accountId, other).map((d) => d.deal_id)).toEqual([local]);
  });
});

describe("a deal's id cannot be edited", () => {
  it("refuses an update that carries a different one", () => {
    // It used to be skipped silently: success, no change, no history row.
    expect(() =>
      applyEntityChange({
        accountId: seed.accountId,
        entityType: "deal",
        op: "update",
        entityId: seed.dealId,
        payload: { deal_id: "somethingelse", next_step: "x" },
        actorUserId: USER,
      }),
    ).toThrow(/cannot be changed/);
    expect(dealRow(seed.dealId).next_step).not.toBe("x");
  });

  it("allows an update that carries its own id", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { deal_id: seed.dealId, next_step: "fine" },
      actorUserId: USER,
    });
    expect(dealRow(seed.dealId).next_step).toBe("fine");
  });
});

// The regression the archived-row refusal shipped with.
//
// Three of these loops relink archived rows on purpose — a play that was
// archived can be restored, and it would come back pointing at a merged-away
// id. The refusal added for stale forms threw on exactly those, inside the
// merge's transaction, so the whole merge rolled back with an error blaming a
// form nobody had open. The merge suite was green because it only ever
// archived the things being merged, never a play or meeting doing the linking.
describe("merging around records that were archived", () => {
  it("relinks a play that is archived, rather than refusing the whole merge", () => {
    const duplicate = applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Finley Example", org: "customer", email: "dana@example.com" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { contact_ids: [duplicate] },
      actorUserId: USER,
    });
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });

    const r = mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicate, actorUserId: USER });
    expect(r.playsRelinked).toBe(1);
    const play = db().prepare(`SELECT contact_ids_json FROM plays WHERE id = ?`).get(seed.playId) as { contact_ids_json: string };
    expect(JSON.parse(play.contact_ids_json)).toEqual([seed.contactId]);
  });

  it("rewrites an archived meeting's attendees too", () => {
    const duplicate = applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Finley Example", org: "customer" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "meeting",
      op: "update",
      entityId: seed.meetingId,
      payload: { attendees: [{ contact_id: duplicate, name: "Finley Example", note: null }] },
      actorUserId: USER,
    });
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });

    const r = mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: duplicate, actorUserId: USER });
    expect(r.meetingsRewritten).toBe(1);
  });

  it("merges two deals when an archived play links the loser", () => {
    const local = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: newLocalDealId(), name: "EHR Refresh" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { deal_ids: [local] },
      actorUserId: USER,
    });
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });

    const r = mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: local, actorUserId: USER });
    expect(r.playsRelinked).toBe(1);
  });
});
