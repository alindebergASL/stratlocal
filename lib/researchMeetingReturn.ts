import { db } from "./db";
import type { BriefRefMap } from "./meetings/briefEvidence";
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
/** Only navigation context, never a source claim or an arbitrary return URL. */
export function researchMeetingHref(href: string, accountId: string, meetingId?: string): string {
  if (!meetingId || !safeId(meetingId)) return href;
  const route = `/accounts/${encodeURIComponent(accountId)}/research`;
  if (href !== route && !href.startsWith(`${route}?`) && !href.startsWith(`${route}#`)) return href;
  const index = href.indexOf("#"), base = index < 0 ? href : href.slice(0, index), hash = index < 0 ? "" : href.slice(index);
  if (new URLSearchParams(base.split("?")[1] ?? "").has("fromMeeting")) return href;
  return `${base}${base.includes("?") ? "&" : "?"}fromMeeting=${meetingId}${hash}`;
}
export function meetingReturn(accountId: string, value: unknown): { id: string; title: string; archived: boolean; href: string } | null {
  if (!safeId(value)) return null;
  const row = db().prepare("SELECT id, title, archived_at, merged_into FROM meetings WHERE account_id=? AND id=?").get(accountId, value) as { id: string; title: string; archived_at: string | null; merged_into: string | null } | undefined;
  if (!row || row.merged_into) return null;
  return { id: row.id, title: row.title, archived: !!row.archived_at, href: `/accounts/${encodeURIComponent(accountId)}/meetings/${encodeURIComponent(row.id)}#brief` };
}
export function researchRefsWithReturn(map: BriefRefMap, accountId: string, meetingId: string): BriefRefMap {
  return new Map([...map].map(([key, entry]) => [key, entry.href ? { ...entry, href: researchMeetingHref(entry.href, accountId, meetingId) } : entry]));
}
