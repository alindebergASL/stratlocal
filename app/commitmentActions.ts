"use server";
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { createNextStepCommitment, type CommitmentKind } from "@/lib/nextStepCommitments";
import { ApplyError } from "@/lib/proposals/apply";
import type { ActionResult } from "@/components/attempt";
export async function createNextStepFollowUp(accountId: string, kind: CommitmentKind, sourceId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const raw = (key: string) => typeof fd.get(key) === "string" ? fd.get(key) as string : "";
  try {
    createNextStepCommitment({ accountId, kind, sourceId, userId: user.id, basis: raw("basis"), text: raw("text"), assignee: raw("assignee"), due: raw("due"), noDate: raw("no_date") === "on" });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
