"use server";

// Answers to Plan keeper's questions. Each is an ordinary edit of the play or
// the account, version-checked like any other, followed by closing the
// question. Nothing here is written by a model.
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { isRealDay } from "@/lib/clock";
import { applyEntityChange, ApplyError, ConflictError } from "@/lib/proposals/apply";
import { getNotice, NoticeError, resolveNotice } from "@/lib/assistants/promiseKeeper";
import type { ActionResult } from "@/components/attempt";

function refresh(accountId: string, playId?: string | null) {
  revalidatePath("/inbox");
  revalidatePath("/");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath(`/accounts/${accountId}/plan`);
  if (playId) revalidatePath(`/accounts/${accountId}/plays/${playId}`);
}

function fail(e: unknown): ActionResult {
  if (e instanceof ConflictError) return { ok: false, error: "Someone changed this since the page loaded. Reload to see what is there now." };
  if (e instanceof ApplyError || e instanceof NoticeError) return { ok: false, error: e.message };
  return { ok: false, error: describeError(e) };
}

function openNotice(id: string) {
  const n = getNotice(id);
  if (!n || n.assistant !== "plan_keeper" || n.resolved_at) throw new NoticeError("That question was already answered.");
  return n;
}

// Every answer is checked against the version the card was dealt with. A
// missing one would be an unchecked write, so it is refused, not skipped.
const NO_VERSION = "This card did not say which version it was made from. Reload the page and answer again.";
const validVersion = (v: number) => Number.isFinite(v) && v > 0;
const version = (fd: FormData) => {
  const v = Number(fd.get("base_version") ?? Number.NaN);
  return validVersion(v) ? v : null;
};

export async function setNextStepAction(noticeId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const step = String(fd.get("next_step") ?? "").trim();
  const due = String(fd.get("due") ?? "").trim();
  if (!step) return { ok: false, error: "Write the next step." };
  if (due && !isRealDay(due)) return { ok: false, error: "That date is not a real day." };
  const baseVersion = version(fd);
  if (baseVersion === null) return { ok: false, error: NO_VERSION };
  try {
    const n = openNotice(noticeId);
    if (!n.subject_id) return { ok: false, error: "That question is not about a play." };
    applyEntityChange({ accountId: n.account_id, entityType: "play", entityId: n.subject_id, op: "update", payload: { next_step: step.slice(0, 300), next_step_due: due || null }, baseVersion, actorUserId: user.id });
    resolveNotice(noticeId, user.id, "answered");
    refresh(n.account_id, n.subject_id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPlayStatusAction(noticeId: string, status: "active" | "stalled" | "dropped", baseVersion: number): Promise<ActionResult> {
  const user = await requirePageUser();
  if (!["active", "stalled", "dropped"].includes(status)) return { ok: false, error: "Not a status a play can have." };
  if (!validVersion(baseVersion)) return { ok: false, error: NO_VERSION };
  try {
    const n = openNotice(noticeId);
    if (!n.subject_id) return { ok: false, error: "That question is not about a play." };
    applyEntityChange({ accountId: n.account_id, entityType: "play", entityId: n.subject_id, op: "update", payload: { status }, baseVersion, actorUserId: user.id });
    resolveNotice(noticeId, user.id, "answered");
    refresh(n.account_id, n.subject_id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function editThesisAction(noticeId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const thesis = String(fd.get("thesis") ?? "").trim();
  if (!thesis) return { ok: false, error: "The thesis cannot be empty. To leave it as it is, choose Still holds." };
  const baseVersion = version(fd);
  if (baseVersion === null) return { ok: false, error: NO_VERSION };
  try {
    const n = openNotice(noticeId);
    applyEntityChange({ accountId: n.account_id, entityType: "account", entityId: n.account_id, op: "update", payload: { thesis: thesis.slice(0, 4000) }, baseVersion, actorUserId: user.id });
    resolveNotice(noticeId, user.id, "answered");
    // Every other question resting on the old thesis is retired by the edit.
    refresh(n.account_id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissPlanQuestion(noticeId: string): Promise<ActionResult> {
  const user = await requirePageUser();
  try {
    const n = openNotice(noticeId);
    resolveNotice(noticeId, user.id, "dismissed");
    refresh(n.account_id, n.subject_id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

