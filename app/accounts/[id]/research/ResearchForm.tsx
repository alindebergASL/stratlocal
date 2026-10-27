"use client";

import { useState } from "react";
import { fmtCostNote } from "@/lib/format";
import { Button, Callout, control } from "@/components/ui";
import { useAiRun } from "@/components/useAiRun";
import type { InitialRun } from "@/lib/ai/runState";
import type { ResearchRunResult } from "@/lib/research/run";
import { ResearchReport } from "@/lib/research/schema";
import { researchCoverage } from "@/lib/research/coverage";
import { ResearchReportView } from "@/components/ResearchReportView";

/** What each depth spends, computed on the server so an override in the
 *  environment reaches this screen too — a client component cannot read one,
 *  and a figure here that disagreed with the figure recorded afterwards would
 *  be worse than no figure at all. */
export type DepthCost = { searches: number; fetches: number; cents: number };

export function ResearchForm({
  accountId,
  disabledReason,
  initialRun,
  depths,
  replacesDraft = false,
  focusAreas = [],
  minutes = null,
  again = false,
  entity = null,
}: {
  /** The organisation as earlier research confirmed it; the run is told to stay on it. */
  entity?: { name: string; domain: string | null } | null;
  /** The team's focus areas, which the run is also told. */
  focusAreas?: string[];
  /** How long a run here usually takes, from past runs; null until there are some. */
  minutes?: number | null;
  /** The account has research already. */
  again?: boolean;
  accountId: string;
  disabledReason?: string | null;
  initialRun?: InitialRun<ResearchRunResult> | null;
  depths: { standard: DepthCost; deep: DepthCost };
  /** A draft is waiting: a new run replaces it, and that is said before the press. */
  replacesDraft?: boolean;
}) {
  const { start, state, error, busy } = useAiRun<ResearchRunResult>(initialRun);
  const [focus, setFocus] = useState("");
  const [deep, setDeep] = useState(true);
  const [savedRunId, setSavedRunId] = useState(initialRun?.id ?? null);
  const [extracting, setExtracting] = useState(!!initialRun?.state.result?.retryRunId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || disabledReason) return;
    setExtracting(false);
    const id = await start(`/api/accounts/${accountId}/research`, { focus, depth: deep ? "deep" : "standard" });
    if (id) setSavedRunId(id);
  }

  async function retryExtraction() {
    const retryRunId = state?.result?.retryRunId ?? savedRunId;
    if (busy || disabledReason || !retryRunId) return;
    setExtracting(true);
    const id = await start(`/api/accounts/${accountId}/research`, { retryRunId });
    if (id) setSavedRunId(id);
  }

  const result = state?.status === "done" ? state.result : null;
  const d = deep ? depths.deep : depths.standard;
  const steps = state?.status === "running" ? (state.result?.steps ?? []) : [];
  const report = ResearchReport.safeParse(state?.result?.report);
  // Saved turn by turn and cut short by a restart (lib/research/run.ts).
  const interrupted = report.success && !!report.data.capture?.reasons.includes("interrupted");

  return (
    <div>
      <form onSubmit={submit} className="space-y-3">
        {/* The plan, before anything is spent: what it looks for, about how
            long, and what it costs, in that order. The cost used to come
            first, as three lines on fetch requests and search charges,
            before the screen had said what the run was for. */}
        <div className="rounded-lg bg-surface-sunk p-3" data-testid="research-plan">
          <p className="text-label font-semibold text-ink-strong">What it looks for</p>
          <p className="mt-0.5 text-label text-ink">
            The organisation, leadership, money, strategy, technology, buying and risk
            {focusAreas.length > 0 && <>, and anything that touches {focusAreas.join(", ")}</>}. It also looks for a dated reason to act, and, if the company is listed, its latest annual report and earnings call. Public sources only: every finding cites the page it came from, and you keep or drop each one before it counts.
          </p>
          <p className="mt-1 text-label text-ink-muted" data-testid="research-plan-entity">
            {entity ? <>It stays on {entity.name}{entity.domain ? ` (${entity.domain})` : ""}, as earlier research confirmed it.</> : "It starts by confirming exactly which organisation this is, and shows you."}
          </p>
          <p className="mt-2 text-micro text-ink-muted" data-testid="research-cost-limits">
            {minutes ? `Usually about ${minutes} minute${minutes === 1 ? "" : "s"}` : "Usually a few minutes"} · up to {d.searches} searches and {d.fetches} pages fetched · about ${(d.cents / 100).toFixed(2)} in search charges, plus model use for reading and writing, which is recorded afterwards (so that figure is a floor, not a total).
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-micro font-medium text-ink-muted">Anything to look at especially? (optional)</span>
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            maxLength={300}
            data-testid="research-focus"
            placeholder="e.g. what is published about their next data centre"
            className={control}
          />
        </label>
        <label className="flex items-start gap-2 text-label text-ink">
          <input
            type="checkbox"
            data-testid="research-deep"
            checked={deep}
            onChange={(e) => setDeep(e.target.checked)}
            disabled={busy}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span>
            <span className="font-semibold">Thorough</span> (default).{" "}
            <span className="text-ink-muted">
              Untick for a quicker look: up to {depths.standard.searches} searches and {depths.standard.fetches} pages fetched, about ${(depths.standard.cents / 100).toFixed(2)}.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" data-testid="research-run" disabled={busy || !!disabledReason} aria-busy={busy} title={disabledReason ?? undefined}>
            {busy ? (extracting ? "Extracting saved report…" : "Researching…") : again ? "Research again" : "Research this account"}
          </Button>
          {replacesDraft && <span className="text-label font-semibold text-warning" data-testid="research-replaces-draft">It replaces the draft waiting above; that one moves to Discarded.</span>}
        </div>
      </form>

      <div role="status" aria-live="polite">
        {disabledReason && <p className="mt-2 text-micro text-ink-muted">{disabledReason}</p>}
        {error && (
          <Callout tone="danger" className="mt-3">
            {error}
          </Callout>
        )}
        {state?.status === "running" && (
          <Callout tone="neutral" className="mt-3" testId="research-progress">
            {extracting || state.result?.retryRunId ? (
              "Extracting saved report. No web searches or page fetches will run. Findings will be saved as a draft for review."
            ) : (
              <>
                <p>
                  {steps.length === 0
                    ? "Starting the search."
                    : `${count(Math.max(state.result?.searches ?? 0, steps.filter((s) => s.kind === "search").length), "search", "searches")} and ${count(Math.max(state.result?.fetches ?? 0, steps.filter((s) => s.kind === "read").length), "page", "pages")} fetched so far.`}{" "}
                  You can leave this page; the findings will be waiting here to review.
                </p>
                {steps.length > 0 && (
                  <ol className="mt-2 space-y-0.5 text-micro text-ink-muted" data-testid="research-steps">
                    {steps.slice(-6).map((s, i) => (
                      <li key={i} className="truncate">
                        <span className="font-semibold text-ink">{s.kind === "search" ? "Searched" : "Fetched"}</span> {s.kind === "search" ? `“${s.detail}”` : s.detail}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </Callout>
        )}
        {state?.status === "failed" && (
          <Callout tone="danger" className="mt-3">
            Research failed: {state.error}
            <p className="mt-1 text-micro">
              {state.cost_cents == null ? "Cost unknown: usage or pricing was not available." : `Recorded usage${fmtCostNote(state.cost_cents, state.cost_estimated)}. This may be partial if later usage was not received.`}
            </p>
          </Callout>
        )}
        {result && (
          <Callout tone="neutral" className="mt-3" testId="research-result">
            <p>
              New from this run: <strong className="tabular-nums">{result.findings}</strong> finding{result.findings === 1 ? "" : "s"} to review{result.retryRunId
                ? ", from the saved report with no new searching"
                : `, from ${result.searches} search${result.searches === 1 ? "" : "es"} and ${result.fetches} page${result.fetches === 1 ? "" : "s"} fetched`}
              {fmtCostNote(state?.cost_cents ?? null, state?.cost_estimated ?? null)}
            </p>

            {result.dropped.length > 0 && (
              <p className="mt-1 text-micro">
                {result.dropped.length} claim{result.dropped.length === 1 ? "" : "s"} dropped for citing a page the search did not return, or a quote that was
                not in it.
              </p>
            )}
            {result.findings === 0 && <p className="mt-1">No supported findings were saved as a note. {report.success ? "The full research report is saved below, unreviewed." : "No full report is available for this older run."}</p>}
          </Callout>
        )}
      </div>
      {report.success && report.data.capture?.status === "partial" && <Callout tone="neutral" className="mt-3"><strong>Partial saved research report</strong>{researchCoverage([],report.data.capture).reasons.map((reason,i)=><p key={i}>{reason}</p>)}<p>Retrying extraction cannot recover research that was never returned.</p></Callout>}
      {state?.status === "failed" && interrupted && !report.data.text.trim() && (
        <p className="mt-3 text-label text-ink-muted" data-testid="research-interrupted-empty">
          The server restarted before the research had written anything, so there is nothing to extract. Run it again when you are ready.
        </p>
      )}
      {state?.status === "failed" && report.success && report.data.text.trim() && savedRunId && (
        <div className="mt-3">
          <Button type="button" data-testid="research-retry-extraction" disabled={busy || !!disabledReason} onClick={retryExtraction}>
            {interrupted ? `Extract what was found (${state.result?.searches ?? 0} search${state.result?.searches === 1 ? "" : "es"})` : "Retry extraction from saved report"}
          </Button>
          <p className="mt-1 text-micro text-ink-muted">Uses the saved report as-is, not new web research. Model usage is billed; the result remains a draft for review.</p>
        </div>
      )}
      {/* Only when the run left no note to carry it: extraction failed, or
          nothing survived the guards and so nothing was stored. When there is
          a draft below, the draft shows the report and this was a second copy
          of the same text on the same screen. */}
      {report.success && !state?.result?.documentId && (
        <ResearchReportView text={report.data.text} sources={report.data.sources} partial={report.data.capture?.status === "partial"} />
      )}
    </div>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
