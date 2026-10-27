import { meetingCutoff, nowHHMM, todayISO } from "./clock";
import type { OwnerFilter } from "./queries/owner";

export const HOME_VIEWS = ["upcoming", "notes", "review", "overdue", "due-today", "next-steps"] as const;
export type HomeView = (typeof HOME_VIEWS)[number];
// Repeated and unknown values have the same, deterministic overview fallback.
export function parseHomeView(raw: string | string[] | undefined): HomeView | null {
  return HOME_VIEWS.find((v) => v === raw) ?? null;
}
export function homeHref(who: OwnerFilter, view: HomeView | null = null): string {
  const q = new URLSearchParams();
  if (who !== "all") q.set("who", who);
  if (view) q.set("view", view);
  return q.size ? `/?${q}` : "/";
}
export function countLabel(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
export function overdueLabel(items: Array<{ unit?: "follow-up" | "play" }>): string {
  return (["follow-up", "play"] as const).map((unit) => {
    const n = items.filter((i) => i.unit === unit).length;
    return n ? `${countLabel(n, unit)} past due` : "";
  }).filter(Boolean).join(" · ");
}
// Same one-hour cutoff as Today; unknown times stay scheduled, never 'Now'.
export function nextAccountMeeting<T extends { id: string; held_at: string; held_time?: string | null }>(meetings: T[], now: Date): (T & { inProgress: boolean }) | null {
  const cutoff = meetingCutoff(now), today = todayISO(now), clock = nowHHMM(now);
  const next = meetings.filter((m) => {
    const day = m.held_at.slice(0, 10);
    return day >= today && !(day < cutoff.day || (day === cutoff.day && m.held_time != null && m.held_time <= cutoff.time));
  }).sort((a, b) => a.held_at.localeCompare(b.held_at) || (a.held_time ?? "99:99").localeCompare(b.held_time ?? "99:99") || a.id.localeCompare(b.id))[0];
  return next ? { ...next, inProgress: next.held_at.slice(0, 10) === today && next.held_time != null && next.held_time <= clock } : null;
}
