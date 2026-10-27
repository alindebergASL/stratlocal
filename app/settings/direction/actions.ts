"use server";
// Saving the team's direction (lib/teamDirection.ts).
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { saveDirection } from "@/lib/teamDirection";
import { ApplyError } from "@/lib/proposals/apply";
import type { ActionResult } from "@/components/attempt";

const field = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export async function saveDirectionAction(fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const basis = field(fd, "basis_id").trim();
  try {
    saveDirection({
      focusAreas: field(fd, "focus_areas").split("\n"),
      goals: field(fd, "goals"),
      signals: field(fd, "signals"),
      avoid: field(fd, "avoid"),
      userId: user.id,
      basisId: basis || null,
    });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/settings/direction");
  return { ok: true };
}
