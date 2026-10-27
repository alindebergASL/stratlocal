"use server";
// Starting, restoring and (in later steps) importing and editing the team's
// playbook (lib/playbook/store.ts).
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { ApplyError } from "@/lib/proposals/apply";
import { createPlaybook, currentPlaybook, restorePlaybook, savePlaybook, setDefaultPlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { getRun } from "@/lib/ai/guard";

type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function startFromStarterAction(basisId: string | null): Promise<Result> {
  const user = await requirePageUser();
  try {
    savePlaybook({ playbook: STARTER_PLAYBOOK, note: "Started from the neutral starter", userId: user.id, basisId });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/settings/playbook");
  return { ok: true, message: "The starter playbook is in place. Edit it, or import your own." };
}

export async function restorePlaybookAction(versionId: string, basisId: string | null): Promise<Result> {
  const user = await requirePageUser();
  try {
    restorePlaybook(versionId, user.id, basisId);
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/settings/playbook");
  return { ok: true, message: "Restored." };
}

/** Save a reviewed import as the playbook. */
export async function saveImportedAction(runId: string, basisId: string | null): Promise<Result> {
  const user = await requirePageUser();
  const run = getRun(runId);
  if (!run || run.kind !== "playbook_import" || run.status !== "done" || !run.result_json) return { ok: false, error: "That import is not available any more." };
  const result = JSON.parse(run.result_json) as { draft: unknown; filename: string | null };
  try {
    savePlaybook({ playbook: result.draft as Parameters<typeof savePlaybook>[0]["playbook"], note: `Imported from ${result.filename ?? "pasted text"}`, userId: user.id, basisId });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/settings/playbook");
  return { ok: true, message: "Saved. It is the playbook now." };
}

/** Save what the editor holds as a new version. */
export async function savePlaybookAction(json: string, basisId: string | null): Promise<Result> {
  const user = await requirePageUser();
  try {
    savePlaybook({ playbook: JSON.parse(json), note: "Edited in the app", userId: user.id, basisId });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    if (e instanceof SyntaxError) return { ok: false, error: "That is not a playbook." };
    throw e;
  }
  revalidatePath("/settings/playbook");
  return { ok: true, message: "Saved." };
}

/** A second playbook, from a copy of the one on screen or the neutral starter. */
export async function createPlaybookAction(fromSlug: string | null, fd: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const from = fd.get("from") === "starter" ? STARTER_PLAYBOOK : (currentPlaybook({ slug: fromSlug })?.playbook ?? STARTER_PLAYBOOK);
  try {
    createPlaybook({ name: String(fd.get("name") ?? ""), from, userId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/settings/playbook");
  return { ok: true };
}

export async function setDefaultPlaybookAction(slug: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    setDefaultPlaybook(slug, user.id);
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "It is the default now: every account that has not chosen another uses it." };
}
