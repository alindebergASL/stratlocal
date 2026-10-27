import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { applyEntityChange, archiveEntity, createProposalBatch } from "@/lib/proposals/apply";
import { buildContextPack, evidenceIds, evidenceIndex } from "@/lib/meetings/contextPack";
import { getAccount, listContacts, listDeals, listPlays } from "@/lib/queries/accounts";
import { checkPlanDraft } from "@/lib/plan/draft";
import { diffPlanDraft, type PlanState } from "@/lib/plan/diffPlanDraft";
import type { PlanDraft } from "@/lib/plan/schema";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

function state(): PlanState {
  return {
    account: getAccount(seed.accountId)!,
    // Archived plays on purpose: matching a hidden row is the point.
    plays: listPlays(seed.accountId, { includeArchived: true }),
    liveDealIds: new Set(listDeals(seed.accountId).map((d) => d.deal_id)),
    liveContactIds: new Set(listContacts(seed.accountId).map((c) => c.id)),
  };
}

function play(over: Partial<PlanDraft["plays"][number]> = {}): PlanDraft["plays"][number] {
  return {
    title: "A brand new play",
    thesis: "Worth doing because the records say so.",
    next_step: "Agree an owner",
    owner_suggestion: null,
    linked_deal_ids: [],
    linked_contact_ids: [],
    source_refs: [{ kind: "deal", id: seed.dealId }],
    ...over,
  };
}

function draft(over: Partial<PlanDraft> = {}): PlanDraft {
  return {
    thesis: "A fresh read on the account.",
    plays: [play(), play({ title: "Two" }), play({ title: "Three" })],
    ...over,
  };
}

describe("what a plan draft may cite", () => {
  it("accepts ids from the pack", () => {
    const ids = evidenceIndex(buildContextPack(seed.accountId));
    expect(
      checkPlanDraft(
        draft({
          plays: [
            play({
              linked_deal_ids: [seed.dealId],
              linked_contact_ids: [seed.contactId],
            }),
          ],
        }),
        ids,
      ),
    ).toEqual([]);
  });

  it("rejects an invented deal or contact id", () => {
    const ids = evidenceIndex(buildContextPack(seed.accountId));
    const findings = checkPlanDraft(
      draft({
        plays: [play({ linked_deal_ids: ["SYN-EXTRA-010"], linked_contact_ids: ["nope"] })],
      }),
      ids,
    );
    expect(findings.map((f) => f.path)).toEqual(["plays[0].linked_deal_ids[0]", "plays[0].linked_contact_ids[0]"]);
    expect(findings[0]!.message).toContain("not a record id you were given");
  });

  it("rejects two plays with the same title", () => {
    // One would create the play and the other would update the row the first
    // one just made, which is nobody's idea of a plan.
    const ids = evidenceIndex(buildContextPack(seed.accountId));
    const findings = checkPlanDraft(draft({ plays: [play({ title: "Same" }), play({ title: "same" })] }), ids);
    expect(findings.map((f) => f.path)).toEqual(["plays[1].title"]);
  });
});

describe("turning a draft into proposals", () => {
  it("creates a play at proposed, and never at any other status", () => {
    const drafts = diffPlanDraft(draft({ plays: [play({ linked_deal_ids: [seed.dealId] })] }), state());
    const created = drafts.find((d) => d.entity_type === "play" && d.op === "create");
    expect(created!.payload).toMatchObject({
      title: "A brand new play",
      status: "proposed",
      deal_ids: [seed.dealId],
    });
  });

  it("updates a play whose title matches, rather than creating a second one", () => {
    const existing = listPlays(seed.accountId)[0]!;
    const drafts = diffPlanDraft(
      draft({
        plays: [
          play({
            title: existing.title.toUpperCase(),
            thesis: "A different argument.",
          }),
        ],
      }),
      state(),
    );
    const plays = drafts.filter((d) => d.entity_type === "play");
    expect(plays).toHaveLength(1);
    expect(plays[0]).toMatchObject({ op: "update", entity_id: existing.id });
    expect(plays[0]!.payload).toMatchObject({
      thesis: "A different argument.",
    });
  });

  it("never proposes a status on an update", () => {
    // PlayStatus includes "dropped", and createProposalBatch only blocks
    // archived_at — so a proposed status would be archiving by another name.
    const existing = listPlays(seed.accountId)[0]!;
    const drafts = diffPlanDraft(draft({ plays: [play({ title: existing.title, thesis: "New." })] }), state());
    for (const d of drafts) expect(Object.keys(d.payload)).not.toContain("status");
  });

  it("leaves archived_at out of an ordinary update", () => {
    // Adding the key unconditionally would change every update's payload
    // bytes and weaken the rejected-draft dedupe.
    const existing = listPlays(seed.accountId)[0]!;
    const drafts = diffPlanDraft(draft({ plays: [play({ title: existing.title, thesis: "New." })] }), state());
    expect(Object.keys(drafts.find((d) => d.entity_type === "play")!.payload)).not.toContain("archived_at");
  });

  it("restores an archived play the plan still calls for", () => {
    const existing = listPlays(seed.accountId)[0]!;
    archiveEntity({
      accountId: seed.accountId,
      entityType: "play",
      entityId: existing.id,
      actorUserId: USER,
    });
    const drafts = diffPlanDraft(
      draft({
        plays: [play({ title: existing.title, thesis: "Still worth doing." })],
      }),
      state(),
    );
    const update = drafts.find((d) => d.entity_type === "play")!;
    expect(update).toMatchObject({ op: "update", entity_id: existing.id });
    expect(update.payload).toMatchObject({ archived_at: null });
  });

  it("drops a link to a record that is not live", () => {
    // assertLinkedIds throws at accept time for an unknown id, which would
    // fail the whole proposal rather than just losing the link.
    archiveEntity({
      accountId: seed.accountId,
      entityType: "deal",
      entityId: seed.dealId,
      actorUserId: USER,
    });
    const drafts = diffPlanDraft(
      draft({
        plays: [play({ title: "New one", linked_deal_ids: [seed.dealId] })],
      }),
      state(),
    );
    expect(drafts.find((d) => d.op === "create")!.payload.deal_ids).toEqual([]);
  });

  it("proposes the thesis only when it differs", () => {
    const first = diffPlanDraft(draft(), state());
    expect(first.filter((d) => d.entity_type === "account")).toHaveLength(1);
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "account",
      op: "update",
      entityId: seed.accountId,
      payload: { thesis: "A fresh read on the account." },
      actorUserId: USER,
    });
    expect(diffPlanDraft(draft(), state()).filter((d) => d.entity_type === "account")).toHaveLength(0);
  });

  it("produces nothing at all when the account already matches the draft", () => {
    const drafts = diffPlanDraft(draft({ plays: [] }), state());
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "account",
      op: "update",
      entityId: seed.accountId,
      payload: { thesis: "A fresh read on the account." },
      actorUserId: USER,
    });
    expect(drafts).toHaveLength(1);
    expect(diffPlanDraft(draft({ plays: [] }), state())).toEqual([]);
  });

  it("survives a batch where every field is at its schema maximum", () => {
    // createProposalBatch parses every draft in one transaction with no
    // per-draft try, so one over-long field would take the whole batch down.
    const long = (n: number) => "x".repeat(n);
    const big = draft({
      thesis: long(1500),
      plays: [
        play({
          title: long(120),
          thesis: long(1200),
          next_step: long(300),
          owner_suggestion: long(120),
        }),
        play({
          title: `b${long(119)}`,
          thesis: long(1200),
          next_step: long(300),
          owner_suggestion: long(120),
        }),
      ],
    });
    const drafts = diffPlanDraft(big, state());
    expect(() => createProposalBatch(seed.accountId, { kind: "plan_draft", id: null, aiRunId: null }, drafts)).not.toThrow();
  });
});
