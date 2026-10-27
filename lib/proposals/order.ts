import type { ProposalRow } from "../db";

// Review and accept-all order: the account header first, then the rows other
// proposals refer to (contacts, deals), then snapshots, then plays and
// action items that link to those rows.
const RANK: Record<string, number> = {
  account: 0,
  contact: 1,
  deal: 2,
  install_base: 3,
  meeting: 4,
  play: 5,
  action_item: 6,
};

export function reviewOrder(rows: ProposalRow[]): ProposalRow[] {
  return [...rows].sort((a, b) => {
    const r = (RANK[a.entity_type] ?? 9) - (RANK[b.entity_type] ?? 9);
    if (r !== 0) return r;
    if (a.op !== b.op) return a.op === "create" ? -1 : 1;
    return a.created_at - b.created_at;
  });
}
