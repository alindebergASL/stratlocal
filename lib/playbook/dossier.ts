// What is on file for the playbook's first step, the pre-meeting
// intelligence: the installed base from the latest import, the research kept,
// and when the customer's money is set. Read from the records; nothing new.
import { db } from "../db";
import { installBaseTrend } from "../queries/accounts";
import type { AccountRow } from "../db";
import { nextFiscalStart } from "./roadmap";

export type Dossier = {
  installBase: { asOf: string | null; previousAsOf: string | null; totalUsd: number; lines: number; top: Array<{ family: string; valueUsd: number | null; changeUsd: number | null; gone: boolean; wasUsd: number | null }> };
  research: { kept: number; lastKept: number | null };
  budget: { fiscalStart: string | null; calendar: string | null };
};

export function dossier(account: AccountRow, today: string): Dossier {
  const ib = installBaseTrend(account.id);
  const live = ib.rows.filter((r) => !r.gone);
  const research = db()
    .prepare(`SELECT COUNT(*) AS n, MAX(created_at) AS at FROM documents WHERE account_id = ? AND kind = 'research_note' AND status = 'accepted' AND archived_at IS NULL`)
    .get(account.id) as { n: number; at: number | null };
  return {
    installBase: {
      asOf: ib.asOf,
      previousAsOf: ib.previousAsOf,
      totalUsd: live.reduce((s, r) => s + (r.value_usd ?? 0), 0),
      lines: live.length,
      top: ib.rows.slice(0, 6).map((r) =>
        r.gone
          ? { family: r.product_family, valueUsd: null, changeUsd: null, gone: true, wasUsd: r.previous_value_usd }
          : { family: r.product_family, valueUsd: r.value_usd, changeUsd: r.previous_value_usd != null && r.value_usd != null ? r.value_usd - r.previous_value_usd : null, gone: false, wasUsd: r.previous_value_usd },
      ),
    },
    research: { kept: research.n, lastKept: research.at },
    budget: { fiscalStart: nextFiscalStart(account, today), calendar: account.budget_calendar ?? null },
  };
}
