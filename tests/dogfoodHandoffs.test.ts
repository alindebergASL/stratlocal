import { beforeEach, expect, it, vi } from "vitest";
import { db, resetDbForTests, type ActionItemRow } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { followUpMetadata } from "@/lib/followUpMetadata";
import { applyEntityChange } from "@/lib/proposals/apply";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePageUser: vi.fn(async () => ({ id: "user-1" })), listUsers: () => [{ id: "user-1", display_name: "Alex" }] }));
import { revalidatePath } from "next/cache";
import { saveActionItem } from "@/app/actions";
let seed: Seed;
const form = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };
const rows = () => db().prepare("SELECT * FROM action_items").all() as ActionItemRow[];
beforeEach(() => { resetDbForTests(); seed = seedAccount(); vi.clearAllMocks(); });
it("manual meeting creation persists its association and refreshes the same page; edits preserve it", async () => {
  expect(await saveActionItem(seed.accountId, null, form({ text: "Synthetic handoff", meeting_id: seed.meetingId, owner_user_id: USER }))).toEqual({ ok: true });
  const item = rows()[0]!;
  expect(item.meeting_id).toBe(seed.meetingId);
  expect(revalidatePath).toHaveBeenCalledWith(`/accounts/${seed.accountId}/meetings/${seed.meetingId}`);
  expect(await saveActionItem(seed.accountId, item.id, form({ text: "Synthetic corrected", due: "2026-10-01", owner_user_id: USER, base_version: String(item.updated_at) }))).toEqual({ ok: true });
  expect(rows()[0]!).toMatchObject({ meeting_id: seed.meetingId, owner_user_id: USER, due: "2026-10-01" });
});
it("account/global creation without a meeting stays unlinked", async () => {
  await saveActionItem(seed.accountId, null, form({ text: "Synthetic account task" }));
  expect(rows()[0]!.meeting_id).toBeNull();
});
it("rejects cross-account meeting creation and cross-account item edits without writing", async () => {
  const other = seedAccount({ name: "Synthetic Other", dealId: "SYN-OTHER" });
  expect((await saveActionItem(seed.accountId, null, form({ text: "Wrong meeting", meeting_id: other.meetingId }))).ok).toBe(false);
  expect(rows()).toHaveLength(0);
  await saveActionItem(seed.accountId, null, form({ text: "Synthetic original", meeting_id: seed.meetingId }));
  expect((await saveActionItem(other.accountId, rows()[0]!.id, form({ text: "Wrong account" }))).ok).toBe(false);
  expect(rows()[0]!.text).toBe("Synthetic original");
});
it("keeps stale-version conflict protection", async () => {
  await saveActionItem(seed.accountId, null, form({ text: "Synthetic original" }));
  const item = rows()[0]!;
  db().prepare("UPDATE action_items SET updated_at = ? WHERE id = ?").run(1, item.id);
  applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "update", entityId: item.id, payload: { text: "Partner edit" }, actorUserId: USER });
  const r = await saveActionItem(seed.accountId, item.id, form({ text: "Stale edit", base_version: "1" }));
  expect(r.ok).toBe(false);
  expect(rows()[0]!.text).toBe("Partner edit");
});
it.each([null, "2026-10-01"])("owner metadata stays truthful with date %s", (due) => {
  const base = { due, meetingTitle: "Synthetic review" };
  for (const [ownerUserId, owner, expected] of [[USER, null, "Alex"], [USER, "Stale extracted label", "Alex"], [null, "External Example", "External Example"], [null, null, "no owner"]] as const) {
    const text = followUpMetadata({ ...base, ownerUserId, owner }, [{ id: USER, name: "Alex" }]);
    expect(text).toContain(expected);
    expect(text).toContain(due ? "due " : "no date");
    expect(text).toContain("Synthetic review");
    if (ownerUserId || owner) expect(text).not.toContain("no owner");
  }
  expect(followUpMetadata({ ...base, ownerUserId: "missing-label", owner: null })).toContain("Assigned owner");
});
