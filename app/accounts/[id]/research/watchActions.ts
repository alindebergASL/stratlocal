"use server";

import { refresh, revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { BudgetError } from "@/lib/ai/guard";
import { isWatchPace, PACE_LABEL, setWatched, type WatchPace } from "@/lib/assistants/accountWatch";

// Watch an account weekly, or stop. The look itself is Account watch's, on
// the Assistants page's settings and budget.
export async function toggleWatch(accountId: string, on: boolean): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  try {
    setWatched(accountId, on, user.id);
    revalidatePath(`/accounts/${accountId}/research`);
    revalidatePath("/assistants");
    return { ok: true, message: on ? "Watching. Account watch runs from the Assistants page." : "No longer watched." };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError ? e.message : describeError(e) };
  }
}

// The pace control on the Overview (DECISIONS #100): 0 stops watching, any
// other choice watches at that pace.
export async function setWatchPaceAction(accountId: string, everyDays: number): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  try {
    if (everyDays === 0) setWatched(accountId, false, user.id);
    else if (isWatchPace(everyDays)) setWatched(accountId, true, user.id, everyDays);
    else return { ok: false, error: "Choose how often." };
    refresh();
    return { ok: true, message: everyDays === 0 ? "No longer watched." : `Watching: ${PACE_LABEL[everyDays as WatchPace].toLowerCase()}.` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError ? e.message : describeError(e) };
  }
}
