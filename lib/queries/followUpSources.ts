import { db, type ActionItemRow } from "../db";
import { sourceRefOf } from "../nextStepCommitments";
export type FollowUpSource = { label: string; href?: string };
type Source = { account_id: string; kind: string; id: string; title: string; archived_at: string | null; merged_into: string | null };
/** Three bounded set reads in one query, not one database lookup per row. */
export function followUpSources(items: ActionItemRow[], returnFor?: (id: string) => string): Map<string, FollowUpSource[]> {
  const result = new Map<string, FollowUpSource[]>();
  if (!items.length) return result;
  const accounts = [...new Set(items.map((i) => i.account_id))];
  const slots = accounts.map(() => "?").join(",");
  const rows = db().prepare(`SELECT account_id, 'meeting' kind, id, title, archived_at, merged_into FROM meetings WHERE account_id IN (${slots})
    UNION ALL SELECT account_id, 'deal', deal_id, name, archived_at, merged_into FROM deals WHERE account_id IN (${slots})
    UNION ALL SELECT account_id, 'play', id, title, archived_at, merged_into FROM plays WHERE account_id IN (${slots})`).all(...accounts, ...accounts, ...accounts) as Source[];
  const index = new Map(rows.map((s) => [JSON.stringify([s.account_id, s.kind, s.id]), s]));
  for (const item of items) {
    const ref = sourceRefOf(item);
    const refs: { kind: string; id: string; membership?: boolean }[] = [];
    if (ref?.id && ["meeting", "deal", "play"].includes(ref.kind)) refs.push({ kind: ref.kind, id: ref.id });
    else {
      const meeting = ref?.refs?.find((r) => r.kind === "meeting");
      if (meeting) refs.push(meeting);
      else if (item.meeting_id) refs.push({ kind: "meeting", id: item.meeting_id, membership: true });
    }
    if (item.play_id && !refs.some((r) => r.kind === "play" && r.id === item.play_id)) refs.push({ kind: "play", id: item.play_id, membership: true });
    result.set(item.id, refs.map((r) => {
      const s = index.get(JSON.stringify([item.account_id, r.kind, r.id]));
      const prefix = r.membership ? `Current ${r.kind}` : `Source ${r.kind}`;
      if (!s) return { label: `${prefix} unavailable on this account` };
      const label = `${prefix}: ${s.title}${s.merged_into ? " (merged)" : s.archived_at ? " (archived)" : ""}`;
      // Keep provenance a tombstone, not a silently substituted merge survivor.
      if (s.merged_into) return { label };
      const base = `/accounts/${encodeURIComponent(item.account_id)}/${r.kind === "meeting" ? "meetings" : r.kind === "deal" ? "deals" : "plays"}/${encodeURIComponent(r.id)}`;
      return { label, href: returnFor ? `${base}?returnTo=${encodeURIComponent(returnFor(item.id))}` : base };
    }));
  }
  return result;
}
