"use server";
// Undoing a merge (lib/proposals/unmerge.ts).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { unmerge } from "@/lib/proposals/unmerge";
import { mergeAccounts, unmergeAccount } from "@/lib/proposals/mergeAccount";
import { ApplyError } from "@/lib/proposals/apply";
import type { ActionResult } from "@/components/attempt";

// `expect` is the digest of the plan the page showed. If anything changed
// between drawing the page and pressing Undo, the undo is refused and the
// page re-read, so "left as it is" is always something the person was told.
export async function unmergeAction(accountId: string, receiptId: string, expect: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    unmerge({ accountId, receiptId, actorUserId: user.id, expect });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// Merging two account records for one customer (lib/proposals/mergeAccount.ts).
export async function mergeAccountsAction(keeperId: string, loserId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    mergeAccounts({ keeperId, loserId, actorUserId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(`/accounts/${keeperId}/details#merges`);
}

export async function unmergeAccountAction(keeperId: string, receiptId: string, expect: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    unmergeAccount({ keeperId, receiptId, actorUserId: user.id, expect });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
