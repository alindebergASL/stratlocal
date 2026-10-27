"use server";
// Saying which spellings of a deal owner are one person (lib/dealOwners.ts).
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { confirmOwner, separateOwner } from "@/lib/dealOwners";
import { ApplyError } from "@/lib/proposals/apply";
import type { ActionResult } from "@/components/attempt";

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function confirmOwnerAction(spelling: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const name = text(fd, "name");
  if (!name) return { ok: false, error: "Choose the name this spelling is." };
  try {
    confirmOwner({ spelling, name, userId: user.id });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function separateOwnerAction(spelling: string): Promise<ActionResult> {
  await requirePageUser();
  separateOwner(spelling);
  revalidatePath("/", "layout");
  return { ok: true };
}
