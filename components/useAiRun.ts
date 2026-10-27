"use client";

// One polling loop for every AI run. A research page can seed it from the
// database after reload; all other callers can still start with no run.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InitialRun, RunState } from "@/lib/ai/runState";
export type { RunState } from "@/lib/ai/runState";

const POLL_MS = 2000;
// While an answer is being written out (Ask's `draft`), often enough to read
// as it grows.
const DRAFT_POLL_MS = 700;

export function useAiRun<R = unknown>(initialRun?: InitialRun<R> | null) {
  const { refresh } = useRouter();
  const [runId, setRunId] = useState<string | null>(initialRun?.state.status === "running" ? initialRun.id : null);
  const [state, setState] = useState<RunState<R> | null>(initialRun?.state ?? null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const locked = useRef(initialRun?.state.status === "running");

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let drafting = false;
    async function poll() {
      try {
        const res = await fetch(`/api/ai-runs/${runId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not check progress");
        const body = (await res.json()) as RunState<R>;
        if (stopped) return;
        drafting = typeof (body.result as { draft?: unknown } | null)?.draft === "string";
        setState(body);
        setError(null);
        if (body.status !== "running") {
          locked.current = false;
          setRunId(null);
          refresh();
          return;
        }
      } catch {
        if (stopped) return;
        // A lost poll is not a failed run; keep the button locked and retry.
        setError("Could not check research/AI progress. Reconnecting…");
      }
      if (!stopped) timer = setTimeout(() => void poll(), drafting ? DRAFT_POLL_MS : POLL_MS);
    }
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, refresh]);

  // `body` may be FormData (the upload) or a plain object (everything else).
  const start = useCallback(async (url: string, body?: Record<string, unknown> | FormData) => {
    if (locked.current) return null;
    locked.current = true;
    setStarting(true);
    setError(null);
    try {
      const init: RequestInit =
        body instanceof FormData
          ? { method: "POST", body }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
      const res = await fetch(url, init);
      const payload = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !payload.runId) {
        locked.current = false;
        setError(payload.error ?? "Could not start");
        return null;
      }
      setState({ status: "running", error: null, cost_cents: null, cost_estimated: null, result: null });
      setRunId(payload.runId);
      return payload.runId;
    } catch {
      locked.current = false;
      setError("Could not confirm the start. Reload to check whether a run was started before trying again.");
      return null;
    } finally {
      setStarting(false);
    }
  }, []);

  return { start, state, error, busy: starting || state?.status === "running" };
}
