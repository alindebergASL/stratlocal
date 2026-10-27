// The deals that need a look this week, for one person, worked out in code.
//
// Friday review starts here rather than with a model: the rule is plain, it
// is shown with the list, and it caps at five so the review is a few minutes
// and not six hundred rows (docs/plans/2026-10-20-ui-overhaul-options.md,
// Round 2). The model then writes the review around these deals.
import { db, type DocumentRow } from "../db";
import { needsNextStep } from "../deals/nextStep";
import { parseNote } from "../research/notes";
import { briefItemsOf } from "../research/brief";
import { listOpenDeals } from "./accounts";
import { listMovement, listStalled } from "./movement";
import { EVERYTHING, type OwnerScope } from "./owner";
import { currentFiscalQuarter, fiscalQuarter, quarterLabel } from "../fiscal";
import { todayISO } from "../clock";

export type LookReason = "close_past" | "pushed_out" | "no_next_step" | "quiet" | "partner_changed";
export type NeedsALook = { dealId: string; name: string; accountId: string; accountName: string; tcvUsd: number | null; reason: LookReason; why: string };

export const LOOK_CAP = 5;
export const LOOK_RULE =
  "Open deals on your accounts and the shared ones, in this order: the close date has passed, pushed out this week, no next step this quarter, no change in three weeks, then changed by a teammate this week. Five at most.";

const DAY = 86_400_000;

/**
 * For one person (`me`): deals on accounts they own and on the shared ones
 * nobody owns — both are theirs to look after. With no one, every account.
 */
export function needsALook(me: string | null, now = new Date()): { items: NeedsALook[]; more: number; byReason: Record<LookReason, number> } {
  const today = todayISO(now);
  const quarter = currentFiscalQuarter(now);
  const scope: OwnerScope = EVERYTHING;
  // An account owned by someone who is not one of the users — a name from an
  // import, someone who left — is nobody's here, so it is shared.
  const users = new Set((db().prepare(`SELECT id FROM users`).all() as Array<{ id: string }>).map((u) => u.id));
  const owners = new Map((db().prepare(`SELECT id, owner_user_id FROM accounts`).all() as Array<{ id: string; owner_user_id: string | null }>).map((a) => [a.id, a.owner_user_id]));
  const mine = (accountId: string) => {
    const owner = owners.get(accountId);
    return !me || owner == null || owner === me || !users.has(owner);
  };
  const open = listOpenDeals({ scope }).filter((d) => mine(d.account_id));
  const seen = new Set<string>();
  const all: NeedsALook[] = [];
  const add = (d: { deal_id: string; name: string; account_id: string; account_name: string; tcv_usd: number | null }, reason: LookReason, why: string) => {
    if (seen.has(d.deal_id)) return;
    seen.add(d.deal_id);
    all.push({ dealId: d.deal_id, name: d.name, accountId: d.account_id, accountName: d.account_name, tcvUsd: d.tcv_usd, reason, why });
  };
  const byId = new Map(open.map((d) => [d.deal_id, d]));

  for (const d of open) if (d.close_date && d.close_date < today) add(d, "close_past", `close date ${d.close_date} has passed`);

  for (const m of listMovement(now.getTime() - 7 * DAY, { scope })) {
    const d = byId.get(m.dealId);
    if (d && m.kind === "pushed_out") add(d, "pushed_out", `pushed out this week${m.from && m.to ? ` (${m.from} → ${m.to})` : ""}`);
  }

  for (const d of open) {
    const q = quarterLabel(d.fiscal_quarter) ?? (d.close_date ? (fiscalQuarter(d.close_date)?.label ?? null) : null);
    if (q === quarter.label && needsNextStep(d, todayISO(now))) add(d, "no_next_step", `no next step, closes in ${quarter.label}`);
  }

  for (const s of listStalled(now.getTime() - 21 * DAY, quarter, { scope })) {
    const d = byId.get(s.dealId);
    if (d) add(d, "quiet", "no change in three weeks");
  }

  if (me) {
    const changed = db()
      .prepare(
        `SELECT DISTINCT entity_id FROM change_log WHERE entity_type = 'deal' AND created_at >= ? AND actor_user_id IS NOT NULL AND actor_user_id <> ?
           AND actor_user_id IN (SELECT id FROM users)`,
      )
      .all(now.getTime() - 7 * DAY, me) as Array<{ entity_id: string }>;
    for (const c of changed) {
      const d = byId.get(c.entity_id);
      if (d) add(d, "partner_changed", "a teammate changed it this week");
    }
  }

  const byReason = { close_past: 0, pushed_out: 0, no_next_step: 0, quiet: 0, partner_changed: 0 } as Record<LookReason, number>;
  for (const i of all) byReason[i.reason] += 1;
  return { items: all.slice(0, LOOK_CAP), more: Math.max(0, all.length - LOOK_CAP), byReason };
}

export type KeptReason = { accountId: string; accountName: string; kind: "compelling_event" | "trigger"; text: string; date: string | null; research: string };
export const REASONS_CAP = 3;

/**
 * Reasons to act kept this week on one person's accounts (and the shared
 * ones): a compelling event or a trigger, from the research brief's own read,
 * on a note accepted in the last seven days. One per account, compelling
 * events first, three at most.
 */
export function reasonsKeptThisWeek(me: string | null, now = new Date()): KeptReason[] {
  const since = now.getTime() - 7 * DAY;
  const users = new Set((db().prepare(`SELECT id FROM users`).all() as Array<{ id: string }>).map((u) => u.id));
  const rows = db()
    .prepare(
      `SELECT d.*, a.name AS account_name, a.owner_user_id FROM documents d JOIN accounts a ON a.id = d.account_id
        WHERE d.kind = 'research_note' AND d.status = 'accepted' AND d.archived_at IS NULL AND a.archived_at IS NULL`,
    )
    .all() as Array<DocumentRow & { account_name: string; owner_user_id: string | null }>;
  const best = new Map<string, KeptReason>();
  for (const r of rows) {
    if (me && r.owner_user_id && r.owner_user_id !== me && users.has(r.owner_user_id)) continue;
    const note = parseNote(r);
    if (!note?.meta.accepted_at || Date.parse(note.meta.accepted_at) < since) continue;
    for (const item of briefItemsOf([note])) {
      const signal = item.read?.signal;
      if (!signal) continue;
      const prior = best.get(r.account_id);
      if (prior && (prior.kind === "compelling_event" || signal === "trigger")) continue;
      best.set(r.account_id, { accountId: r.account_id, accountName: r.account_name, kind: signal, text: item.finding.text, date: item.finding.date, research: `${item.noteId}#${item.index}` });
    }
  }
  return [...best.values()].sort((a, b) => (a.kind === b.kind ? (b.date ?? "").localeCompare(a.date ?? "") : a.kind === "compelling_event" ? -1 : 1)).slice(0, REASONS_CAP);
}
