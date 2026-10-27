// Handoff writer's runs. A draft lives only on its ai_runs row, like the
// recap email: nothing is written to an account by drafting.
import { db, type AiRunRow } from "../db";
import { BudgetError, runDetached, startRun } from "../ai/guard";
import { runState } from "../ai/runState";
import { addDays, todayISO } from "../clock";
import { listUsers } from "../auth";
import { getAccount } from "../queries/accounts";
import { buildContextPack, evidenceIds, packForPrompt } from "../meetings/contextPack";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "../assistants/runs";
import { buildCover, coverSize, nextTimeOff, type Cover, type CoverWindow } from "./cover";
import { draftHandoff, readDraft, type HandoffDraft } from "./draft";

/** Time off this close is drafted for on its own. */
export const COVER_AHEAD_DAYS = 3;

export type DraftRunResult = { draft: HandoffDraft };

function latest(summary: string): { id: string; state: ReturnType<typeof runState>; draft: HandoffDraft | null } | null {
  const row = db().prepare(`SELECT * FROM ai_runs WHERE kind = 'handoff_draft' AND input_summary = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`).get(summary) as AiRunRow | undefined;
  if (!row) return null;
  const state = runState(row);
  const result = state.status === "done" ? (state.result as DraftRunResult | null) : null;
  return { id: row.id, state, draft: result ? readDraft(result.draft) : null };
}

// ---- for another account team ----------------------------------------------

export const accountSummary = (accountId: string) => `handoff ${accountId}`;

export function startAccountDraft(accountId: string, userId: string): string {
  const account = getAccount(accountId);
  if (!account || account.archived_at) throw new BudgetError("That account is missing or archived.");
  const run = startRun({ role: "handoff_draft", accountId, userId, kind: "handoff_draft", inputSummary: accountSummary(accountId) });
  runDetached(run.id, async (stages): Promise<DraftRunResult> => {
    const pack = buildContextPack(accountId);
    const { draft } = await draftHandoff({ mode: "account", records: packForPrompt(pack), ids: evidenceIds(pack), heading: `Account: ${account.name}` }, stages);
    return { draft };
  });
  return run.id;
}

export const latestAccountDraft = (accountId: string) => latest(accountSummary(accountId));

// ---- for time off ----------------------------------------------------------

export const coverSummary = (userId: string, w: CoverWindow) => `cover ${userId} ${w.first ?? w.from} ${w.to}`;

// What the model is given: the cover's own rows, with their ids, and nothing
// else. The ids are the whole set it may cite.
export function coverRecords(c: Cover): { records: string; ids: Set<string> } {
  const records = {
    away: { name: c.userName, from: c.window.from, to: c.window.to, covering: c.partner?.name ?? null },
    follow_ups: c.followUps.map((f) => ({ id: f.id, account: f.accountName, text: f.text, due: f.due })),
    meetings: c.meetings.map((m) => ({ id: m.id, account: m.accountName, title: m.title, day: m.day, time: m.time, has_brief: m.hasBrief })),
    customer_promises: c.promises.map((p) => ({ id: p.id, account: p.accountName, who: p.owner, text: p.text, due: p.due })),
    plays: c.plays.map((p) => ({ id: p.id, account: p.accountName, title: p.title, next_step: p.nextStep, due: p.due })),
  };
  const ids = new Set([...c.followUps, ...c.meetings, ...c.promises, ...c.plays].map((r) => r.id));
  return { records: JSON.stringify(records, null, 1), ids };
}

export function startCoverDraft(cover: Cover, requestedBy: string | null, opts: { assistant?: "handoff_writer" } = {}): string {
  if (coverSize(cover) === 0) throw new BudgetError("Nothing of yours falls in those days, so there is nothing to hand over.");
  const { records, ids } = coverRecords(cover);
  const run = startRun({ role: "handoff_draft", accountId: null, userId: requestedBy, kind: "handoff_draft", inputSummary: coverSummary(cover.userId, cover.window), assistant: opts.assistant ?? null });
  runDetached(run.id, async (stages): Promise<DraftRunResult> => {
    const { draft } = await draftHandoff({ mode: "cover", records, ids, heading: `${cover.userName} is away ${cover.window.from} to ${cover.window.to}${cover.partner ? `; ${cover.partner.name} is covering` : ""}` }, stages);
    return { draft };
  });
  return run.id;
}

export const latestCoverDraft = (userId: string, w: CoverWindow) => latest(coverSummary(userId, w));

/** People whose time off starts within COVER_AHEAD_DAYS, with something to cover and no draft yet. */
export function coversDue(today = todayISO()): Cover[] {
  const out: Cover[] = [];
  for (const u of listUsers()) {
    const w = nextTimeOff(u.id, today, COVER_AHEAD_DAYS);
    if (!w || w.from > addDays(today, COVER_AHEAD_DAYS)) continue;
    if (latestCoverDraft(u.id, w)) continue;
    const c = buildCover(u.id, w, today);
    if (coverSize(c) > 0) out.push(c);
  }
  return out;
}

/** The scheduler's part, and Run now's: draft the next cover note due. */
export function runHandoffWriter(trigger: RunTrigger, userId: string | null, today = todayISO()): { runId: string; started: boolean; reason: string } | null {
  const next = coversDue(today)[0];
  if (!next) {
    if (trigger === "schedule") return null;
    const runId = beginAssistantRun("handoff_writer", trigger, userId);
    const reason = "Nobody's calendar shows time off in the next three days with anything to hand over.";
    endAssistantRun(runId, { status: "skipped", summary: reason });
    return { runId, started: false, reason };
  }
  const runId = beginAssistantRun("handoff_writer", trigger, userId);
  try {
    startCoverDraft(next, userId, { assistant: "handoff_writer" });
    const reason = `Drafting ${next.userName}'s cover note for ${next.window.from}${next.window.to !== next.window.from ? ` to ${next.window.to}` : ""}.`;
    endAssistantRun(runId, { status: "done", summary: reason, result: { userId: next.userId, window: next.window } });
    return { runId, started: true, reason };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    endAssistantRun(runId, { status: "skipped", summary: reason });
    if (!(e instanceof BudgetError)) throw e;
    return { runId, started: false, reason };
  }
}
