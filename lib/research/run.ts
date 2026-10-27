// Web research and saved-report recovery share the same extraction/storage path.
import { z } from "zod";
import { BudgetError, getRun, runDetached, startRun } from "../ai/guard";
import { estimateCostCents, type StageUsage } from "../ai/cost";
import { runWebResearch, urlKey, WebResearchInput, type ResearchDepth, type ResearchStep } from "../ai/runWebResearch";
import { getAccount } from "../queries/accounts";
import { extractResearchNote } from "./extract";
import { listNotes, storeDraftNote } from "./notes";
import { db, type AiRunRow } from "../db";
import { ResearchReport, type ResearchEntity } from "./schema";
import {researchCoverage, type ResearchCoverage} from "./coverage";
import { listDocuments } from "../queries/accounts";
import { parseNote } from "./notes";
import { addDays, todayISO } from "../clock";
import type { AssistantId } from "../assistants/registry";
import { focusForResearch } from "../teamDirection";
import { currentPlaybook } from "../playbook/store";
import { researchSteer } from "../playbook/researchSteer";
import { proposeBudgetTiming } from "../playbook/budgetProposal";
import { proposeResearchPeople } from "./peopleProposal";

export type ResearchRunResult = {
  documentId: string | null;
  findings: number;
  sources: number;
  searches: number;
  fetches: number;
  dropped: string[];
  attempts: number;
  report?: ResearchReport;
  retryRunId?: string;
  coverage?: ResearchCoverage;
  /** While running: what it has searched for and read so far, newest last. */
  steps?: ResearchStep[];
};

export function latestResearchRun(accountId: string): AiRunRow | null {
  return (
    (db().prepare(`SELECT * FROM ai_runs WHERE account_id = ? AND kind = 'research' ORDER BY started_at DESC, rowid DESC LIMIT 1`).get(accountId) as AiRunRow | undefined) ?? null
  );
}

function activeAccount(accountId: string) {
  const account = getAccount(accountId);
  if (!account) throw new BudgetError("That account no longer exists.");
  if (account.archived_at) throw new BudgetError("That account is archived.");
  return account;
}

function checkpointRun(runId: string, checkpoint: ResearchRunResult, stages?: StageUsage[]) {
  // With the usage so far, so a run the server restarts under is recorded at
  // what it actually cost (the startup sweep reads partial_cost_cents).
  const usage = stages ? JSON.stringify({ stages, partial_cost_cents: estimateCostCents(stages)?.cents ?? null }) : null;
  const saved = db()
    .prepare(`UPDATE ai_runs SET result_json = ?, usage_json = COALESCE(?, usage_json) WHERE id = ? AND kind = 'research' AND status = 'running'`)
    .run(JSON.stringify(checkpoint), usage, runId);
  if (!saved.changes) throw new Error("The research run is no longer running.");
}

type ExtractInput = {
  accountId: string;
  /** Null when Account watch started it on its own. */
  userId: string | null;
  focus: string | null;
  depth: ResearchDepth;
  /** The assistant whose budget pays for it; absent for a person's own press. */
  assistant?: AssistantId;
  /**
   * Account watch: keep only what is new — a source no earlier note on this
   * account cited (kept, dropped or archived), published in the last
   * NEWS_DAYS. What was cut is listed with the note, not hidden.
   */
  onlyNew?: boolean;
};

export const NEWS_DAYS = 60;

/** The organisation as the newest kept run confirmed it, if any did. */
export function confirmedEntity(accountId: string): ResearchEntity | null {
  const withEntity = listNotes(accountId, "accepted")
    .filter((n) => n.meta.entity)
    .sort((a, b) => (b.meta.generated_at ?? "").localeCompare(a.meta.generated_at ?? ""));
  return withEntity[0]?.meta.entity ?? null;
}
// How many of the run's latest steps a checkpoint carries for the page.
const STEPS_KEPT = 12;

// Every source an earlier note on this account cited, whatever became of it:
// a dropped finding is one a person already said no to.
export function citedBefore(accountId: string): Set<string> {
  const seen = new Set<string>();
  for (const doc of listDocuments(accountId, { kinds: ["research_note"], includeArchived: true })) {
    const note = parseNote(doc);
    for (const f of note?.meta.findings ?? []) {
      const key = urlKey(f.url);
      if (key) seen.add(key);
    }
  }
  return seen;
}

export function onlyNewFindings<T extends { url: string; date: string | null; text: string }>(findings: T[], seen: Set<string>, today = todayISO()): { kept: T[]; cut: string[] } {
  const cutoff = addDays(today, -NEWS_DAYS);
  const kept: T[] = [];
  const cut: string[] = [];
  for (const f of findings) {
    const key = urlKey(f.url);
    if (key && seen.has(key)) cut.push(`Shown before: ${f.text.slice(0, 160)}`);
    else if (f.date && f.date < cutoff) cut.push(`Older than ${NEWS_DAYS} days (${f.date}): ${f.text.slice(0, 140)}`);
    else kept.push(f);
  }
  return { kept, cut };
}
async function extractSavedReport(
  input: ExtractInput,
  runId: string,
  checkpoint: ResearchRunResult & { report: ResearchReport },
  stages: StageUsage[],
): Promise<ResearchRunResult> {
  const account = activeAccount(input.accountId);
  const report = checkpoint.report;
  if (!report.text.trim()) return checkpoint;
  const sources = new Map(report.sources.map((url) => [urlKey(url)!, url]));
  const { note: extracted, attempts, dropped: extractDropped } = await extractResearchNote(
    {
      prose: report.text,
      sources,
      companyName: account.name,
      evidence: report.evidence,
      focusAreas: focusForResearch(),
      pageAges: new Map(Object.entries(report.page_ages ?? {})),
      steer: researchSteer(input.accountId) ?? undefined,
    },
    stages,
  );
  // The account can be archived while the model is answering.
  activeAccount(input.accountId);
  let note = extracted;
  let dropped = extractDropped;
  if (input.onlyNew) {
    const { kept, cut } = onlyNewFindings(extracted.findings, citedBefore(input.accountId));
    // Reads are keyed by position, so they follow their findings through the cut.
    const reads = Object.fromEntries(
      kept.flatMap((f, i) => {
        const read = extracted.reads?.[String(extracted.findings.indexOf(f))];
        return read ? [[String(i), read]] : [];
      }),
    );
    // Budget timing too stands on its finding; cut with it, it goes.
    const budgetAt = extracted.budget ? kept.indexOf(extracted.findings[extracted.budget.finding]!) : -1;
    // And peers.
    const peers = (extracted.peers ?? []).flatMap((p) => {
      const at = kept.indexOf(extracted.findings[p.finding]!);
      return at >= 0 ? [{ ...p, finding: at }] : [];
    });
    const people = (extracted.people ?? []).flatMap((p) => {
      const at = kept.indexOf(extracted.findings[p.finding]!);
      return at >= 0 ? [{ ...p, finding: at }] : [];
    });
    note = { ...extracted, findings: kept, people, ...(extracted.reads ? { reads } : {}), budget: extracted.budget && budgetAt >= 0 ? { ...extracted.budget, finding: budgetAt } : null, peers, peers_summary: peers.length ? extracted.peers_summary : null };
    dropped = [...extractDropped, ...cut];
  }
  const coverage=researchCoverage(note.findings,report.capture,dropped.length);
  if (note.findings.length === 0) return { ...checkpoint, dropped, attempts, coverage };
  const doc = storeDraftNote({
    ...input,
    aiRunId: runId,
    note,
    prose: report.text,
    sources: report.sources,
    reportEvidence: report.evidence,
    capture: report.capture,
    searches: checkpoint.searches,
    fetches: checkpoint.fetches,
    dropped,
  });
  proposeBudgetTiming(input.accountId, doc.id, note);
  proposeResearchPeople(input.accountId, doc.id, note);
  return {
    documentId: doc.id,
    findings: note.findings.length,
    coverage,
    sources: report.sources.length,
    searches: checkpoint.searches,
    fetches: checkpoint.fetches,
    dropped,
    attempts,
    ...(checkpoint.retryRunId ? { retryRunId: checkpoint.retryRunId } : {}),
  };
}

export function startResearchRun(input: ExtractInput): string {
  // A draft waiting for review would be archived by the new one. A person's
  // press may replace their own draft; an assistant never does.
  if (input.assistant && listNotes(input.accountId, "draft").length > 0) throw new BudgetError("A research note is waiting for review on this account; Account watch waits until it is kept or dropped.");
  const account = activeAccount(input.accountId);
  const sent = WebResearchInput.parse({
    companyName: account.name,
    hq: account.hq,
    region: account.region,
    domain: confirmedEntity(input.accountId)?.domain ?? null,
    focusQuestion: input.focus,
    // Extracted titles can reflect private playbook steering. Keep prior-note
    // evidence and deduplication internal; never feed titles back to public research.
    avoidTitles: [],
    // The focus areas only; see lib/teamDirection.ts.
    teamFocus: focusForResearch(),
    // A yes or no only: the ask itself is written in code (DECISIONS #84).
    budgetTiming: !!currentPlaybook({ accountId: input.accountId }),
    depth: input.depth,
  });
  const run = startRun({
    role: "research",
    accountId: input.accountId,
    userId: input.userId,
    inputSummary: JSON.stringify(sent).slice(0, 2000),
    assistant: input.assistant ?? null,
  });
  runDetached(run.id, async (stages) => {
    activeAccount(input.accountId);
    // The last turn's checkpoint, with the steps since laid over it: a step
    // never replaces the partial report a restart would need.
    const steps: ResearchStep[] = [];
    let last: ResearchRunResult = { documentId: null, findings: 0, sources: 0, searches: 0, fetches: 0, dropped: [], attempts: 0 };
    let wrote = 0;
    const save = (checkpoint: ResearchRunResult) => {
      last = checkpoint;
      checkpointRun(run.id, { ...checkpoint, steps: steps.slice(-STEPS_KEPT) }, stages);
    };
    const research = await runWebResearch(sent, stages, (progress) => {
      // A turn finished and another is about to start. If the process dies
      // during it, this is what survives: a partial report that the existing
      // "retry extraction" path can turn into a draft without searching again.
      save(
        {
          documentId: null,
          findings: 0,
          sources: progress.sources.size,
          searches: progress.searches,
          fetches: progress.fetches,
          dropped: [],
          attempts: 0,
          report: ResearchReport.parse({
            text: progress.text,
            sources: [...progress.sources.values()],
            ...(progress.pageAges?.size ? { page_ages: Object.fromEntries(progress.pageAges) } : {}),
            evidence: progress.evidence,
            capture: { status: "partial", reasons: ["interrupted"] },
          }),
        },
      );
    }, (step) => {
      steps.push(step);
      // At most a write a second; the last steps of a burst wait for the next.
      if (Date.now() - wrote < 1000) return;
      wrote = Date.now();
      try {
        checkpointRun(run.id, { ...last, steps: steps.slice(-STEPS_KEPT) }, stages);
      } catch {
        // The run was stopped; the main path will say so.
      }
    });
    const report = ResearchReport.parse({
      text: research.text,
      sources: [...research.sources.values()],
      ...(research.pageAges?.size ? { page_ages: Object.fromEntries(research.pageAges) } : {}),
      evidence: research.evidence,
      capture: research.capture,
    });
    const checkpoint = {
      documentId: null,
      findings: 0,
      sources: report.sources.length,
      searches: research.searches,
      fetches: research.fetches,
      dropped: [],
      attempts: 0,
      report,
    };
    checkpointRun(run.id, checkpoint);
    return extractSavedReport(input, run.id, checkpoint, stages);
  });
  return run.id;
}

const SavedCheckpoint = z.object({
  documentId: z.null(),
  report: ResearchReport.refine((r) => r.text.trim().length > 0, "Saved report is empty"),
  searches: z.number().int().nonnegative(),
  fetches: z.number().int().nonnegative(),
  retryRunId: z.string().optional(),
});

export function startResearchExtractionRetry(input: { accountId: string; userId: string; retryRunId: string }): string {
  // Transaction keeps duplicate recovery and per-account exclusion checks with
  // the reservation insert, including across independent server processes.
  const prepared = db()
    .transaction(() => {
      activeAccount(input.accountId);
      const source = getRun(input.retryRunId);
      if (!source || source.account_id !== input.accountId || source.kind !== "research" || source.status !== "failed") {
        throw new BudgetError("Choose a failed research run for this account.");
      }
      let raw: unknown;
      try {
        raw = JSON.parse(source.result_json ?? "null");
      } catch {
        raw = null;
      }
      const parsed = SavedCheckpoint.safeParse(raw);
      if (!parsed.success) throw new BudgetError("This run has no valid nonempty saved research report.");
      if (parsed.data.retryRunId) throw new BudgetError("Retry from the original saved research run.");
      const duplicate = db()
        .prepare(
          `SELECT id FROM ai_runs WHERE account_id = ? AND kind = 'research' AND status IN ('running', 'done')
      AND json_valid(input_summary) AND json_extract(input_summary, '$.retryRunId') = ? LIMIT 1`,
        )
        .get(input.accountId, source.id);
      if (duplicate) throw new BudgetError("This saved report already has a running or completed extraction retry.");
      // Older summaries may be truncated; report fidelity never depends on them.
      let metadata: { focusQuestion?: string | null; depth?: string } = {};
      try {
        metadata = JSON.parse(source.input_summary ?? "{}");
      } catch {
        /* legacy summary */
      }
      const focus = typeof metadata?.focusQuestion === "string" ? metadata.focusQuestion : null;
      const depth = metadata?.depth === "deep" ? ("deep" as const) : ("standard" as const);
      const run = startRun({
        role: "research",
        accountId: input.accountId,
        userId: input.userId,
        inputSummary: JSON.stringify({
          retryRunId: source.id,
          mode: "saved_report_extraction",
          focusQuestion: focus,
          depth,
        }),
      });
      const checkpoint = {
        documentId: null,
        findings: 0,
        sources: parsed.data.report.sources.length,
        searches: parsed.data.searches,
        fetches: parsed.data.fetches,
        dropped: [],
        attempts: 0,
        report: parsed.data.report,
        retryRunId: source.id,
      };
      checkpointRun(run.id, checkpoint);
      return { run, checkpoint, focus, depth };
    })
    .immediate();
  // Deliberately no web-research call in this job, even after extraction fails.
  runDetached(prepared.run.id, (stages) => extractSavedReport({ ...input, focus: prepared.focus, depth: prepared.depth }, prepared.run.id, prepared.checkpoint, stages));
  return prepared.run.id;
}

export { BudgetError };
