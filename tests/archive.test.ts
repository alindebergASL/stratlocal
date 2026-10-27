import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { applyEntityChange, archiveEntity, createProposalBatch, restoreEntity } from "@/lib/proposals/apply";
import {
  listAccountSummaries,
  listArchivedAccounts,
  listContacts,
  listDeals,
  listDealOwners,
  listOpenDeals,
  listPendingProposals,
  listPlays,
} from "@/lib/queries/accounts";
import { entityLabels } from "@/lib/queries/labels";
import { listActionItems, listArchived, listMeetings } from "@/lib/queries/meetings";
import { listAttention } from "@/lib/queries/attention";
import { buildContextPack, evidenceIds } from "@/lib/meetings/contextPack";
import { search } from "@/lib/queries/search";
import { listMovement } from "@/lib/queries/movement";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { diffExtraction } from "@/lib/import/diffExtraction";
import type { AgentReportExtraction } from "@/lib/import/extractSchema";
import { seedAccount, USER, type Seed } from "./helpers";

const NOW = new Date("2026-09-12T12:00:00Z");

// Everything that must stop showing an archived record. A missed filter is a
// silent bug, so this enumerates the surfaces rather than trusting a review.
function visibility(seed: Seed, itemId: string) {
  const pack = buildContextPack(seed.accountId);
  const ids = evidenceIds(pack);
  const attention = listAttention(NOW);
  return {
    accountListed: listAccountSummaries().some((a) => a.id === seed.accountId),
    deal: listDeals(seed.accountId).some((d) => d.deal_id === seed.dealId),
    contact: listContacts(seed.accountId).some((c) => c.id === seed.contactId),
    play: listPlays(seed.accountId).some((p) => p.id === seed.playId),
    meeting: listMeetings(seed.accountId).some((m) => m.id === seed.meetingId),
    actionItem: listActionItems(seed.accountId).some((a) => a.id === itemId),
    pipeline: listOpenDeals().some((d) => d.deal_id === seed.dealId),
    dealOwners: listDealOwners(),
    packDeal: pack.deals.some((d) => d.deal_id === seed.dealId),
    packPlay: pack.plays.some((p) => p.id === seed.playId),
    packContact: pack.contacts.some((c) => c.id === seed.contactId),
    packActionItem: pack.open_action_items.some((a) => a.id === itemId),
    evidence: { deal: ids.has(seed.dealId), play: ids.has(seed.playId), contact: ids.has(seed.contactId), actionItem: ids.has(itemId) },
    attentionKinds: attention.map((a) => a.kind),
    attentionRefs: attention.map((a) => a.href),
    searchDeal: search("EHR Refresh").some((g) => g.kind === "deal"),
    searchContact: search("Finley").some((g) => g.kind === "contact"),
    searchPlay: search("platform defense").some((g) => g.kind === "play"),
    searchMeeting: search("Quarterly").some((g) => g.kind === "meeting"),
    searchAccount: search("Synthetic Orchard").some((g) => g.kind === "account"),
    // The read surface Phase 11 added. This object exists so that a missed
    // filter shows up everywhere at once rather than on the one screen
    // somebody happened to open, and three queries were added without being
    // added to it — which is the failure it was built to catch.
    //
    // Only `moved` is here. listStalled wants a deal with no change in the
    // window, and quarterRollUp wants one closing in the current quarter;
    // neither is true of this seed, so both would sit at false before and
    // after and prove nothing. A vacuous assertion is worse than a missing
    // one — this project has shipped two — so their archive filters are
    // asserted in tests/movement.test.ts, where the fixture can be shaped for
    // them.
    moved: listMovement(NOW.getTime() - 30 * 86_400_000).some((m) => m.dealId === seed.dealId),
  };
}

function seedEverything(): { seed: Seed; itemId: string } {
  const seed = seedAccount({ heldAt: "2026-09-15" });
  // Give each record a reason to appear on a list: an owner, a due date, an
  // empty next step in the current quarter.
  applyEntityChange({
    accountId: seed.accountId,
    entityType: "deal",
    op: "update",
    entityId: seed.dealId,
    payload: { owner: "Alex", fiscal_quarter: currentFiscalQuarter(NOW).label, next_step: null },
    actorUserId: USER,
  });
  applyEntityChange({
    accountId: seed.accountId,
    entityType: "play",
    op: "update",
    entityId: seed.playId,
    payload: { next_step: "Book the workshop", next_step_due: "2026-08-20" },
    actorUserId: USER,
  });
  const itemId = applyEntityChange({
    accountId: seed.accountId,
    entityType: "action_item",
    op: "create",
    payload: { text: "Send the sizing doc", due: "2026-09-01", status: "open" },
    actorUserId: USER,
  }).entityId;
  return { seed, itemId };
}

describe("archive hides a record everywhere at once", () => {
  beforeEach(() => resetDbForTests());

  it("every list surface shows the records while they are live", () => {
    const { seed, itemId } = seedEverything();
    const v = visibility(seed, itemId);
    expect(v).toMatchObject({
      accountListed: true,
      deal: true,
      contact: true,
      play: true,
      meeting: true,
      actionItem: true,
      pipeline: true,
      packDeal: true,
      packPlay: true,
      packContact: true,
      packActionItem: true,
      searchDeal: true,
      searchContact: true,
      searchPlay: true,
      searchMeeting: true,
      searchAccount: true,
      moved: true,
    });
    expect(v.dealOwners).toContain("Alex");
    expect(v.evidence).toEqual({ deal: true, play: true, contact: true, actionItem: true });
    expect(new Set(v.attentionKinds)).toEqual(new Set(["no_next_step", "overdue", "no_brief"]));
  });

  it("archiving each one removes it from every surface, and restoring brings it back", () => {
    const { seed, itemId } = seedEverything();
    const each = [
      { kind: "deal" as const, id: seed.dealId },
      { kind: "contact" as const, id: seed.contactId },
      { kind: "play" as const, id: seed.playId },
      { kind: "meeting" as const, id: seed.meetingId },
      { kind: "action_item" as const, id: itemId },
    ];
    for (const e of each) archiveEntity({ accountId: seed.accountId, entityType: e.kind, entityId: e.id, actorUserId: USER });

    const v = visibility(seed, itemId);
    expect(v).toMatchObject({
      deal: false,
      contact: false,
      play: false,
      meeting: false,
      actionItem: false,
      pipeline: false,
      packDeal: false,
      packPlay: false,
      packContact: false,
      packActionItem: false,
      searchDeal: false,
      searchContact: false,
      searchPlay: false,
      searchMeeting: false,
    });
    expect(v.dealOwners).not.toContain("Alex");
    expect(v.evidence).toEqual({ deal: false, play: false, contact: false, actionItem: false });
    expect(v.attentionKinds).toEqual([]);

    // The account itself still lists, and the archived block offers each back.
    expect(v.accountListed).toBe(true);
    const archived = listArchived(seed.accountId);
    expect(archived.deals.map((d) => d.id)).toEqual([seed.dealId]);
    expect(archived.contacts.map((c) => c.id)).toEqual([seed.contactId]);
    expect(archived.plays.map((p) => p.id)).toEqual([seed.playId]);
    expect(archived.meetings.map((m) => m.id)).toEqual([seed.meetingId]);
    expect(archived.action_items.map((a) => a.id)).toEqual([itemId]);

    for (const e of each) restoreEntity({ accountId: seed.accountId, entityType: e.kind, entityId: e.id, actorUserId: USER });
    const back = visibility(seed, itemId);
    expect(back).toMatchObject({ deal: true, contact: true, play: true, meeting: true, actionItem: true, pipeline: true });
    expect(new Set(back.attentionKinds)).toEqual(new Set(["no_next_step", "overdue", "no_brief"]));
  });

  it("archiving the account hides it and everything under it", () => {
    const { seed, itemId } = seedEverything();
    archiveEntity({ accountId: seed.accountId, entityType: "account", entityId: seed.accountId, actorUserId: USER });
    const v = visibility(seed, itemId);
    expect(v.accountListed).toBe(false);
    expect(v.pipeline).toBe(false);
    expect(v.dealOwners).toEqual([]);
    expect(v.attentionKinds).toEqual([]);
    expect(v.searchAccount).toBe(false);
    expect(v.searchDeal).toBe(false);
    expect(listArchivedAccounts().map((a) => a.id)).toEqual([seed.accountId]);
  });

  it("history survives and the record is still nameable", () => {
    const { seed } = seedEverything();
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER, day: "2026-09-12" });
    // A reference from before the archive must still render a name, not an id.
    expect(entityLabels(seed.accountId)[seed.dealId]).toBe("EHR Refresh");
    const log = db()
      .prepare(`SELECT * FROM change_log WHERE entity_type = 'deal' AND field = 'archived_at'`)
      .all() as Array<{ old_value: string | null; new_value: string | null }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.new_value).toBe('"2026-09-12"');
  });
});

describe("archive and proposals", () => {
  beforeEach(() => resetDbForTests());

  it("archiving a record rejects what was still proposed for it", () => {
    const { seed } = seedEverything();
    const batch = createProposalBatch(seed.accountId, { kind: "meeting", id: seed.meetingId, aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { stage: 5 } },
      { entity_type: "play", op: "update", entity_id: seed.playId, payload: { status: "won" } },
    ]);
    expect(listPendingProposals(seed.accountId)).toHaveLength(2);

    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER });
    const pending = listPendingProposals(seed.accountId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.entity_id).toBe(seed.playId);
    const rejected = db().prepare(`SELECT status FROM proposals WHERE id = ?`).get(batch.ids[0]) as { status: string };
    expect(rejected.status).toBe("rejected");
  });

  it("archiving an account rejects every proposal on it", () => {
    const { seed } = seedEverything();
    createProposalBatch(seed.accountId, { kind: "import", id: null, aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { stage: 5 } },
      { entity_type: "contact", op: "create", payload: { name: "Someone New", org: "customer" } },
    ]);
    archiveEntity({ accountId: seed.accountId, entityType: "account", entityId: seed.accountId, actorUserId: USER });
    expect(listPendingProposals(seed.accountId)).toHaveLength(0);
    expect(listAttention(NOW).filter((a) => a.kind === "proposals")).toHaveLength(0);
  });

  it("a proposal may restore a record but never archive one", () => {
    const { seed } = seedEverything();
    expect(() =>
      createProposalBatch(seed.accountId, { kind: "import", id: null, aiRunId: null }, [
        { entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { archived_at: "2026-09-12" } },
      ]),
    ).toThrow(/cannot be set by a proposal/);

    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER });
    const restore = createProposalBatch(seed.accountId, { kind: "import", id: null, aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: seed.dealId, payload: { archived_at: null } },
    ]);
    expect(restore.ids).toHaveLength(1);
  });
});

describe("re-importing a report that still lists an archived record", () => {
  beforeEach(() => resetDbForTests());

  function extraction(seed: Seed): AgentReportExtraction {
    return {
      account: { name: "Synthetic Orchard Lab", crm_id: null, legal_entity: null, region: "Central", segment: null, hq: null, summary: null },
      team: [{ name: "Finley Example", email: null, role: "it_leader", title: null }],
      deals: [
        {
          deal_id: seed.dealId,
          name: "EHR Refresh",
          stage: 4,
          stage_label: null,
          close_date: "2026-12-01",
          fiscal_quarter: null,
          tcv_usd: 1000,
          competitor: null,
          partner: null,
          owner: null,
          architecture: null,
        },
      ],
      install_base: [],
      plays: [{ title: "EHR platform defense", thesis: null, deal_ids: [seed.dealId], stakeholders: [], next_step: null }],
      kpis: [],
    };
  }

  function state(seed: Seed) {
    return {
      account: db().prepare(`SELECT * FROM accounts WHERE id = ?`).get(seed.accountId) as never,
      deals: listDeals(seed.accountId, { includeArchived: true }),
      contacts: listContacts(seed.accountId, { includeArchived: true }),
      plays: listPlays(seed.accountId, { includeArchived: true }),
      installBaseAtAsOf: [],
    };
  }

  it("proposes restoring the deal, contact and play rather than duplicating them", () => {
    const seed = seedAccount();
    for (const e of [
      { kind: "deal" as const, id: seed.dealId },
      { kind: "contact" as const, id: seed.contactId },
      { kind: "play" as const, id: seed.playId },
    ]) {
      archiveEntity({ accountId: seed.accountId, entityType: e.kind, entityId: e.id, actorUserId: USER });
    }

    const drafts = diffExtraction(extraction(seed), state(seed), { documentId: "doc-1", asOf: "2026-09-12" });
    const byType = Object.fromEntries(drafts.map((d) => [d.entity_type, d]));
    expect(byType.deal).toMatchObject({ op: "update", entity_id: seed.dealId, payload: { stage: 4, archived_at: null } });
    expect(byType.contact).toMatchObject({ op: "update", entity_id: seed.contactId, payload: { archived_at: null } });
    expect(byType.play).toMatchObject({ op: "update", entity_id: seed.playId, payload: { archived_at: null } });
    expect(drafts.some((d) => d.op === "create")).toBe(false);

    // And the batch applies cleanly, which a create for an existing deal_id would not.
    const batch = createProposalBatch(seed.accountId, { kind: "import", id: "doc-1", aiRunId: null }, drafts);
    expect(batch.ids.length).toBe(drafts.length);
  });

  it("a live account's ordinary update carries no archived_at, so the dedupe still works", () => {
    const seed = seedAccount();
    const drafts = diffExtraction(extraction(seed), state(seed), { documentId: "doc-1", asOf: "2026-09-12" });
    const deal = drafts.find((d) => d.entity_type === "deal")!;
    expect(deal.payload).toEqual({ stage: 4 });
  });
});

describe("a play keeps its link to an archived deal", () => {
  beforeEach(() => resetDbForTests());

  it("the stored link survives, but the pack does not offer the id to the model", () => {
    const seed = seedAccount();
    archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER });

    const stored = db().prepare(`SELECT deal_ids_json FROM plays WHERE id = ?`).get(seed.playId) as { deal_ids_json: string };
    expect(JSON.parse(stored.deal_ids_json)).toEqual([seed.dealId]);

    const pack = buildContextPack(seed.accountId);
    expect(pack.plays[0]!.deal_ids).toEqual([]);
  });
});
