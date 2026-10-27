"use server";
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { ApplyError } from "@/lib/proposals/apply";
import { addMember, changeOwnPassword, setActive, setMember } from "@/lib/team/members";
import { MAX_LOGO_BYTES, branding, saveBranding } from "@/lib/team/branding";

type FormResult = { ok: true } | { ok: false; error: string };
type Result = { ok: true; message?: string } | { ok: false; error: string };

const tried = (fn: () => void): FormResult => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    const issues = (e as { issues?: Array<{ path: unknown[]; message: string }> }).issues;
    if (issues) return { ok: false, error: issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ") };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true };
};

export async function addMemberAction(fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  return tried(() => {
    addMember({ email: String(fd.get("email") ?? ""), name: String(fd.get("name") ?? ""), password: String(fd.get("password") ?? ""), role: String(fd.get("role") ?? "") || null, isAdmin: fd.get("is_admin") === "on" }, user.id);
  });
}

export async function setMemberAction(userId: string, fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  return tried(() => setMember(userId, { role: String(fd.get("role") ?? "") || null, isAdmin: fd.get("is_admin") === "on", name: String(fd.get("name") ?? "") }, user.id));
}

export async function setActiveAction(userId: string, active: boolean): Promise<Result> {
  const user = await requirePageUser();
  const r = tried(() => setActive(userId, active, user.id));
  return r.ok ? { ok: true, message: active ? "They can sign in again." : "Signed out, and cannot sign in." } : r;
}

export async function changePasswordAction(fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  return tried(() => changeOwnPassword(user.id, String(fd.get("current") ?? ""), String(fd.get("next") ?? "")));
}

export async function saveBrandingAction(fd: FormData): Promise<FormResult> {
  const user = await requirePageUser();
  const { findUserById } = await import("@/lib/auth");
  if (!findUserById(user.id)?.is_admin) return { ok: false, error: "Only an admin can change how the app looks." };
  let logo: string | null | undefined = undefined;
  const file = fd.get("logo");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) return { ok: false, error: `The logo must be under ${Math.round(MAX_LOGO_BYTES / 1024)} KB.` };
    if (!["image/png", "image/jpeg", "image/svg+xml"].includes(file.type)) return { ok: false, error: "The logo must be a PNG, JPEG or SVG image." };
    logo = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  }
  const current = branding();
  return tried(() =>
    saveBranding(
      {
        appName: String(fd.get("app_name") ?? "").trim() || current.appName,
        teamName: String(fd.get("team_name") ?? "").trim() || null,
        accent: String(fd.get("accent") ?? current.accent),
        logo: fd.get("remove_logo") === "on" ? null : (logo ?? current.logo),
      },
      user.id,
    ),
  );
}

export async function previewPackAction(text: string): Promise<{ ok: true; lines: string[]; problems: string[] } | { ok: false; error: string }> {
  await requirePageUser();
  const { readPack } = await import("@/lib/team/pack");
  const r = readPack(text);
  return r.ok ? { ok: true, lines: r.lines, problems: r.problems } : r;
}

export async function applyPackAction(text: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requirePageUser();
  const { applyPack } = await import("@/lib/team/pack");
  try {
    const r = applyPack(text, user.id);
    revalidatePath("/", "layout");
    return { ok: true, message: `Loaded: ${r.applied.join(", ") || "nothing"}.${r.skipped.length ? ` Skipped: ${r.skipped.join("; ")}.` : ""}` };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
}
