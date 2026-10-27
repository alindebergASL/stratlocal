"use server";
// "No next step needed" on an open deal, from wherever it is flagged.
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { applyEntityChange, ApplyError } from "@/lib/proposals/apply";
import { addDays, todayISO } from "@/lib/clock";

type FormResult = { ok: true } | { ok: false; error: string };
type Result = { ok: true; message?: string } | { ok: false; error: string };

function refresh(accountId: string, dealId: string) {
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath(`/accounts/${accountId}/deals`);
  revalidatePath(`/accounts/${accountId}/deals/${dealId}`);
}

export async function waiveNextStepAction(accountId: string, dealId: string, fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  const kind = fd.get("kind") === "info" ? "info" : "until";
  const until = String(fd.get("until") ?? "") || addDays(todayISO(), 30);
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "Say why no next step is needed, so the team knows." };
  if (kind === "until" && until < todayISO()) return { ok: false, error: "Choose a day from today on." };
  try {
    applyEntityChange({
      accountId,
      entityType: "deal",
      op: "update",
      entityId: dealId,
      payload: { next_step_waived: kind, next_step_waived_until: kind === "until" ? until : null, next_step_waived_reason: reason },
      actorUserId: user.id,
    });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  refresh(accountId, dealId);
  return { ok: true };
}

export async function clearWaiverAction(accountId: string, dealId: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { next_step_waived: null, next_step_waived_until: null, next_step_waived_reason: null }, actorUserId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  refresh(accountId, dealId);
  return { ok: true, message: "It is asking for a next step again." };
}
