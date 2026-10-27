"use server";

import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { ApplyError } from "@/lib/proposals/apply";
import { dropKeptFinding, markStillTrue } from "@/lib/research/notes";

type Result = { ok: true; message?: string } | { ok: false; error: string };

// "Still true?" on the research page (lib/research/current.ts).
export async function stillTrueAction(accountId: string, noteId: string, index: number, keep: boolean): Promise<Result> {
  const user = await requirePageUser();
  try {
    if (keep) markStillTrue(noteId, index, user.id);
    else dropKeptFinding(noteId, index, user.id);
    revalidatePath(`/accounts/${accountId}/research`);
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true, message: keep ? "Kept. Asked again in six months." : "Dropped. It stays in the note, unticked." };
  } catch (e) {
    return { ok: false, error: e instanceof ApplyError ? e.message : describeError(e) };
  }
}
