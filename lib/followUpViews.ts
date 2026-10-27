// A follow-up as the editable list shows it: its quoted source, the meeting
// it came from, and where else it was said. The account's Overview and its
// Follow-ups tab both list them, so the mapping lives once.
import type { ActionItemView } from "@/components/ActionItems";
import type { ActionItemRow, MeetingRow } from "./db";
import { followUpSources } from "./queries/followUpSources";

export function followUpViews(items: ActionItemRow[], meetings: Pick<MeetingRow, "id" | "title" | "held_at">[]): ActionItemView[] {
  const titles = new Map(meetings.map((m) => [m.id, `${m.title} (${m.held_at.slice(0, 10)})`]));
  const sources = followUpSources(items);
  return items.map((a) => {
    let quote: string | null = null;
    try {
      quote = a.source_ref_json ? ((JSON.parse(a.source_ref_json) as { quote?: string | null }).quote ?? null) : null;
    } catch {
      quote = null;
    }
    return {
      id: a.id,
      text: a.text,
      owner: a.owner,
      ownerUserId: a.owner_user_id ?? null,
      due: a.due,
      status: a.status,
      quote,
      version: a.updated_at,
      playId: a.play_id ?? null,
      meetingTitle: a.meeting_id ? (titles.get(a.meeting_id) ?? null) : null,
      sources: sources.get(a.id),
    };
  });
}
