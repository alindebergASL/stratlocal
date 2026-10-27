import { meetingCutoff } from "./clock";
import { nextAccountMeeting } from "./glance";
import type { AttentionItem } from "./queries/attention";
import type { UpcomingMeeting, RecentChange } from "./queries/today";

export type AgendaTask = { title: string; accountName: string; reason: string; label: string; href: string };
const textOrder = (a: string, b: string) => a.localeCompare(b, "en");
export function chooseAgendaTask(today: string, upcoming: UpcomingMeeting[], notes: UpcomingMeeting[], attention: AttentionItem[]): AgendaTask | null {
  const meetings = [...upcoming].sort((a, b) => textOrder(a.heldAt, b.heldAt) || textOrder(a.heldTime ?? "99:99", b.heldTime ?? "99:99") || textOrder(a.accountName, b.accountName) || textOrder(a.title, b.title) || textOrder(a.id, b.id));
  const work = (kind: AttentionItem["kind"]) => [...attention].filter(i => i.kind === kind).sort((a, b) => textOrder(a.due ?? "", b.due ?? "") || textOrder(a.accountName, b.accountName) || textOrder(a.text, b.text) || textOrder(a.href, b.href))[0];
  const meetingTask = (m: UpcomingMeeting, missingNotes = false): AgendaTask => ({ title: m.title, accountName: m.accountName, reason: `${missingNotes ? "No notes saved · scheduled" : "Scheduled"} ${m.heldAt} · ${m.heldTime ?? "time not set"}`, label: missingNotes ? "Write notes" : m.hasBrief ? "Read brief" : "Prepare brief", href: `${m.href}#${missingNotes ? "notes" : "brief"}` });
  const todayMeeting = meetings.find(m => m.heldAt === today);
  if (todayMeeting) return meetingTask(todayMeeting);
  const due = work("overdue") ?? work("due_today");
  if (due) return { title: due.text, accountName: due.accountName, reason: `${due.unit === "play" ? "Play next step" : "Follow-up"} · ${due.kind === "overdue" ? "past due" : "due today"} · ${due.due ?? due.detail ?? "recorded due date"}`, label: due.unit === "play" ? "Review play next step" : "Review follow-up", href: due.href };
  const review = work("proposals");
  if (review) return { title: "Proposed changes", accountName: review.accountName, reason: `${review.count ?? 0} proposed changes awaiting an explicit decision`, label: "Review changes", href: review.href };
  if (meetings[0]) return meetingTask(meetings[0]);
  const gap = [...notes].sort((a,b) => textOrder(b.heldAt, a.heldAt) || textOrder(b.heldTime ?? "", a.heldTime ?? "") || textOrder(a.accountName,b.accountName) || textOrder(a.id,b.id))[0];
  return gap ? meetingTask(gap, true) : null;
}

export const MEETING_SECTIONS = ["brief", "notes", "review", "follow-ups", "meeting-summary"] as const;
export type MeetingFocus = typeof MEETING_SECTIONS[number];
export function meetingFocus(input: { archived: boolean; pending: number; upcoming: boolean; hasNotes: boolean; openFollowUps: number }): MeetingFocus {
  if (input.archived) return "notes";
  if (input.pending) return "review";
  if (input.upcoming) return "brief";
  if (!input.hasNotes) return "notes";
  return input.openFollowUps ? "follow-ups" : "notes";
}
export function scheduledUpcoming(meeting: { id: string; held_at: string; held_time?: string | null }, now: Date): boolean {
  return nextAccountMeeting([meeting], now) !== null;
}
// Match Today's elapsed-window predicate, including meetings across midnight.
export function scheduledElapsed(meeting: { held_at: string; held_time?: string | null }, now: Date): boolean {
  const cutoff = meetingCutoff(now);
  const day = meeting.held_at.slice(0, 10);
  return day < cutoff.day || (day === cutoff.day && meeting.held_time != null && meeting.held_time <= cutoff.time);
}
export function focusFromHash(hash: string, fallback: MeetingFocus): MeetingFocus {
  return MEETING_SECTIONS.find(s => hash === `#${s}`) ?? fallback;
}

// Edits are day aggregates: describe fields, never infer creation, actor order or causation.
export function activityDescription(change: RecentChange): string {
  if (change.kind === "batch") return "Proposed changes applied";
  const fields = change.changes.map(c => c.field);
  if (change.entityType === "action_item" && fields.length === 1 && fields[0] === "due") return "Follow-up due date changed";
  const names: Record<string, string> = { meeting: "Meeting", action_item: "Follow-up", account: "Account", deal: "Deal", play: "Play", contact: "Person", document: "Document" };
  return `${names[change.entityType] ?? "Record"} updated`;
}
