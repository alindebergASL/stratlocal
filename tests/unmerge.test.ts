// SYNTHETIC ONLY.
//
// Undoing a merge. Each merge now leaves a receipt — the before and after of
// every column it changed, on every row it touched — and undoing it puts back
// what still holds what the merge wrote, and names what somebody has changed
// since instead of overwriting it.
//
// The strongest claim is the first one, made for all four kinds of record:
// merge, undo, and every row on the account reads exactly as it did before
// the merge, bar the version stamp.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { mergeContacts, mergeDeals, mergeMeetings, mergePlays } from "@/lib/proposals/merge";
import { listMergeReceipts, previewUnmerge, unmerge } from "@/lib/proposals/unmerge";
import { entityHistory } from "@/lib/queries/accounts";
import { accountRevision } from "@/lib/queries/freshness";
import { isNewerRevision } from "@/lib/freshness";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;
beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

const TABLES = ["contacts", "deals", "plays", "meetings", "action_items", "proposals"] as const;
function state(accountId: string) {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    out[t] = (db().prepare(`SELECT * FROM ${t} WHERE account_id = ? ORDER BY rowid`).all(accountId) as Record<string, unknown>[]).map(({ updated_at: _u, ...rest }) => rest);
  }
  return out;
}
const create = (entityType: "contact" | "deal" | "play" | "meeting" | "action_item", payload: Record<string, unknown>) =>
  applyEntityChange({ accountId: seed.accountId, entityType, op: "create", payload, actorUserId: USER }).entityId;
const pendingFor = (entity_type: "contact" | "deal" | "play" | "meeting", entity_id: string, payload: Record<string, unknown>) =>
  createProposalBatch(seed.accountId, { kind: "meeting", id: seed.meetingId, aiRunId: null }, [{ entity_type, op: "update", entity_id, payload, rationale: "synthetic" }]).ids[0]!;
const only = () => {
  const r = listMergeReceipts(seed.accountId);
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe("merge, undo, and the account is as it was", () => {
  it("for two people", () => {
    const loser = create("contact", { name: "Avery Example", org: "customer", email: "avery@example.test" });
    create("play", { title: "Second play", status: "proposed", contact_ids: [loser, seed.contactId] });
    applyEntityChange({ accountId: seed.accountId, entityType: "meeting", op: "update", entityId: seed.meetingId, payload: { attendees: [{ contact_id: loser, name: "Avery Example", note: null }] }, actorUserId: USER });
    pendingFor("contact", loser, { title: "Synthetic title" });
    const before = state(seed.accountId);
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: loser, actorUserId: USER });
    expect(state(seed.accountId)).not.toEqual(before);
    const r = unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    expect(r.keptAsIs).toEqual([]);
    expect(state(seed.accountId)).toEqual(before);
  });

  it("for two deals", () => {
    const loser = create("deal", { name: "EHR Refresh (local copy)", stage: 2, next_step: "Book the review", partner: "Synthetic Partner" });
    create("play", { title: "Second play", status: "proposed", deal_ids: [loser] });
    pendingFor("deal", loser, { stage: 4 });
    const before = state(seed.accountId);
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: loser, actorUserId: USER });
    unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    expect(state(seed.accountId)).toEqual(before);
  });

  it("for two plays", () => {
    const loser = create("play", { title: "EHR Platform Defense", status: "proposed", thesis: "Hold the platform", owner: "Avery Example" });
    create("action_item", { text: "Send the architecture pack", play_id: loser });
    pendingFor("play", loser, { status: "active" });
    const before = state(seed.accountId);
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser, actorUserId: USER });
    unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    expect(state(seed.accountId)).toEqual(before);
  });

  it("for two meetings, notes included, however long", () => {
    applyEntityChange({ accountId: seed.accountId, entityType: "meeting", op: "update", entityId: seed.meetingId, payload: { raw_notes: "k".repeat(6000) }, actorUserId: USER });
    const loser = create("meeting", { title: "Same call, other notes", held_at: "2026-09-15", attendees: [], raw_notes: "l".repeat(6000), summary: "Funded." });
    create("action_item", { text: "Send the sizing", meeting_id: loser });
    const before = state(seed.accountId);
    mergeMeetings({ accountId: seed.accountId, keeperId: seed.meetingId, loserId: loser, actorUserId: USER });
    unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    expect(state(seed.accountId)).toEqual(before);
  });
});

describe("what somebody changed since is theirs", () => {
  it("leaves a later edit where it is, names it, and still restores the rest", () => {
    const third = create("play", { title: "A third play", status: "proposed" });
    const loser = create("play", { title: "EHR Platform Defense", status: "proposed" });
    const item = create("action_item", { text: "Send the architecture pack", play_id: loser });
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser, actorUserId: USER });
    // After the merge, somebody moves the follow-up to a third play.
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "update", entityId: item, payload: { play_id: third }, actorUserId: USER });

    const receipt = only();
    const preview = previewUnmerge({ accountId: seed.accountId, receiptId: receipt.id });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.keptAsIs).toHaveLength(1);
    expect(preview.keptAsIs[0]).toMatch(/Follow-up “Send the architecture pack”: .*changed since/);

    const done = unmerge({ accountId: seed.accountId, receiptId: receipt.id, actorUserId: USER });
    // The preview and the undo are one computation.
    expect(done.restored).toBe(preview.restores);
    expect(done.keptAsIs).toEqual(preview.keptAsIs);
    const row = (t: string, id: string) => db().prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id) as Record<string, unknown>;
    expect(row("action_items", item).play_id).toBe(third);
    expect(row("plays", loser).archived_at).toBeNull();
    expect(row("plays", loser).merged_into).toBeNull();
  });

  it("puts nothing back twice, and refuses another account's merge", () => {
    const loser = create("play", { title: "EHR Platform Defense", status: "proposed" });
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser, actorUserId: USER });
    const id = only().id;
    const other = seedAccount({ name: "Another Synthetic", dealId: "SYN-DEAL-777" });
    expect(() => unmerge({ accountId: other.accountId, receiptId: id, actorUserId: USER })).toThrow(/not on this account/);
    unmerge({ accountId: seed.accountId, receiptId: id, actorUserId: USER });
    expect(() => unmerge({ accountId: seed.accountId, receiptId: id, actorUserId: USER })).toThrow(/already been undone/);
    expect(listMergeReceipts(seed.accountId)).toEqual([]);
  });
});

describe("an undo is a write like any other", () => {
  it("says so on both records, with who did it, and moves the Refresh notice", () => {
    const loser = create("play", { title: "EHR Platform Defense", status: "proposed" });
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser, actorUserId: USER });
    const rev = accountRevision(seed.accountId);
    unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    for (const id of [seed.playId, loser]) {
      const line = entityHistory("play", id, 50).find((h) => h.field === "unmerged") as unknown as { actor_user_id: string } | undefined;
      expect(line?.actor_user_id).toBe(USER);
    }
    expect(isNewerRevision(accountRevision(seed.accountId), rev)).toBe(true);
  });

  it("leaves no receipt for a merge that was refused", () => {
    expect(() => mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: seed.playId, actorUserId: USER })).toThrow();
    expect(listMergeReceipts(seed.accountId)).toEqual([]);
  });

  it("lets the undone record be merged again, and that merge be undone", () => {
    const loser = create("play", { title: "EHR Platform Defense", status: "proposed" });
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser, actorUserId: USER });
    unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    const before = state(seed.accountId);
    mergePlays({ accountId: seed.accountId, keeperId: seed.playId, loserId: loser, actorUserId: USER });
    unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    expect(state(seed.accountId)).toEqual(before);
  });
});

// An independent read of the first version found each of these. Each test
// failed against that version.
describe("what the review of un-merge found", () => {
  it("does not write to a record that has moved to another account since", async () => {
    const { moveDeal } = await import("@/lib/proposals/merge");
    const other = seedAccount({ name: "Other Synthetic", dealId: "SYN-DEAL-OTHER" });
    const loser = create("deal", { name: "Local copy", stage: 2, next_step: "Book review" });
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: loser, actorUserId: USER });
    moveDeal({ dealId: seed.dealId, fromAccountId: seed.accountId, toAccountId: other.accountId, actorUserId: USER });
    const r = only();
    const p = previewUnmerge({ accountId: seed.accountId, receiptId: r.id });
    expect(p.ok && p.keptAsIs.join(" ")).toMatch(/moved to another account/);
    unmerge({ accountId: seed.accountId, receiptId: r.id, actorUserId: USER });
    const keeper = db().prepare("SELECT account_id, next_step FROM deals WHERE deal_id = ?").get(seed.dealId) as { account_id: string; next_step: string };
    expect(keeper).toEqual({ account_id: other.accountId, next_step: "Book review" });
  });

  it("keeps a later edit that put the merged value back, and names it", () => {
    const loser = create("deal", { name: "Local copy", stage: 2, next_step: "Book review" });
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: loser, actorUserId: USER });
    for (const next_step of ["Something else", "Book review"])
      applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload: { next_step }, actorUserId: "user-2" });
    const done = unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    expect(done.keptAsIs.join(" ")).toMatch(/Next step was changed since/);
    expect((db().prepare("SELECT next_step FROM deals WHERE deal_id = ?").get(seed.dealId) as { next_step: string }).next_step).toBe("Book review");
  });

  it("refuses on an archived account, and does not offer it", async () => {
    const { archiveEntity } = await import("@/lib/proposals/apply");
    const loser = create("deal", { name: "Local copy", stage: 2 });
    pendingFor("deal", loser, { next_step: "Synthetic" });
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: loser, actorUserId: USER });
    archiveEntity({ accountId: seed.accountId, entityType: "account", entityId: seed.accountId, actorUserId: USER });
    const r = only();
    expect(previewUnmerge({ accountId: seed.accountId, receiptId: r.id }).ok).toBe(false);
    expect(() => unmerge({ accountId: seed.accountId, receiptId: r.id, actorUserId: USER })).toThrow(/archived/);
    expect(db().prepare("SELECT COUNT(*) n FROM proposals WHERE account_id = ? AND status = 'pending'").get(seed.accountId)).toEqual({ n: 0 });
  });

  it("refuses an undo whose plan changed after the page showed it", () => {
    const loser = create("deal", { name: "Local copy", stage: 2, next_step: "Book review" });
    mergeDeals({ accountId: seed.accountId, keeperId: seed.dealId, loserId: loser, actorUserId: USER });
    const r = only();
    const shown = previewUnmerge({ accountId: seed.accountId, receiptId: r.id });
    if (!shown.ok) throw new Error("preview refused");
    applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload: { next_step: "Changed meanwhile" }, actorUserId: "user-2" });
    expect(() => unmerge({ accountId: seed.accountId, receiptId: r.id, actorUserId: USER, expect: shown.digest })).toThrow(/changed since this page was drawn/);
    const fresh = previewUnmerge({ accountId: seed.accountId, receiptId: r.id });
    if (!fresh.ok) throw new Error("preview refused");
    expect(unmerge({ accountId: seed.accountId, receiptId: r.id, actorUserId: USER, expect: fresh.digest }).keptAsIs).toEqual(fresh.keptAsIs);
  });

  it("says when the merged-away record was already archived and stays so", () => {
    const loser = create("contact", { name: "Avery Example", org: "customer" });
    applyEntityChange({ accountId: seed.accountId, entityType: "contact", op: "update", entityId: loser, payload: { archived_at: "2026-10-01" }, actorUserId: USER });
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: loser, actorUserId: USER });
    const p = previewUnmerge({ accountId: seed.accountId, receiptId: only().id });
    expect(p.ok && p.loserReturns).toBe(false);
  });

  it("names linked people and deals in words, not column names", () => {
    const third = create("contact", { name: "Third Person", org: "customer" });
    const loser = create("contact", { name: "Avery Example", org: "customer" });
    const play = create("play", { title: "Second play", status: "proposed", contact_ids: [loser] });
    mergeContacts({ accountId: seed.accountId, keeperId: seed.contactId, loserId: loser, actorUserId: USER });
    applyEntityChange({ accountId: seed.accountId, entityType: "play", op: "update", entityId: play, payload: { contact_ids: [seed.contactId, third] }, actorUserId: USER });
    const p = previewUnmerge({ accountId: seed.accountId, receiptId: only().id });
    expect(p.ok && p.keptAsIs.join(" ")).toMatch(/Linked people was changed since/);
  });

  it("keeps one copy of a meeting's notes in the receipt, not two", () => {
    // A meeting merge joins both sets of notes into the keeper. The receipt
    // needs what the keeper held before (to restore it) but only a
    // fingerprint of what the merge wrote (to see whether it still holds it).
    const a = create("meeting", { title: "A", held_at: "2026-09-02", raw_notes: "a".repeat(60_000) });
    const b = create("meeting", { title: "B", held_at: "2026-09-02", raw_notes: "b".repeat(60_000) });
    mergeMeetings({ accountId: seed.accountId, keeperId: a, loserId: b, actorUserId: USER });
    const size = (db().prepare("SELECT length(changes_json) n FROM merge_receipts").get() as { n: number }).n;
    expect(size).toBeLessThan(90_000);
    unmerge({ accountId: seed.accountId, receiptId: only().id, actorUserId: USER });
    expect((db().prepare("SELECT raw_notes FROM meetings WHERE id = ?").get(a) as { raw_notes: string }).raw_notes).toBe("a".repeat(60_000));
  });
});
