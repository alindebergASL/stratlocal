"use server";
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { applyEntityChange, ApplyError } from "@/lib/proposals/apply";
import { movePlay } from "@/lib/plays/rank";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const done = (accountId: string): Result => {
  revalidatePath(`/accounts/${accountId}/plays`);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath(`/accounts/${accountId}/plan`);
  return { ok: true };
};

export async function movePlayAction(accountId: string, playId: string, by: -1 | 1): Promise<Result> {
  const user = await requirePageUser();
  try {
    movePlay(accountId, playId, by, user.id);
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  return done(accountId);
}

/** "Information only" or "Not applicable": the play stays, its warnings go. */
export async function setPlayKindAction(accountId: string, playId: string, status: "info_only" | "not_applicable" | "active"): Promise<Result> {
  const user = await requirePageUser();
  try {
    applyEntityChange({ accountId, entityType: "play", op: "update", entityId: playId, payload: { status }, actorUserId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  return done(accountId);
}
