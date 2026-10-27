// The order of an account's plays: the live ones as the team ranked them
// (#1 is the top priority), then those kept for information, then those that
// are done or set aside (DECISIONS #87). A play never ranked keeps its place
// after the ranked ones, oldest first.
import { db, type PlayRow } from "../db";
import { applyEntityChange } from "../proposals/apply";
import { LIVE_PLAY_STATUSES } from "../tone";

const live = (p: { status: string }) => (LIVE_PLAY_STATUSES as readonly string[]).includes(p.status);
const GROUP: Record<string, number> = { info_only: 1, won: 2, dropped: 3, not_applicable: 3 };
const group = (p: { status: string }) => (live(p) ? 0 : (GROUP[p.status] ?? 3));

export function rankedPlays<T extends Pick<PlayRow, "status" | "sort_order" | "created_at">>(plays: T[]): T[] {
  return [...plays].sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    const ra = a.sort_order > 0 ? a.sort_order : Number.MAX_SAFE_INTEGER;
    const rb = b.sort_order > 0 ? b.sort_order : Number.MAX_SAFE_INTEGER;
    return ra - rb || a.created_at - b.created_at;
  });
}

/** Move a live play one place up or down, renumbering the live plays 1..n. */
export function movePlay(accountId: string, playId: string, by: -1 | 1, userId: string): void {
  db().transaction(() => {
    const plays = rankedPlays((db().prepare(`SELECT * FROM plays WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL`).all(accountId) as PlayRow[]).filter(live));
    const i = plays.findIndex((p) => p.id === playId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= plays.length) return;
    [plays[i], plays[j]] = [plays[j]!, plays[i]!];
    plays.forEach((p, n) => {
      if (p.sort_order !== n + 1) applyEntityChange({ accountId, entityType: "play", op: "update", entityId: p.id, payload: { sort_order: n + 1 }, actorUserId: userId });
    });
  })();
}
