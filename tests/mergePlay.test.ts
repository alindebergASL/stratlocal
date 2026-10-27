// Two rows for one play, and the thing that makes a play merge different from
// a contact merge: both importers match a play by normalised title against
// archived rows too. Archive the loser and nothing else, and the next report
// proposes restoring it — one Accept all and the duplicate is back, forever.
// That is the Phase 6 deal lesson, and these are the tests that hold it.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type ActionItemRow, type PlayRow } from "@/lib/db";
import { applyEntityChange, archiveEntity, createProposalBatch, restoreEntity } from "@/lib/proposals/apply";
import { mergePlays, previewPlayMerge } from "@/lib/proposals/merge";
import { entityHistory, entityHistoryFor, likelyDuplicatePlays, listPlays, mergedPlayIds } from "@/lib/queries/accounts";
import { listArchived } from "@/lib/queries/meetings";
import { diffExtraction, type AccountState } from "@/lib/import/diffExtraction";
import { diffPlanDraft, type PlanState } from "@/lib/plan/diffPlanDraft";
import type { AgentReportExtraction } from "@/lib/import/extractSchema";
import type { PlanDraft } from "@/lib/plan/schema";
import { playKeeperOf } from "@/lib/playKeeper";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;
/** The second row for the same play — the one that will be merged away. */
let loserId: string;

function play(id: string): PlayRow {
  return db().prepare(`SELECT * FROM plays WHERE id = ?`).get(id) as PlayRow;
}
function items(accountId: string): ActionItemRow[] {
  return db().prepare(`SELECT * FROM action_items WHERE account_id = ?`).all(accountId) as ActionItemRow[];
}

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
  // The keeper (seed.playId) is "EHR platform defense", active, linked to the
  // seeded deal. The loser carries what the keeper does not: a thesis, an
  // owner, a next step, and the person.
  loserId = applyEntityChange({
    accountId: seed.accountId,
    entityType: "play",
    op: "create",
    payload: {
      title: "EHR Platform Defense",
      status: "proposed",
      thesis: "Hold the platform through the refresh",
      owner: "Avery Example",
      next_step: "Book the architecture review",
      contact_ids: [seed.contactId],
    },
    actorUserId: USER,
  }).entityId;
});

describe("merging two rows for one play", () => {
  it("moves the links, the follow-ups and the blanks, and archives the loser", () => {
    const followUp = applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the architecture pack", play_id: loserId },
      actorUserId: USER,
    }).entityId;

    const result = mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER });

    expect(result.keeperId).toBe(seed.playId);
    const keeper = play(seed.playId);
    // The links are the union of both, not the keeper's alone: two rows for
    // one play legitimately link different records, and dropping the loser's
    // is the silent loss this app is built not to do.
    expect(JSON.parse(keeper.deal_ids_json)).toEqual([seed.dealId]);
    expect(JSON.parse(keeper.contact_ids_json)).toEqual([seed.contactId]);
    // Blanks filled from the loser, and nothing overwritten.
    expect(keeper.thesis).toBe("Hold the platform through the refresh");
    expect(keeper.owner).toBe("Avery Example");
    expect(keeper.next_step).toBe("Book the architecture review");
    // Every field the merge changed on the keeper, the unioned link included —
    // the links are a change to the keeper like any other.
    expect(result.fieldsFilled.sort()).toEqual(["contact_ids", "next_step", "owner", "thesis"]);
    // The keeper's own status is not touched by a row that disagreed with it.
    expect(keeper.status).toBe("active");
    expect(result.notCopied.join(" ")).toContain("proposed");

    expect(items(seed.accountId).find((i) => i.id === followUp)?.play_id).toBe(seed.playId);
    expect(result.followUpsRelinked).toBe(1);

    expect(play(loserId).archived_at).not.toBeNull();
    expect(play(loserId).merged_into).toBe(seed.playId);
    expect(listPlays(seed.accountId).map((p) => p.id)).toEqual([seed.playId]);
  });

  it("refuses the ways a merge would lose something", () => {
    expect(() => mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: seed.playId, actorUserId: USER })).toThrow(
      /same play/i,
    );
    const other = seedAccount({ name: "Other Synthetic Account", dealId: "SYN-DEAL-900" });
    expect(() => mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: other.playId, actorUserId: USER })).toThrow(
      /same account/i,
    );
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });
    expect(() => mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER })).toThrow(/archived/i);
  });

  it("rejects what was still proposed for the loser, including when it was archived by hand first", () => {
    // Archiving by hand was the only workaround before this existed, so it is
    // the likeliest input — and archiveEntity's own rejection never runs then.
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: loserId, actorUserId: USER });
    const batch = createProposalBatch(seed.accountId, { kind: "plan_draft", id: "run-1", aiRunId: null }, [
      { entity_type: "play", op: "update", entity_id: loserId, payload: { next_step: "Something proposed" }, rationale: "x", source_ref: null },
    ]);
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER });
    const status = db().prepare(`SELECT status FROM proposals WHERE id = ?`).pluck().get(batch.ids[0]!);
    expect(status).toBe("rejected");
  });

  it("is a tombstone, not something to restore", () => {
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER });
    // Restoring would put back a play whose follow-ups and links now answer to
    // the keeper — half a play. Refused in the apply path, so no caller can go
    // round it, and gone from the block that would otherwise offer the button.
    expect(() => restoreEntity({ accountId: seed.accountId, entityType: "play", entityId: loserId, actorUserId: USER })).toThrow(
      /merged into/i,
    );
    expect(listArchived(seed.accountId).plays.map((p) => p.id)).not.toContain(loserId);
  });

  it("history resolves across the pair, and the loser's own rows still read under its id", () => {
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER });
    expect(mergedPlayIds(seed.playId)).toEqual([loserId]);
    const both = entityHistoryFor("play", [seed.playId, ...mergedPlayIds(seed.playId)], 200);
    expect(both.some((h) => h.entity_id === loserId)).toBe(true);
    expect(both.some((h) => h.field === "merged_from")).toBe(true);
    expect(entityHistory("play", loserId, 50).some((h) => h.field === "merged_into")).toBe(true);
  });

  it("offers the duplicate by title, and stops offering it once merged", () => {
    expect(likelyDuplicatePlays(seed.accountId, seed.playId).map((p) => p.id)).toEqual([loserId]);
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER });
    expect(likelyDuplicatePlays(seed.accountId, seed.playId)).toEqual([]);
  });
});

// ---- the one that matters ---------------------------------------------------

const account = {
  id: "acct-1",
  name: "Synthetic Orchard Lab",
  crm_id: null,
  legal_entity: null,
  region: "Central",
  segment: null,
  hq: null,
  thesis: null,
  created_at: 0,
  updated_at: 0,
};

function playRow(over: Partial<PlayRow> & { id: string; title: string }): PlayRow {
  return {
    account_id: "acct-1",
    thesis: null,
    status: "active",
    owner: null,
    next_step: null,
    next_step_due: null,
    deal_ids_json: "[]",
    contact_ids_json: "[]",
    sort_order: 0,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
    merged_into: null,
    ...over,
  };
}

/** The keeper and the tombstone that was merged into it, sharing a title. */
function mergedPair(): PlayRow[] {
  return [
    playRow({ id: "keeper", title: "EHR Platform Defense" }),
    playRow({ id: "loser", title: "EHR platform defense", archived_at: "2026-09-18", merged_into: "keeper" }),
  ];
}

describe("a merged-away play is not resurrected by an import", () => {
  const extraction = {
    account: { name: "Synthetic Orchard Lab", crm_id: null, legal_entity: null, region: null, segment: null, hq: null, summary: null },
    team: [],
    deals: [],
    install_base: [],
    plays: [{ title: "EHR platform defense", thesis: "Win the refresh", deal_ids: [], stakeholders: [], next_step: null }],
    kpis: [],
  } as unknown as AgentReportExtraction;

  // Both orders, because the title map keeps whichever row it saw last: the
  // walk has to land on the keeper either way.
  for (const [label, plays] of [
    ["tombstone last", mergedPair()],
    ["tombstone first", [...mergedPair()].reverse()],
  ] as const) {
    it(`redirects the report's title match to the keeper (${label})`, () => {
      const state: AccountState = { account, deals: [], contacts: [], plays, installBaseAtAsOf: [] };
      const drafts = diffExtraction(extraction, state, { documentId: "doc-1", asOf: "2026-09-18" });
      const playDrafts = drafts.filter((d) => d.entity_type === "play");
      // Nothing is created, and above all nothing offers to un-archive the
      // tombstone: that is the restore Accept all would press.
      expect(playDrafts.every((d) => d.op !== "create")).toBe(true);
      expect(playDrafts.every((d) => d.entity_id !== "loser")).toBe(true);
      expect(drafts.every((d) => (d.payload as Record<string, unknown>).archived_at !== null)).toBe(true);
    });
  }

  it("proposes nothing when the keeper is not in the list at all", () => {
    // A pointer that leads nowhere: silence beats resurrection.
    const state: AccountState = {
      account,
      deals: [],
      contacts: [],
      plays: [playRow({ id: "loser", title: "EHR platform defense", archived_at: "2026-09-18", merged_into: "gone" })],
      installBaseAtAsOf: [],
    };
    const drafts = diffExtraction(extraction, state, { documentId: "doc-1", asOf: "2026-09-18" });
    expect(drafts.filter((d) => d.entity_type === "play")).toEqual([]);
  });
});

describe("a merged-away play is not resurrected by a plan draft", () => {
  const draft = {
    thesis: null,
    plays: [
      {
        title: "EHR platform defense",
        thesis: "Win the refresh",
        linked_deal_ids: [],
        linked_contact_ids: [],
        next_step: null,
        owner_suggestion: null,
        source_refs: [],
      },
    ],
  } as unknown as PlanDraft;

  for (const [label, plays] of [
    ["tombstone last", mergedPair()],
    ["tombstone first", [...mergedPair()].reverse()],
  ] as const) {
    it(`redirects the drafted title match to the keeper (${label})`, () => {
      const state: PlanState = { account, plays, liveDealIds: new Set(), liveContactIds: new Set() };
      const drafts = diffPlanDraft(draft, state);
      const playDrafts = drafts.filter((d) => d.entity_type === "play");
      expect(playDrafts.every((d) => d.op !== "create")).toBe(true);
      expect(playDrafts.every((d) => d.entity_id !== "loser")).toBe(true);
      expect(drafts.every((d) => (d.payload as Record<string, unknown>).archived_at !== null)).toBe(true);
    });
  }
});

// ---- the walk's own guards, checked rather than assumed ---------------------

describe("playKeeperOf survives data it should never see", () => {
  it("refuses a cycle rather than looping forever", () => {
    // A→B→A cannot be produced by mergePlays, which refuses a keeper that is
    // already merged away. It can be produced by a bad hand edit, and this
    // runs on a diff somebody is waiting for.
    const rows = [
      playRow({ id: "a", title: "Shared title", merged_into: "b" }),
      playRow({ id: "b", title: "Shared title", merged_into: "a" }),
    ];
    expect(playKeeperOf(rows, rows[0])).toBeUndefined();
  });

  it("refuses a chain longer than the depth cap", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      playRow({ id: `p${i}`, title: "Shared title", merged_into: i < 29 ? `p${i + 1}` : null }),
    );
    expect(playKeeperOf(rows, rows[0])).toBeUndefined();
    // Within the cap it still resolves, so the guard is a cap and not a ban.
    expect(playKeeperOf(rows, rows[25])?.id).toBe("p29");
  });

  it("refuses a row that points at itself", () => {
    const rows = [playRow({ id: "a", title: "Shared title", merged_into: "a" })];
    expect(playKeeperOf(rows, rows[0])).toBeUndefined();
  });

  it("returns a live match unchanged", () => {
    const rows = [playRow({ id: "a", title: "Shared title" })];
    expect(playKeeperOf(rows, rows[0])?.id).toBe("a");
    expect(playKeeperOf(rows, undefined)).toBeUndefined();
  });
});

// ---- the release-review finding: a union compared by length ------------------

// A keeper's stored links are schema-valid with the same id in them twice —
// nothing has ever deduped what was already written — and the union was
// compared against that raw array by *length*. One existing duplicate
// cancelled out one genuinely new link: two ids either way, no patch, and the
// other row's deal was dropped while its record was archived as merged. The
// loss is invisible from every screen, which is why these count membership.
describe("a keeper whose own links already hold a duplicate", () => {
  it("carries the loser's deal and person across an equal-length union", () => {
    const otherDeal = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: "SYN-DEAL-002", name: "Network refresh", stage: 2 },
      actorUserId: USER,
    }).entityId;
    const otherContact = applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Avery Example", org: "customer" },
      actorUserId: USER,
    }).entityId;
    // [A, A] on the keeper and [B] on the loser: the union is [A, B], which is
    // two ids either way.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { deal_ids: [seed.dealId, seed.dealId], contact_ids: [seed.contactId, seed.contactId] },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: loserId,
      payload: { deal_ids: [otherDeal], contact_ids: [otherContact] },
      actorUserId: USER,
    });

    // What the screen promises before the press, from the same plan the merge
    // applies.
    const preview = previewPlayMerge({ accountId: seed.accountId, keeperId: seed.playId, loserId });
    expect(preview.ok).toBe(true);
    expect(preview.ok && preview.preview.dealsAdded).toBe(1);
    expect(preview.ok && preview.preview.peopleAdded).toBe(1);

    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER });
    const keeper = play(seed.playId);
    expect(JSON.parse(keeper.deal_ids_json ?? "[]")).toEqual([seed.dealId, otherDeal]);
    expect(JSON.parse(keeper.contact_ids_json ?? "[]")).toEqual([seed.contactId, otherContact]);
  });

  it("changes nothing when the loser names only what the keeper already links", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: seed.playId,
      payload: { deal_ids: [seed.dealId, seed.dealId], contact_ids: [seed.contactId, seed.contactId] },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "play",
      op: "update",
      entityId: loserId,
      payload: { deal_ids: [seed.dealId], contact_ids: [seed.contactId] },
      actorUserId: USER,
    });

    const preview = previewPlayMerge({ accountId: seed.accountId, keeperId: seed.playId, loserId });
    expect(preview.ok && preview.preview.dealsAdded).toBe(0);
    expect(preview.ok && preview.preview.peopleAdded).toBe(0);
    expect(preview.ok && preview.preview.fieldsFilled).not.toContain("deal_ids");

    const result = mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId, actorUserId: USER });
    expect(result.fieldsFilled).not.toContain("deal_ids");
    expect(result.fieldsFilled).not.toContain("contact_ids");
    // Nothing to add is not a licence to rewrite what was there.
    expect(JSON.parse(play(seed.playId).deal_ids_json ?? "[]")).toEqual([seed.dealId, seed.dealId]);
  });
});
