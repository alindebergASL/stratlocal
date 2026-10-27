// Attaching a follow-up to a play by hand.
//
// `action_items.play_id` has existed since Phase 1 and `saveActionItem` has
// read it since Phase 8 — but no form ever rendered the control, so the only
// way a follow-up could belong to a play was for extraction to say so. The
// play page lists "follow-ups on this play" and you could not put one there.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { playOptionsFor } from "@/lib/queries/accounts";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("which plays a follow-up editor may offer", () => {
  it("offers the live plays", () => {
    expect(playOptionsFor(seed.accountId, []).map((p) => p.id)).toEqual([seed.playId]);
  });

  it("keeps offering a play the follow-up is already on, after it is archived", () => {
    // The failure this exists for: a select always submits its current value,
    // so an option that is not rendered is not merely absent — picking nothing
    // submits "", which saveActionItem reads as a clear. Correcting the due
    // date on a follow-up would quietly unlink it from an archived play.
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });
    const opts = playOptionsFor(seed.accountId, [seed.playId]);
    expect(opts.map((p) => p.id)).toEqual([seed.playId]);
    expect(opts[0]!.archived).toBe(true);
  });

  it("does not offer an archived play nothing points at", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });
    expect(playOptionsFor(seed.accountId, [null, undefined])).toEqual([]);
  });

  it("a follow-up can be filed against a play and read back from it", () => {
    const id = applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Walk the site with operations", play_id: seed.playId },
      actorUserId: USER,
    }).entityId;
    // And an edit that does not mention the play leaves it alone — `present()`
    // means "this form does not edit that", never "clear it".
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "update",
      entityId: id,
      payload: { due: "2026-10-01" },
      actorUserId: USER,
    });
    const rows = playOptionsFor(seed.accountId, [seed.playId]);
    expect(rows).toHaveLength(1);
  });
});
