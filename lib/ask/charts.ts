// Charts in answers and reports: the model picks which chart, the code draws
// the numbers.
//
// A chart is a picture of numbers, and a picture is believed. So the model
// never supplies a number: it names one of a few chart kinds and a scope, and
// the data is computed here from the same readers its tools use, at the
// moment the answer or report is written. That snapshot is what is stored and
// drawn — the chart agrees with the text written beside it, and a shared
// report shows the numbers as they were, like the rest of it.
import { z } from "zod";
import { getAccount, listOpenDeals } from "../queries/accounts";
import { listMovement, type MovementKind } from "../queries/movement";
import { EVERYTHING, type OwnerScope } from "../queries/owner";
import { fiscalQuarter, keyFromLabel, quarterLabel } from "../fiscal";
import { stageText } from "../format";
import { db } from "../db";
import type { ToolContext } from "./tools";
import { assertAskWriteContext } from "./writeContext";

export const CHART_KINDS = ["pipeline_by_quarter", "stage_mix", "movement", "account_comparison"] as const;

export const ChartSpec = z.object({
  kind: z.enum(CHART_KINDS).describe("pipeline_by_quarter: open value per fiscal quarter. stage_mix: open value per stage. movement: how many deals moved each way in the last N days. account_comparison: open value per account, largest first."),
  account_id: z.string().optional().describe("Limit to one account whose pipeline or movement was read this turn. Omitted: the report's account, or the answer's conversation account; across accounts only when that scope has no account. A chart in an account report cannot name a different account."),
  whose: z.enum(["mine", "theirs", "all"]).optional().describe("Whose accounts; default all."),
  days: z.number().int().min(1).max(120).optional().describe("For movement: the window in days; default 7."),
  title: z.string().max(80).optional().describe("A short title; one is made if left out."),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const ChartData = z.object({
  kind: z.enum(CHART_KINDS),
  title: z.string(),
  unit: z.enum(["usd", "count"]),
  rows: z.array(z.object({ label: z.string(), value: z.number(), detail: z.string().nullable() })).max(12),
  note: z.string().nullable(),
  asOf: z.string(),
});
export type ChartData = z.infer<typeof ChartData>;

const MOVE_LABEL: Partial<Record<MovementKind, string>> = {
  new: "New",
  won: "Won",
  lost: "Lost",
  pushed_out: "Pushed out",
  pulled_in: "Pulled in",
  stage_up: "Stage up",
  stage_down: "Stage down",
  value_up: "Value up",
  value_down: "Value down",
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Raw renderer for trusted callers/tests. Model requests must use computeCharts. */
export function computeChart(spec: ChartSpec, ctx: { userId: string; now: Date }): ChartData {
  const account = spec.account_id !== undefined ? getAccount(spec.account_id) : null;
  if (spec.account_id !== undefined && (!account || account.archived_at || account.merged_into)) throw new Error("That account is unavailable.");
  const scope: OwnerScope = !spec.whose || spec.whose === "all" ? EVERYTHING : { filter: spec.whose, me: ctx.userId };
  const on = account ? ` · ${account.name}` : "";
  const base = { note: null as string | null, asOf: ctx.now.toISOString().slice(0, 10) };

  if (spec.kind === "movement") {
    const days = spec.days ?? 7;
    const moves = listMovement(ctx.now.getTime() - days * 86_400_000, { accountId: account?.id ?? null, scope });
    const counts = new Map<string, number>();
    for (const m of moves) {
      const label = MOVE_LABEL[m.kind];
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const rows = Object.values(MOVE_LABEL)
      .filter((l) => counts.has(l!))
      .map((label) => ({ label: label!, value: counts.get(label!)!, detail: plural(counts.get(label!)!, "deal") }));
    return { ...base, kind: spec.kind, unit: "count", title: spec.title || `What moved, last ${days} days${on}`, rows, note: rows.length ? null : "Nothing moved in this window." };
  }

  const deals = listOpenDeals({ accountId: account?.id, scope });
  const group = new Map<string, { value: number; n: number; order: number }>();
  const add = (label: string, value: number, order: number) => {
    const g = group.get(label) ?? { value: 0, n: 0, order };
    g.value += value;
    g.n += 1;
    group.set(label, g);
  };
  for (const d of deals) {
    const v = d.tcv_usd ?? 0;
    if (spec.kind === "pipeline_by_quarter") {
      const q = quarterLabel(d.fiscal_quarter) ?? (d.close_date ? (fiscalQuarter(d.close_date)?.label ?? null) : null);
      add(q ?? "No quarter", v, q ? (keyFromLabel(q) ?? 9e9) : 9e9 + 1);
    } else if (spec.kind === "stage_mix") {
      add(stageText(d.stage, d.stage_label), v, d.stage ?? 99);
    } else {
      add(d.account_name, v, 0);
    }
  }
  let rows = [...group.entries()].map(([label, g]) => ({ label, value: g.value, detail: plural(g.n, "deal"), order: g.order }));
  rows = spec.kind === "account_comparison" ? rows.sort((a, b) => b.value - a.value) : rows.sort((a, b) => a.order - b.order);
  const more = Math.max(0, rows.length - 12);
  const title =
    spec.title ||
    (spec.kind === "pipeline_by_quarter" ? `Open pipeline by quarter${on}` : spec.kind === "stage_mix" ? `Open pipeline by stage${on}` : "Open pipeline by account");
  return {
    ...base,
    kind: spec.kind,
    unit: "usd",
    title,
    rows: rows.slice(0, 12).map(({ label, value, detail }) => ({ label, value, detail })),
    note: !rows.length ? "No open deals." : more ? `${more} more not shown.` : null,
  };
}

type ChartRead = { kind: "pipeline" | "movement"; accountId: string | null; whose?: "all" | "mine" | "theirs"; days?: number };

function chartReadSnapshot(read: ChartRead, ctx: Pick<ToolContext, "userId" | "now">) {
  const scope: OwnerScope = { filter: read.whose ?? "all", me: ctx.userId };
  const rows = read.kind === "movement"
    ? listMovement(ctx.now.getTime() - (read.days ?? 7) * 86_400_000, { accountId: read.accountId, scope })
    : listOpenDeals({ accountId: read.accountId ?? undefined, scope });
  const dealIds = rows.map((r) => "dealId" in r ? r.dealId : r.deal_id);
  const accountIds = [...new Set([...rows.map((r) => "accountId" in r ? r.accountId : r.account_id), ...(read.accountId === null ? [] : [read.accountId])])].sort();
  // Keep identities and account state, not just totals: equal sums can hide a
  // moved/replaced deal. Stable ordering avoids tie-order false mismatches.
  const snapshot = JSON.stringify({ rows: rows.map((r) => JSON.stringify(r)).sort(), accounts: accountIds.map(getAccount) });
  const key = JSON.stringify([read.kind, read.accountId, scope.filter, ctx.userId, read.kind === "movement" ? [read.days ?? 7, ctx.now.getTime()] : null]);
  return { key, snapshot, dealIds, accountIds };
}

/** Only successful, full-scope tool queries grant aggregate chart evidence.
 * Capped pipeline/movement displays still return whole-query totals; a capped
 * accounts list does not. allowedAccounts prevents an accounts summary from
 * accidentally covering non-customer/otherwise unreturned accounts.
 */
export function rememberChartRead(ctx: ToolContext, read: ChartRead, allowedAccounts?: string[]): void {
  for (const whose of !read.whose || read.whose === "all" ? ["all", "mine", "theirs"] as const : [read.whose]) {
    const observed = chartReadSnapshot({ ...read, whose }, ctx);
    if (allowedAccounts && observed.accountIds.some((id) => !allowedAccounts.includes(id))) continue;
    ctx.readState?.rememberChart(observed.key, observed.snapshot, observed.dealIds);
  }
}

/** Model-facing gate, shared by answers and reports. Missing/unproven/stale
 * charts are omitted, never replaced by a broader or partial chart. An answer
 * defaults to its thread account; a report explicitly supplies its own scope.
 */
export function computeCharts(specs: ChartSpec[] | undefined, ctx: ToolContext, reportScope?: { accountId: string | null }): ChartData[] {
  return db().transaction(() => {
    const out: ChartData[] = [];
    for (const raw of specs ?? []) {
      try {
        const spec = ChartSpec.parse(raw);
        const accountId = spec.account_id ?? (reportScope ? reportScope.accountId : ctx.accountId);
        if (reportScope?.accountId && accountId !== reportScope.accountId) continue;
        if (accountId !== null) {
          const account = getAccount(accountId);
          if (!account || account.archived_at || account.merged_into) continue;
        }
        const state = assertAskWriteContext(ctx, accountId);
        const read = chartReadSnapshot({ kind: spec.kind === "movement" ? "movement" : "pipeline", accountId, whose: spec.whose, days: spec.days }, ctx);
        state.assertChart(read.key, read.snapshot);
        out.push(computeChart({ ...spec, account_id: accountId ?? undefined }, ctx));
      } catch {
        // Invalid scope or stale/unread data: no chart, rather than a wrong one.
      }
    }
    return out;
  })();
}
