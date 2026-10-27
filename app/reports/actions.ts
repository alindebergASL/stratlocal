"use server";
// Sharing and retiring an Ask report (lib/ask/report.ts). The link is the
// handoff's, on the same terms: a fresh token, an expiry, an optional
// passphrase, and ending it is immediate (lib/handoff/store.ts).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getReport } from "@/lib/ask/report";
import { archiveDocument } from "@/lib/documents";
import { DEFAULT_SHARE_DAYS, HandoffError, reshare, revokeShare } from "@/lib/handoff/store";
import type { ActionResult } from "@/components/attempt";
import { archiveTemplate, questionForReport, saveTemplate } from "@/lib/ask/templates";
import { ApplyError } from "@/lib/proposals/apply";
import { clearSchedule, setSchedule } from "@/lib/ask/schedules";
import { z } from "zod";

export async function shareReportAction(docId: string, fd: FormData): Promise<ActionResult> {
  await requirePageUser();
  if (!getReport(docId)) return { ok: false, error: "That report is not available." };
  try {
    reshare(docId, Number(fd.get("share_days") ?? DEFAULT_SHARE_DAYS), Date.now(), String(fd.get("passphrase") ?? ""));
  } catch (e) {
    if (e instanceof HandoffError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/reports/${docId}`);
  return { ok: true };
}

export async function endReportShareAction(docId: string): Promise<ActionResult> {
  await requirePageUser();
  revokeShare(docId);
  revalidatePath(`/reports/${docId}`);
  return { ok: true };
}

export async function archiveReportAction(docId: string): Promise<void> {
  const user = await requirePageUser();
  if (getReport(docId)) archiveDocument(docId, user.id);
  revalidatePath("/reports");
  redirect("/reports");
}

export async function saveTemplateAction(docId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const found = getReport(docId);
  if (!found) return { ok: false, error: "That report is not available." };
  const question = questionForReport(docId);
  if (!question) return { ok: false, error: "The question behind this report is no longer on file." };
  try {
    saveTemplate({
      name: String(fd.get("name") ?? ""),
      question,
      sections: found.report.sections.map((s) => s.heading),
      scope: found.report.accountName ? "account" : "all",
      userId: user.id,
    });
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/reports");
  return { ok: true };
}

export async function archiveTemplateAction(templateId: string): Promise<void> {
  await requirePageUser();
  archiveTemplate(templateId);
  revalidatePath("/reports");
}

export async function setScheduleAction(templateId: string, fd: FormData): Promise<ActionResult> {
  const user = await requirePageUser();
  const days = fd.getAll("days").map(Number).filter((n) => Number.isInteger(n));
  if (days.length === 0) return { ok: false, error: "Pick at least one day." };
  try {
    setSchedule(templateId, { days, at: String(fd.get("at") ?? ""), forUserId: String(fd.get("for") ?? user.id) }, user.id);
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: "Pick a time, like 07:00." };
    throw e;
  }
  revalidatePath("/reports");
  return { ok: true };
}

export async function clearScheduleAction(templateId: string): Promise<void> {
  await requirePageUser();
  clearSchedule(templateId);
  revalidatePath("/reports");
}
