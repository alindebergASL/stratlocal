import type { AiRunRow } from "../db";

export type RunState<R = unknown> = {
  status: "running" | "done" | "failed";
  error: string | null;
  cost_cents: number | null;
  cost_estimated: boolean | null;
  result: R | null;
};
export type InitialRun<R = unknown> = { id: string; state: RunState<R> };

// One wire shape for a cold page load and subsequent polling.
export function runState<R = unknown>(run: AiRunRow): RunState<R> {
  let result: R | null = null;
  let costEstimated: boolean | null = null;
  try { result = run.result_json ? JSON.parse(run.result_json) as R : null; } catch { /* old or malformed output */ }
  try {
    const value = run.usage_json ? (JSON.parse(run.usage_json) as { cost_estimated?: unknown }).cost_estimated : null;
    costEstimated = typeof value === "boolean" ? value : null;
  } catch { /* old or malformed usage */ }
  return { status: run.status, error: run.error, cost_cents: run.cost_cents, cost_estimated: costEstimated, result };
}
