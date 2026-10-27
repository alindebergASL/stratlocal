"use server";
// Keeping and deleting Ask conversations (lib/ask/threads.ts).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { archiveThread, getThread, keepThread, setVerdict } from "@/lib/ask/threads";
import { ApplyError } from "@/lib/proposals/apply";
import { acceptQuickFollowUps } from "@/lib/ask/propose";
import type { ActionResult } from "@/components/attempt";

export async function keepThreadAction(threadId: string): Promise<void> {
  await requirePageUser();
  keepThread(threadId);
  revalidatePath(`/ask/${threadId}`);
}

export async function archiveThreadAction(threadId: string): Promise<void> {
  await requirePageUser();
  const thread = getThread(threadId);
  archiveThread(threadId);
  revalidatePath("/ask");
  redirect(thread?.accountId ? `/accounts/${thread.accountId}/ask` : "/ask");
}

export async function judgeAnswerAction(messageId: string, verdict: "useful" | "wrong" | null, note: string | null): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    setVerdict(messageId, verdict, note, user.id);
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/ask/feedback");
  return { ok: true };
}

// The follow-ups an answer proposed, added in one tap (lib/ask/propose.ts).
export async function addAskFollowUpsAction(batchId: string, threadId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  try {
    const { accepted, failed } = acceptQuickFollowUps(batchId, user.id);
    revalidatePath(`/ask/${threadId}`);
    if (failed.length) return { ok: false, error: `${accepted} added; ${failed.length} could not be: ${failed.join("; ")}` };
    return { ok: true, message: `${accepted} follow-up${accepted === 1 ? "" : "s"} added.` };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
}
