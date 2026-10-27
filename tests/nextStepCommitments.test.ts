// SYNTHETIC ONLY
import { beforeEach, expect, it, vi } from "vitest";
import { db, type ActionItemRow } from "@/lib/db";
import { applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { commitmentBasis, createNextStepCommitment, linkedCommitments } from "@/lib/nextStepCommitments";
import { getDeal, getPlay } from "@/lib/queries/accounts";
import { followUpSources } from "@/lib/queries/followUpSources";
import { followUpReturn } from "@/lib/followUpReturn";
import { mergeMeetings } from "@/lib/proposals/merge";
import { seedAccount, USER, type Seed } from "./helpers";
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => { if (!auth.signedIn) throw Error("Unauthenticated"); return { id: "user-1" }; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let seed: Seed;
beforeEach(() => {
  auth.signedIn = true;
  seed = seedAccount();
  db().prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,'unused','Synthetic Assignee',1,1)").run(USER, "assignee@example.test");
  for (const [entityType, entityId] of [["deal", seed.dealId], ["play", seed.playId]] as const) applyEntityChange({ accountId: seed.accountId, entityType, entityId, op: "update", payload: { next_step: "Arrange synthetic workshop" }, actorUserId: USER });
});
function input(kind: "deal" | "play" = "deal") {
  return { accountId: seed.accountId, kind, sourceId: kind === "deal" ? seed.dealId : seed.playId, basis: commitmentBasis((kind === "deal" ? getDeal(seed.dealId) : getPlay(seed.playId))!), userId: USER, text: "Confirm the workshop", assignee: USER, due: "2026-10-01", noDate: false };
}
function row(id: string) { return db().prepare("SELECT * FROM action_items WHERE id = ?").get(id) as ActionItemRow; }
it("only confirmation creates; genuine link, chosen assignee/date and immutable provenance survive edits", () => {
  expect(linkedCommitments(seed.accountId, "deal", seed.dealId)).toEqual([]);
  const result = createNextStepCommitment(input());
  expect(row(result.id)).toMatchObject({ owner_user_id: USER, due: "2026-10-01", status: "open", play_id: null });
  const source = row(result.id).source_ref_json;
  applyEntityChange({ accountId: seed.accountId, entityType: "action_item", entityId: result.id, op: "update", actorUserId: USER, payload: { text: "Edited task", due: "2026-11-01", play_id: seed.playId } });
  expect(row(result.id).source_ref_json).toBe(source);
  expect(() => applyEntityChange({ accountId: seed.accountId, entityType: "action_item", entityId: result.id, op: "update", actorUserId: USER, payload: { source_ref: null } })).toThrow(/source cannot/);
  const sources = followUpSources([row(result.id)]).get(result.id)!;
  expect(sources.map((s) => s.label)).toEqual(["Source deal: EHR Refresh", "Current play: EHR platform defense"]);
});
it("does not duplicate a confirmed step after unrelated source edits", () => {
  const first = createNextStepCommitment(input());
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, op: "update", actorUserId: USER, payload: { notes: "Unrelated synthetic context", stage: 4 } });
  expect(createNextStepCommitment(input())).toEqual({ id: first.id, already: true });
  expect(linkedCommitments(seed.accountId, "deal", seed.dealId)).toHaveLength(1);
});
it("keeps prior open work visible after prose changes, never links matching text", () => {
  const result = createNextStepCommitment(input());
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, op: "update", actorUserId: USER, payload: { next_step: "Different next step" } });
  applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", actorUserId: USER, payload: { text: "Different next step" } });
  expect(linkedCommitments(seed.accountId, "deal", seed.dealId).map((r) => r.id)).toEqual([result.id]);
});
it("atomic repeat confirmations and post-success retries recover one record", async () => {
  const request = input("play");
  const results = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => createNextStepCommitment(request))));
  expect(new Set(results.map((r) => r.id)).size).toBe(1);
  expect(results.filter((r) => !r.already)).toHaveLength(1);
  expect(row(results[0]!.id).play_id).toBe(seed.playId);
  archiveEntity({ accountId: seed.accountId, entityType: "play", entityId: seed.playId, actorUserId: USER });
  expect(createNextStepCommitment(request)).toEqual({ id: results[0]!.id, already: true });
  expect(linkedCommitments(seed.accountId, "play", seed.playId)).toHaveLength(1);
});
it.each([{ assignee: "unknown" }, { assignee: "" }, { due: "2026-02-30" }, { due: "" }, { noDate: true }, { userId: "unknown" }, { basis: " bad " }])("refuses invalid user/date/basis choices %j without writing", (overrides) => {
  expect(() => createNextStepCommitment({ ...input(), ...overrides })).toThrow();
  expect(linkedCommitments(seed.accountId, "deal", seed.dealId)).toEqual([]);
});
it("allows explicitly unassigned/no date without inferring the prose owner", () => {
  const result = createNextStepCommitment({ ...input(), assignee: "unassigned", due: "", noDate: true });
  expect(row(result.id)).toMatchObject({ owner_user_id: null, due: null });
});
it("refuses cross-account, stale, archived and moved sources", () => {
  const request = input();
  const other = seedAccount({ name: "Synthetic Second", dealId: "SYN-SECOND" });
  expect(() => createNextStepCommitment({ ...request, accountId: other.accountId })).toThrow(/unavailable/);
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, op: "update", actorUserId: USER, payload: { next_step: "Changed" } });
  expect(() => createNextStepCommitment(request)).toThrow(/changed/);
  archiveEntity({ accountId: seed.accountId, entityType: "deal", entityId: seed.dealId, actorUserId: USER });
  expect(() => createNextStepCommitment(input())).toThrow(/archived/);
  db().prepare("UPDATE deals SET account_id = ? WHERE deal_id = ?").run(other.accountId, seed.dealId);
  expect(() => createNextStepCommitment(request)).toThrow(/unavailable/);
});
it("account-local set lookup refuses foreign titles, malformed JSON, and labels merged/archived provenance", () => {
  const made = createNextStepCommitment(input());
  const item = row(made.id);
  const returnTo = `/follow-ups?who=${USER}#action-${item.id}`;
  expect(followUpSources([item], () => returnTo).get(item.id)![0]!.href).toContain(`returnTo=${encodeURIComponent(returnTo)}`);
  const other = seedAccount({ name: "Synthetic Other", dealId: "SYN-OTHER" });
  const foreign = { ...item, source_ref_json: JSON.stringify({ kind: "deal", id: other.dealId }) };
  expect(followUpSources([foreign]).get(item.id)).toEqual([{ label: "Source deal unavailable on this account" }]);
  expect(followUpSources([{ ...item, source_ref_json: "bad json" }]).get(item.id)).toEqual([]);
  db().prepare("UPDATE deals SET archived_at='2026-10-01' WHERE deal_id=?").run(seed.dealId);
  expect(followUpSources([item]).get(item.id)![0]!.label).toContain("(archived)");
  db().prepare("UPDATE deals SET merged_into=? WHERE deal_id=?").run(other.dealId, seed.dealId);
  expect(followUpSources([item]).get(item.id)).toEqual([{ label: "Source deal: EHR Refresh (merged)" }]);
});
it("labels movable meeting membership honestly after a merge", () => {
  const meeting = (title: string) => applyEntityChange({ accountId: seed.accountId, entityType: "meeting", op: "create", actorUserId: USER, payload: { title, held_at: "2026-10-01" } }).entityId;
  const a = meeting("Synthetic original"), b = meeting("Synthetic survivor");
  const id = applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", actorUserId: USER, payload: { text: "Manual task", meeting_id: a } }).entityId;
  expect(followUpSources([row(id)]).get(id)![0]!.label).toBe("Current meeting: Synthetic original");
  mergeMeetings({ accountId: seed.accountId, keeperId: b, loserId: a, actorUserId: USER });
  expect(followUpSources([row(id)]).get(id)![0]!.label).toBe("Current meeting: Synthetic survivor");
});
it("validates exact list filter/row return, not arbitrary or repaired URLs", () => {
  const valid = `/follow-ups?who=${USER}#action-abc`;
  expect(followUpReturn(valid, [USER])).toBe(valid);
  expect(followUpReturn("/follow-ups#action-abc", [])).toBe("/follow-ups#action-abc");
  for (const value of ["//evil.test", "https://evil.test", " /follow-ups#action-abc", "/follow-ups?who=unknown#action-abc", "/follow-ups?who=user-1&next=evil#action-abc", "/follow-ups?who=%75ser-1#action-abc", "/accounts/x", [valid]]) expect(followUpReturn(value, [USER])).toBeNull();
});
it("the server action authenticates before writing", async () => {
  const { createNextStepFollowUp } = await import("@/app/commitmentActions");
  auth.signedIn = false;
  await expect(createNextStepFollowUp(seed.accountId, "deal", seed.dealId, new FormData())).rejects.toThrow("Unauthenticated");
  expect(linkedCommitments(seed.accountId, "deal", seed.dealId)).toEqual([]);
});
