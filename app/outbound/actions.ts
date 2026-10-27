"use server";

// Sending, and the drafts it starts from (DECISIONS #103). This file is the
// only caller of sendDraft: a person pressing Send on one draft.
import { refresh } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { discardDraft, DraftError, reopenDraft, updateDraft, type Recipient } from "@/lib/outbound/drafts";
import { sendDraft } from "@/lib/outbound/send";
import { draftChaser, draftFromRecap, draftInvite } from "@/lib/outbound/build";

type Result = { ok: true; message?: string; id?: string } | { ok: false; error: string };

function fail(e: unknown): Result {
  if (e instanceof DraftError) return { ok: false, error: e.message };
  throw e;
}

export async function sendDraftAction(id: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    const d = await sendDraft(id, user.id);
    refresh();
    if (d.status === "sent") return { ok: true, message: d.kind === "invite" ? "Invite sent." : "Sent." };
    if (d.status === "unknown") return { ok: false, error: `${d.error ?? "No answer"}. It may have gone: check your Sent folder before sending again.` };
    return { ok: false, error: d.error ?? "It did not go." };
  } catch (e) {
    return fail(e);
  }
}

export async function saveDraftAction(id: string, patch: { to: Recipient[]; subject: string; body: string; startsAt?: string | null; minutes?: number | null }): Promise<Result> {
  const user = await requirePageUser();
  try {
    updateDraft(id, user.id, patch);
    refresh();
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function discardDraftAction(id: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    discardDraft(id, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reopenDraftAction(id: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    reopenDraft(id, user.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function draftRecapAction(accountId: string, meetingId: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    const d = draftFromRecap(accountId, meetingId, user.id, user.display_name);
    refresh();
    return { ok: true, id: d.id, message: "Drafted. Read it, then send." };
  } catch (e) {
    return fail(e);
  }
}

export async function draftInviteAction(accountId: string, meetingId: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    const d = draftInvite(accountId, meetingId, user.id);
    refresh();
    return { ok: true, id: d.id, message: "Invite drafted. Check the time, then send." };
  } catch (e) {
    return fail(e);
  }
}

export async function draftChaserAction(actionItemId: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    const d = draftChaser(actionItemId, user.id, user.display_name);
    refresh();
    return { ok: true, id: d.id, message: "Chaser drafted in your Inbox → To send." };
  } catch (e) {
    return fail(e);
  }
}
