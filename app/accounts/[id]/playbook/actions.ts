"use server";
// The account's place in the playbook: its archetype and hypothesis, set by
// hand or by accepting a suggestion, through the ordinary write path.
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { createHash } from "node:crypto";
import { acceptProposal, applyEntityChange, ApplyError, rejectProposal } from "@/lib/proposals/apply";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/clock";
import { currentPlaybook, listPlaybooks } from "@/lib/playbook/store";
import { lifecycle, moveToStep, setCheck, stepDue } from "@/lib/playbook/lifecycle";
import type { Playbook } from "@/lib/playbook/schema";
import { QUALIFICATION_FIELDS } from "@/lib/playbook/qualificationFields";
import { readFromSalesforce, sendQualification } from "@/lib/salesforce/sync";
import { SalesforceError } from "@/lib/salesforce/client";

type Result = { ok: true; message?: string } | { ok: false; error: string };
const done = (accountId: string, message?: string): Result => {
  revalidatePath(`/accounts/${accountId}/playbook`);
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/settings/playbook");
  return { ok: true, ...(message ? { message } : {}) };
};

export async function decideArchetypeAction(accountId: string, proposalId: string, accept: boolean): Promise<Result> {
  const user = await requirePageUser();
  try {
    if (accept) acceptProposal(proposalId, user.id);
    else rejectProposal(proposalId, user.id);
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  return done(accountId, accept ? "Set." : "Turned down.");
}

export async function setArchetypeAction(accountId: string, fd: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const archetype = String(fd.get("archetype_id") ?? "") || null;
  const hypothesis = String(fd.get("archetype_hypothesis") ?? "").trim() || null;
  try {
    applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: archetype, archetype_hypothesis: hypothesis }, actorUserId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  done(accountId);
  return { ok: true };
}

const playbookOrFail = (accountId: string): Playbook => {
  const p = currentPlaybook({ accountId })?.playbook;
  if (!p) throw new ApplyError("There is no playbook yet.", "state");
  return p;
};

const tried = (accountId: string, fn: () => string | void): Result => {
  try {
    return done(accountId, fn() || undefined);
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
};

export async function moveStepAction(accountId: string, stepId: string): Promise<Result> {
  const user = await requirePageUser();
  return tried(accountId, () => moveToStep(accountId, playbookOrFail(accountId), stepId, user.id));
}

export async function checkAction(accountId: string, stepId: string, item: string, isDone: boolean): Promise<Result> {
  const user = await requirePageUser();
  return tried(accountId, () => setCheck(accountId, playbookOrFail(accountId), stepId, item, isDone, user.id));
}

// The step's timebox as a follow-up, from the day the account moved to it.
// One per step and move: pressing twice does not make two.
export async function stepFollowUpAction(accountId: string, stepId: string): Promise<Result> {
  const user = await requirePageUser();
  return tried(accountId, () => {
    const playbook = playbookOrFail(accountId);
    const life = lifecycle(accountId, playbook);
    const step = life.current?.step.id === stepId ? life.current.step : null;
    if (!step || life.since === null) throw new ApplyError("Move the account to that step first.", "state");
    const due = stepDue(step, todayISO(new Date(life.since)));
    if (!due) throw new ApplyError("That step's timebox sets no deadline.", "validation");
    const id = `pb_${createHash("sha256").update(`${accountId}\u0000${stepId}\u0000${life.since}`).digest("hex").slice(0, 24)}`;
    if (db().prepare("SELECT 1 FROM action_items WHERE id = ?").get(id)) return "Already a follow-up.";
    applyEntityChange({
      accountId,
      entityType: "action_item",
      op: "create",
      entityId: id,
      actorUserId: user.id,
      payload: { text: step.output ? `${step.output} (${step.name})` : step.name, owner_user_id: user.id, due, status: "open", source_ref: { kind: "account", id: accountId, quote: `Playbook: ${step.name}${step.timebox ? `, ${step.timebox}` : ""}` } },
    });
    return `Follow-up due ${due}.`;
  });
}

// One element of the scorecard, by hand.
export async function setQualificationAction(accountId: string, field: string, fd: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  if (!QUALIFICATION_FIELDS.includes(field as (typeof QUALIFICATION_FIELDS)[number])) return { ok: false, error: "That is not a qualification element." };
  const status = String(fd.get("status") ?? "unknown");
  const evidence = String(fd.get("evidence") ?? "").trim();
  try {
    applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { [field]: status === "unknown" && !evidence ? null : { status, evidence } }, actorUserId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  done(accountId);
  return { ok: true };
}

export async function readSalesforceAction(accountId: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    const { proposals } = await readFromSalesforce(accountId, user.id);
    revalidatePath("/inbox");
    return done(accountId, proposals ? `${proposals} change${proposals === 1 ? "" : "s"} from Salesforce to review.` : "Salesforce matches what is on file.");
  } catch (e) {
    if (e instanceof SalesforceError || e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function sendQualificationAction(accountId: string, fd: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  try {
    await sendQualification(accountId, String(fd.get("opportunity_id") ?? ""), user.id);
  } catch (e) {
    if (e instanceof SalesforceError) return { ok: false, error: e.message };
    throw e;
  }
  done(accountId);
  return { ok: true };
}

// Which of the team's playbooks this account uses. The default is stored as
// null, so changing the team's default moves every account that never chose.
export async function setAccountPlaybookAction(accountId: string, fd: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const slug = String(fd.get("playbook_slug") ?? "");
  const known = listPlaybooks();
  const chosen = known.find((p) => p.slug === slug);
  if (slug && !chosen) return { ok: false, error: "No such playbook." };
  try {
    applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { playbook_slug: !chosen || chosen.isDefault ? null : chosen.slug }, actorUserId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  done(accountId);
  return { ok: true };
}
