"use server";
// Close the day's two presses: draft the note, and send it to your partner's
// Today (lib/assistants/closeTheDay.ts). Nothing leaves the app.
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { BudgetError } from "@/lib/ai/guard";
import { assistantMode } from "@/lib/assistants/settings";
import { sendCloseNote, startCloseNote } from "@/lib/assistants/closeTheDay";
import type { ActionResult } from "@/components/attempt";

export async function draftCloseNoteAction(): Promise<ActionResult> {
  const user = await requirePageUser();
  if (assistantMode("close_the_day") === "off") return { ok: false, error: "Close the day is switched off on the Assistants page." };
  try {
    const r = startCloseNote(user.id, "manual");
    if ("reason" in r) return { ok: false, error: r.reason };
  } catch (e) {
    if (e instanceof BudgetError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/");
  return { ok: true };
}

export async function sendCloseNoteAction(threadId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    sendCloseNote(threadId, user.id);
  } catch (e) {
    if (e instanceof BudgetError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/");
  return { ok: true };
}
