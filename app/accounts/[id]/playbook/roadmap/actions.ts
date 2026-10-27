"use server";
// The roadmap's writes, all through the one write path: a milestone is a
// follow-up on a roadmap play, the budget calendar is two account fields.
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { applyEntityChange, ApplyError } from "@/lib/proposals/apply";

type FormResult = { ok: true } | { ok: false; error: string };

const tried = (accountId: string, fn: () => void): FormResult => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/accounts/${accountId}/playbook/roadmap`);
  return { ok: true };
};

export async function addMilestoneAction(accountId: string, fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  const text = String(fd.get("text") ?? "").trim();
  const playId = String(fd.get("play_id") ?? "");
  const due = String(fd.get("due") ?? "") || null;
  if (!text) return { ok: false, error: "Say what the milestone is." };
  if (!playId) return { ok: false, error: "Choose the roadmap item it belongs to." };
  return tried(accountId, () =>
    applyEntityChange({ accountId, entityType: "action_item", op: "create", payload: { text, play_id: playId, due, status: "open", owner_user_id: user.id }, actorUserId: user.id }),
  );
}

export async function setBudgetCalendarAction(accountId: string, fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  const month = Number(fd.get("fiscal_year_start_month") ?? 0);
  const notes = String(fd.get("budget_calendar") ?? "").trim();
  return tried(accountId, () =>
    applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { fiscal_year_start_month: month >= 1 && month <= 12 ? month : null, budget_calendar: notes || null }, actorUserId: user.id }),
  );
}

export async function setPhaseAction(accountId: string, playId: string, fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  const phase = Number(fd.get("phase") ?? 0);
  return tried(accountId, () =>
    applyEntityChange({ accountId, entityType: "play", op: "update", entityId: playId, payload: { phase: phase >= 1 && phase <= 3 ? phase : null }, actorUserId: user.id }),
  );
}
