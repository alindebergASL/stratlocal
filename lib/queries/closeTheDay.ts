// Close the day, for one person: what they did today, the loose ends, and
// tomorrow's first meeting. It opens on what you did, not on what you missed
// (docs/plans/2026-10-20-ui-overhaul-options.md, Round 2).
import { db } from "../db";
import { addDays, dayOf, todayISO } from "../clock";
import { entityLabels } from "./labels";
import { listOpenFollowUps } from "./meetings";
import { upcomingMeetings, type UpcomingMeeting } from "./today";

export type DidItem = { kind: string; id: string; label: string; accountId: string; accountName: string; fields: number; href: string; what: string };
export type LooseEnd = { id: string; text: string; accountId: string; accountName: string; due: string; version: number };

const NOUN: Record<string, string> = { deal: "deal", contact: "person", play: "play", meeting: "meeting", action_item: "follow-up", account: "account", install_base: "install base", document: "document" };

function hrefFor(kind: string, accountId: string, id: string): string {
  switch (kind) {
    case "deal":
      return `/accounts/${accountId}/deals/${encodeURIComponent(id)}`;
    case "play":
      return `/accounts/${accountId}/plays/${id}`;
    case "contact":
      return `/accounts/${accountId}/contacts/${id}`;
    case "meeting":
      return `/accounts/${accountId}/meetings/${id}`;
    case "action_item":
      return `/follow-ups/${id}`;
    default:
      return `/accounts/${accountId}`;
  }
}

export function closeTheDay(me: string, now = new Date()): { today: string; tomorrow: string; did: DidItem[]; decided: number; loose: LooseEnd[]; tomorrowFirst: UpcomingMeeting | null } {
  const today = todayISO(now);
  const tomorrow = addDays(today, 1);
  const since = now.getTime() - 36 * 3_600_000;

  const rows = (
    db()
      .prepare(
        `SELECT c.entity_type, c.entity_id, c.account_id, a.name AS account_name, c.field, c.new_value, MAX(c.created_at) AS at, COUNT(*) AS n
         FROM change_log c JOIN accounts a ON a.id = c.account_id
         WHERE c.actor_user_id = ? AND c.created_at >= ?
         GROUP BY c.entity_type, c.entity_id ORDER BY at DESC`,
      )
      .all(me, since) as Array<{ entity_type: string; entity_id: string; account_id: string; account_name: string; field: string; new_value: string | null; at: number; n: number }>
  ).filter((r) => dayOf(r.at) === today);

  const labels = new Map<string, Record<string, string>>();
  const did: DidItem[] = rows.slice(0, 20).map((r) => {
    if (!labels.has(r.account_id)) labels.set(r.account_id, entityLabels(r.account_id));
    const label = labels.get(r.account_id)![r.entity_id] ?? (r.entity_type === "account" ? r.account_name : (NOUN[r.entity_type] ?? r.entity_type));
    const done = r.entity_type === "action_item" && r.field === "status" && r.new_value === '"done"';
    return {
      kind: r.entity_type,
      id: r.entity_id,
      label,
      accountId: r.account_id,
      accountName: r.account_name,
      fields: r.n,
      href: hrefFor(r.entity_type, r.account_id, r.entity_id),
      what: done ? "marked done" : `${r.n} change${r.n === 1 ? "" : "s"} to the ${NOUN[r.entity_type] ?? r.entity_type}`,
    };
  });

  const decided = (
    db().prepare(`SELECT decided_at AS at FROM proposals WHERE decided_by = ? AND decided_at >= ? AND status IN ('accepted', 'rejected')`).all(me, since) as Array<{ at: number }>
  ).filter((r) => dayOf(r.at) === today).length;

  const loose: LooseEnd[] = listOpenFollowUps({ ownerUserId: me })
    .filter((i) => i.due && i.due <= today)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))
    .slice(0, 12)
    .map((i) => ({ id: i.id, text: i.text, accountId: i.account_id, accountName: i.account_name, due: i.due!, version: i.updated_at }));

  const tomorrowFirst =
    upcomingMeetings(now, 2)
      .filter((m) => m.heldAt.slice(0, 10) === tomorrow)
      .sort((a, b) => (a.heldTime ?? "99:99").localeCompare(b.heldTime ?? "99:99"))[0] ?? null;

  return { today, tomorrow, did, decided, loose, tomorrowFirst };
}
