// How the playbook is doing: deals won and lost over the last year, grouped
// by the archetype each account had when the deal closed, so the team can see
// which archetypes (and so which entry points) turn into wins. Worked out in
// code from the records; small groups give counts, not rates.
import { db } from "../db";
import type { Playbook } from "./schema";
import { defaultSlug } from "./store";

export const OUTCOME_DAYS = 365;
/** Below this many closed deals a rate says more than the numbers do. */
export const MIN_FOR_RATE = 5;

export type OutcomeRow = {
  archetypeId: string | null;
  name: string;
  entryPoint: string | null;
  won: number;
  lost: number;
  wonUsd: number;
  lostUsd: number;
  winRate: number | null;
  medianCycleDays: number | null;
  /** The playbook step these accounts most often reached before closing. */
  typicalStep: string | null;
};

type Closed = { deal_id: string; account_id: string; status: "won" | "lost"; tcv_usd: number | null; close_date: string; created_at: number };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
};

export function playbookOutcomes(playbook: Playbook, slug: string | null = null, today = new Date().toISOString().slice(0, 10)): OutcomeRow[] {
  const conn = db();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - OUTCOME_DAYS * 86_400_000).toISOString().slice(0, 10);
  const def = defaultSlug();
  const deals = conn
    .prepare(
      `SELECT d.deal_id, d.account_id, d.status, d.tcv_usd, d.close_date, d.created_at FROM deals d
       JOIN accounts a ON a.id = d.account_id AND a.kind = 'customer'
       WHERE d.status IN ('won','lost') AND d.archived_at IS NULL AND d.merged_into IS NULL
         AND d.close_date IS NOT NULL AND d.close_date >= ? AND d.close_date <= ?
         AND (? IS NULL OR COALESCE(a.playbook_slug, ?) = ?)`,
    )
    .all(since, today, slug, def, slug) as Closed[];
  // The archetype as of the end of the close date: the last change before it.
  const archetypeAt = conn.prepare(
    `SELECT new_value FROM change_log WHERE entity_type = 'account' AND entity_id = ? AND field = 'archetype_id' AND created_at < ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  );
  const stepsBefore = conn.prepare(`SELECT step_id FROM account_playbook_moves WHERE account_id = ? AND moved_at < ?`);
  const stepIndex = new Map(playbook.steps.map((s, i) => [s.id, i]));
  const groups = new Map<string | null, { won: number; lost: number; wonUsd: number; lostUsd: number; cycles: number[]; furthest: number[] }>();
  for (const d of deals) {
    const end = Date.parse(`${d.close_date}T00:00:00Z`) + 86_400_000;
    const raw = (archetypeAt.get(d.account_id, end) as { new_value: string | null } | undefined)?.new_value ?? null;
    let id: string | null = null;
    try {
      id = raw === null ? null : (JSON.parse(raw) as string | null);
    } catch {
      id = raw;
    }
    if (id && !playbook.archetypes.some((a) => a.id === id)) id = null;
    const g = groups.get(id) ?? { won: 0, lost: 0, wonUsd: 0, lostUsd: 0, cycles: [], furthest: [] };
    if (d.status === "won") {
      g.won++;
      g.wonUsd += d.tcv_usd ?? 0;
    } else {
      g.lost++;
      g.lostUsd += d.tcv_usd ?? 0;
    }
    const days = Math.round((end - 86_400_000 - d.created_at) / 86_400_000);
    if (days >= 0) g.cycles.push(days);
    const reached = (stepsBefore.all(d.account_id, end) as Array<{ step_id: string }>).map((m) => stepIndex.get(m.step_id) ?? -1).filter((i) => i >= 0);
    if (reached.length) g.furthest.push(Math.max(...reached));
    groups.set(id, g);
  }
  const order = [...playbook.archetypes.map((a) => a.id as string | null), null];
  return order.flatMap((id) => {
    const g = groups.get(id);
    if (!g) return [];
    const a = id ? playbook.archetypes.find((x) => x.id === id)! : null;
    const n = g.won + g.lost;
    const counts = new Map<number, number>();
    for (const f of g.furthest) counts.set(f, (counts.get(f) ?? 0) + 1);
    const typical = [...counts].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]?.[0];
    return [
      {
        archetypeId: id,
        name: a?.name ?? "Not classified when it closed",
        entryPoint: a?.entry_point || null,
        won: g.won,
        lost: g.lost,
        wonUsd: g.wonUsd,
        lostUsd: g.lostUsd,
        winRate: n >= MIN_FOR_RATE ? Math.round((g.won / n) * 100) : null,
        medianCycleDays: median(g.cycles),
        typicalStep: typical === undefined ? null : playbook.steps[typical]!.name,
      },
    ];
  });
}
