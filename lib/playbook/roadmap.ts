// The account's roadmap and Mutual Action Plan: plays by phase, the dated
// milestones linked to them, and the customer's budget calendar the dates
// are set against.
import { listPlays } from "../queries/accounts";
import { listActionItems } from "../queries/meetings";
import type { AccountRow, ActionItemRow, PlayRow } from "../db";

export const PHASES = [1, 2, 3] as const;

export function roadmap(accountId: string): { phases: Array<{ phase: number; plays: PlayRow[] }>; milestones: Array<ActionItemRow & { play: PlayRow }> } {
  const plays = listPlays(accountId).filter((p) => p.phase);
  const byId = new Map(plays.map((p) => [p.id, p]));
  const milestones = listActionItems(accountId)
    .filter((a) => a.play_id && byId.has(a.play_id))
    .map((a) => ({ ...a, play: byId.get(a.play_id!)! }))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.text.localeCompare(b.text));
  return { phases: PHASES.map((phase) => ({ phase, plays: plays.filter((p) => p.phase === phase) })), milestones };
}

/** The next start of the customer's fiscal year on or after a day, or null when not known. */
export function nextFiscalStart(account: Pick<AccountRow, "fiscal_year_start_month">, today: string): string | null {
  const m = account.fiscal_year_start_month;
  if (!m) return null;
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${String(m).padStart(2, "0")}-01`;
  return thisYear >= today ? thisYear : `${year + 1}-${String(m).padStart(2, "0")}-01`;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
