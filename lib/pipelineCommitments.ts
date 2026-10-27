import { db } from "./db";
import { sourceRefOf } from "./nextStepCommitments";

/** One set lookup for the displayed pipeline, never a guess from task wording. */
export function dealCommitmentCounts(deals: { account_id: string; deal_id: string }[]): Map<string, { open: number; total: number }> {
  const counts = new Map<string, { open: number; total: number }>();
  if (!deals.length) return counts;
  const expected = new Map(deals.map((d) => [d.deal_id, d.account_id]));
  const accounts = [...new Set(deals.map((d) => d.account_id))];
  const rows = db().prepare(`SELECT account_id, source_ref_json, status, archived_at FROM action_items WHERE account_id IN (${accounts.map(() => "?").join(",")})`).all(...accounts) as { account_id: string; source_ref_json: string | null; status: string; archived_at: string | null }[];
  for (const row of rows) {
    const ref = sourceRefOf(row);
    if (ref?.kind !== "deal" || !ref.id || expected.get(ref.id) !== row.account_id) continue;
    const value = counts.get(ref.id) ?? { open: 0, total: 0 };
    value.total++;
    if (row.status === "open" && !row.archived_at) value.open++;
    counts.set(ref.id, value);
  }
  return counts;
}
/**
 * The line under a deal's next step when follow-ups are recorded against it,
 * or null when there are none: the next step itself is the one control, and
 * a second line saying "no next step" beside it was noise.
 */
export function followUpLine(counts?: { open: number; total: number }): string | null {
  if (counts?.open) return `${counts.open} open follow-up${counts.open === 1 ? "" : "s"}`;
  if (counts?.total) return "Follow-up history";
  return null;
}
