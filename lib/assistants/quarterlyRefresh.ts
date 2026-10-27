// Quarterly refresh: once a quarter for each account the team runs through
// the playbook, the archetype is asked again (a suggestion to accept or turn
// down) and a follow-up lists what to re-check: qualification evidence that
// has gone a quarter without a change, what was never found out, and how old
// the kept research is. It proposes; it writes no record (DECISIONS #1).
import { db, OWN_WORK_ACCOUNT_ID, type AccountRow } from "../db";
import { addDays, todayISO } from "../clock";
import { BudgetError, runningRunFor } from "../ai/guard";
import { createProposalBatch } from "../proposals/apply";
import { getAccount } from "../queries/accounts";
import { currentPlaybook } from "../playbook/store";
import { archetypeOf, pendingArchetype, startArchetypeSuggestion } from "../playbook/archetype";
import { scorecard } from "../playbook/qualification";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";

export const REFRESH_EVERY_DAYS = 91;
export const QUARTERLY_REFRESH_AT = "06:40";
export const REFRESH_ORIGIN = "playbook_refresh";
const DAY = 86_400_000;

/** Accounts on the playbook (an archetype chosen or a step taken), with when each was last refreshed. */
export function refreshCandidates(): Array<{ id: string; name: string; last: number | null }> {
  return db()
    .prepare(
      `SELECT a.id, a.name,
              (SELECT MAX(p.created_at) FROM proposals p WHERE p.account_id = a.id AND p.origin_kind = 'plan_draft' AND p.origin_id = ?) AS last
         FROM accounts a
        WHERE a.archived_at IS NULL AND a.kind = 'customer' AND a.id != ?
          AND (a.archetype_id IS NOT NULL OR EXISTS (SELECT 1 FROM account_playbook_moves m WHERE m.account_id = a.id))
        ORDER BY last IS NOT NULL, last, a.name COLLATE NOCASE`,
    )
    .all(REFRESH_ORIGIN, OWN_WORK_ACCOUNT_ID) as Array<{ id: string; name: string; last: number | null }>;
}

/** What the follow-up asks to re-check, worked out from the records. */
export function refreshNotes(account: AccountRow, now: number): string[] {
  const playbook = currentPlaybook({ accountId: account.id })?.playbook;
  const lines: string[] = [];
  const archetype = playbook ? archetypeOf(playbook, account.archetype_id ?? null) : null;
  lines.push(archetype ? `Is it still "${archetype.name}"?${account.archetype_hypothesis ? ` The hypothesis was: ${account.archetype_hypothesis}` : ""}` : "No archetype chosen yet.");
  const card = scorecard(account);
  const changed = new Map(
    (db().prepare(`SELECT field, MAX(created_at) AS at FROM change_log WHERE entity_type = 'account' AND entity_id = ? AND field LIKE 'meddpicc_%' GROUP BY field`).all(account.id) as Array<{ field: string; at: number }>).map((r) => [r.field, r.at]),
  );
  const stale = card.filter((r) => r.status !== "unknown" && (changed.get(r.field) ?? 0) < now - REFRESH_EVERY_DAYS * DAY);
  const open = card.filter((r) => r.status === "unknown");
  if (stale.length) lines.push(`Re-check, unchanged for a quarter: ${stale.map((r) => `${r.label} (${r.status})`).join(", ")}.`);
  if (open.length && open.length < card.length) lines.push(`Still not found out: ${open.map((r) => r.label).join(", ")}.`);
  if (open.length === card.length) lines.push("Nothing on the qualification scorecard yet.");
  const research = db().prepare(`SELECT MAX(created_at) AS at FROM documents WHERE account_id = ? AND kind = 'research_note' AND status = 'accepted' AND archived_at IS NULL`).get(account.id) as { at: number | null };
  lines.push(research.at ? `Research last kept ${Math.floor((now - research.at) / DAY)} days ago.` : "No research kept yet.");
  return lines;
}

export function runQuarterlyRefresh(trigger: RunTrigger, pressedBy: string | null, now = new Date()): { runId: string; started: boolean; reason: string } {
  const runId = beginAssistantRun("quarterly_refresh", trigger, pressedBy);
  const at = now.getTime();
  const done = (started: boolean, reason: string, status: "done" | "skipped" = started ? "done" : "skipped") => {
    endAssistantRun(runId, { status, summary: reason });
    return { runId, started, reason };
  };
  try {
    if (!currentPlaybook()) return done(false, "The team has no playbook yet.");
    const due = refreshCandidates().filter((c) => trigger === "manual" || c.last === null || c.last <= at - REFRESH_EVERY_DAYS * DAY);
    const next = due.find((c) => runningRunFor(c.id) === null);
    if (!next) return done(false, due.length ? "Every account due a refresh has a run going." : "No account on the playbook is due a refresh.");
    const account = getAccount(next.id)!;
    const notes = refreshNotes(account, at);
    createProposalBatch(account.id, { kind: "plan_draft", id: REFRESH_ORIGIN, aiRunId: null }, [
      {
        entity_type: "action_item",
        op: "create",
        payload: { text: `Quarterly refresh: ${account.name}`, notes: notes.join("\n"), due: addDays(todayISO(now), 7), status: "open", owner_user_id: account.owner_user_id ?? null },
        rationale: "A quarter since the last refresh: what to re-check, from the records.",
        source_ref: { kind: "account", id: account.id },
      },
    ]);
    let archetype = "";
    if (!pendingArchetype(account.id)) {
      try {
        startArchetypeSuggestion(account.id, pressedBy, { assistant: "quarterly_refresh" });
        archetype = " and is asking whether the archetype still holds";
      } catch (e) {
        if (!(e instanceof BudgetError)) throw e;
        archetype = ` (archetype not asked: ${e.message})`;
      }
    }
    return done(true, `Proposed a refresh follow-up for ${account.name}${archetype}.`);
  } catch (e) {
    endAssistantRun(runId, { status: "failed", summary: "The refresh failed.", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
