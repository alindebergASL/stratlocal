"use server";

// Handing follow-ups to the person covering: each is the ordinary save of the
// follow-up's owner, as the person who pressed it, version-checked.
import { revalidatePath } from "next/cache";
import { listUsers, requirePageUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { saveTask } from "@/lib/planning";
import type { ActionResult } from "@/components/attempt";

export async function handOverAction(items: Array<{ id: string; accountId: string; version: number }>, toUserId: string): Promise<ActionResult & { moved?: number }> {
  const user = await requirePageUser();
  if (!listUsers().some((u) => u.id === toUserId)) return { ok: false, error: "That person is not one of us." };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Tick at least one follow-up." };
  let moved = 0;
  const failed: string[] = [];
  for (const it of items.slice(0, 100)) {
    try {
      saveTask({ accountId: it.accountId, itemId: it.id, payload: { owner_user_id: toUserId }, version: it.version, userId: user.id });
      moved += 1;
    } catch (e) {
      failed.push(describeError(e));
    }
  }
  revalidatePath("/handoff");
  revalidatePath("/follow-ups");
  revalidatePath("/");
  if (failed.length) return { ok: false, error: `${moved} handed over; ${failed.length} could not be: ${failed[0]}` };
  return { ok: true, moved };
}
