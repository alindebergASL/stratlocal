"use server";
// The workshop plan, saved whole; a use case put on the roadmap becomes a
// play in its phase through the one write path.
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { applyEntityChange, ApplyError } from "@/lib/proposals/apply";
import { db } from "@/lib/db";
import { getWorkshop, saveWorkshop } from "@/lib/playbook/workshop";
import { currentPlaybook } from "@/lib/playbook/store";
import { suggestPlacement } from "@/lib/playbook/placement";

type Result = { ok: true; message?: string; basis?: number } | { ok: false; error: string };

function refresh(accountId: string) {
  revalidatePath(`/accounts/${accountId}/playbook/workshop`);
  revalidatePath(`/accounts/${accountId}/playbook/roadmap`);
  revalidatePath(`/accounts/${accountId}/plays`);
}

export async function saveWorkshopAction(accountId: string, json: string, basis: number | null): Promise<Result> {
  const user = await requirePageUser();
  try {
    const at = saveWorkshop(accountId, JSON.parse(json), user.id, basis);
    refresh(accountId);
    return { ok: true, message: "Saved.", basis: at };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    if (e instanceof SyntaxError) return { ok: false, error: "That did not come through as a workshop. Reload and try again." };
    throw e;
  }
}

export async function addToRoadmapAction(accountId: string, useCaseId: string): Promise<Result> {
  const user = await requirePageUser();
  try {
    const { workshop, updatedAt } = getWorkshop(accountId);
    const uc = workshop.use_cases.find((u) => u.id === useCaseId);
    if (!uc) throw new ApplyError("Save the use case first.", "state");
    if (uc.play_id) return { ok: true, message: "Already on the roadmap." };
    if (!uc.phase) throw new ApplyError("Choose a phase for it first.", "validation");
    const rubric = currentPlaybook({ accountId })?.playbook.placement ?? null;
    const placed = rubric ? suggestPlacement(rubric, uc.relevance).best : null;
    const thesis = [uc.notes, uc.department && `For ${uc.department}.`, placed && `Suggested to run: ${placed.name}.`, uc.value && `Value ${uc.value}/5`, uc.feasibility && `feasibility ${uc.feasibility}/5`].filter(Boolean).join(" ");
    db().transaction(() => {
      const play = applyEntityChange({ accountId, entityType: "play", op: "create", payload: { title: uc.name, thesis: thesis || null, status: "proposed", phase: uc.phase }, actorUserId: user.id });
      saveWorkshop(accountId, { ...workshop, use_cases: workshop.use_cases.map((u) => (u.id === useCaseId ? { ...u, play_id: play.entityId } : u)) }, user.id, updatedAt);
    })();
    refresh(accountId);
    return { ok: true, message: `On the roadmap, phase ${uc.phase}.` };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
}
