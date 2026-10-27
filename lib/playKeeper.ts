// Which play a title match actually means, once plays can be merged.
//
// Both importers match a play by normalised title against a list that includes
// archived rows, on purpose — an archived play the report still describes
// should be offered back rather than duplicated. A merged-away play is
// archived too, and it is the one case where that is exactly wrong: the report
// still names its title, the match lands on the tombstone, and the draft
// proposes clearing `archived_at`. One Accept all and the duplicate is back,
// on every import, forever. That is the deal lesson of Phase 6 arriving at the
// other record it applies to.
//
// Written once and read by diffExtraction and diffPlanDraft, because the same
// rule in two files is a rule that disagrees with itself — and the symptom
// here is not an error, it is a duplicate quietly reappearing.
import type { PlayRow } from "./db";

/**
 * Follow `merged_into` from the row a title matched to the play that survives.
 *
 * Returns undefined when the chain leads somewhere the caller cannot see. The
 * only honest answer then is to propose nothing: a create would make a third
 * row for the same play, and an update would be aimed at a tombstone. Silence
 * beats resurrection.
 *
 * The visited set and the depth cap are not decoration — this runs on a diff a
 * person is waiting for, and a cycle from bad data must not hang it.
 */
export function playKeeperOf(rows: PlayRow[], matched: PlayRow | undefined, maxDepth = 20): PlayRow | undefined {
  if (!matched) return undefined;
  const byId = new Map(rows.map((p) => [p.id, p]));
  const seen = new Set<string>([matched.id]);
  let row: PlayRow = matched;
  for (let depth = 0; depth < maxDepth && row.merged_into; depth += 1) {
    if (seen.has(row.merged_into)) return undefined;
    seen.add(row.merged_into);
    const next = byId.get(row.merged_into);
    if (!next) return undefined;
    row = next;
  }
  return row.merged_into ? undefined : row;
}
