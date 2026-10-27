// SYNTHETIC ONLY.
//
// Ticking a follow-up done or open used to send no version, so a tab left
// open since yesterday could reopen a follow-up the other of you closed this
// morning, silently. The checkbox now sends the row as it was drawn; the
// reply carries the new version so the same list can tick it back without
// being refused as a conflict with its own first click.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type ActionItemRow } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { seedAccount, USER, type Seed } from "./helpers";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePageUser: vi.fn(async () => ({ id: "user-1" })), listUsers: () => [{ id: "user-1", display_name: "Alex" }] }));
import { setActionItemsStatus, setActionItemStatus } from "@/app/actions";

let seed: Seed;
beforeEach(() => {
  seed = seedAccount();
});

function item(text = "Synthetic follow-up"): ActionItemRow {
  const { entityId } = applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { text, status: "open" }, actorUserId: USER });
  return row(entityId);
}
const row = (id: string) => db().prepare("SELECT * FROM action_items WHERE id = ?").get(id) as ActionItemRow;

describe("a status change carries the row as it was drawn", () => {
  it("refuses a tick from a tab that has not seen the other person's change", async () => {
    const drawn = item();
    // The other person closes it, then reopens it with a note: status is back
    // where the old tab thinks it is, but the old tab never saw either change.
    expect((await setActionItemStatus(seed.accountId, drawn.id, "done", drawn.updated_at)).ok).toBe(true);
    const r = await setActionItemStatus(seed.accountId, drawn.id, "open", drawn.updated_at);
    expect(r.ok).toBe(false);
    expect(row(drawn.id).status).toBe("done");
  });

  it("returns the new version, and the same list can tick it back with it", async () => {
    const drawn = item();
    const first = await setActionItemStatus(seed.accountId, drawn.id, "done", drawn.updated_at);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.version).toBe(row(drawn.id).updated_at);
    const back = await setActionItemStatus(seed.accountId, drawn.id, "open", first.version);
    expect(back.ok).toBe(true);
    expect(row(drawn.id).status).toBe("open");
  });

  it("still accepts a caller that has no version to send", async () => {
    const drawn = item();
    expect((await setActionItemStatus(seed.accountId, drawn.id, "done")).ok).toBe(true);
  });

  it("marks several done all or nothing, refusing the batch when one row moved", async () => {
    const a = item("Synthetic one");
    const b = item("Synthetic two");
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "update", entityId: b.id, payload: { status: "done" }, actorUserId: USER });
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "update", entityId: b.id, payload: { status: "open" }, actorUserId: USER });
    const r = await setActionItemsStatus(seed.accountId, [a.id, b.id], "done", { [a.id]: a.updated_at, [b.id]: b.updated_at });
    expect(r.ok).toBe(false);
    expect(row(a.id).status).toBe("open");
    const fresh = await setActionItemsStatus(seed.accountId, [a.id, b.id], "done", { [a.id]: a.updated_at, [b.id]: row(b.id).updated_at });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.versions?.[a.id]).toBe(row(a.id).updated_at);
  });
});
