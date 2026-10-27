import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useAiRun } from "@/components/useAiRun";
import type { InitialRun } from "@/lib/ai/runState";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
let root: Root;
let container: HTMLElement;
let latest: ReturnType<typeof useAiRun>;
const fetchMock = vi.fn();
const state = (status: "running" | "failed" | "done") => ({ status, error: status === "failed" ? "Extraction failed" : null, cost_cents: status === "running" ? null : 125, cost_estimated: true, result: { report: { text: "Saved full report", sources: ["https://example.com/a"] } } });
function Harness({ initial }: { initial?: InitialRun }) {
  latest = useAiRun(initial);
  return React.createElement("div", null, JSON.stringify({ state: latest.state, busy: latest.busy, error: latest.error }));
}
beforeEach(() => {
  const { window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["done", "failed"] as const)("reconnects a reloaded running run and renders its %s result and cost", async (terminalStatus) => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => state("running") })
    .mockResolvedValueOnce({ ok: true, json: async () => state(terminalStatus) });
  await act(async () => root.render(React.createElement(Harness, { initial: { id: "run-1", state: state("running") } })));
  expect(fetchMock).toHaveBeenCalledWith("/api/ai-runs/run-1", { cache: "no-store" });
  expect(latest.busy).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(latest.state).toEqual(state(terminalStatus));
  expect(latest.busy).toBe(false);
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("shows a finished run immediately on cold load without restarting it", async () => {
  await act(async () => root.render(React.createElement(Harness, { initial: { id: "old", state: state("failed") } })));
  expect(latest.state).toEqual(state("failed"));
  expect(latest.busy).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps a new start busy before its first poll returns and clears old failure state", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ runId: "new" }) })
    .mockReturnValueOnce(new Promise(() => {}));
  await act(async () => root.render(React.createElement(Harness, { initial: { id: "old", state: state("failed") } })));
  await act(async () => { await latest.start("/start", {}); });
  expect(latest.busy).toBe(true);
  expect(latest.state?.status).toBe("running");
  expect(latest.state?.error).toBeNull();
  expect(latest.state?.cost_cents).toBeNull();
});

it("retries a transient poll failure without declaring the paid run finished", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ok: true, json: async () => state("done") });
  await act(async () => root.render(React.createElement(Harness, { initial: { id: "run-1", state: state("running") } })));
  expect(latest.busy).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(latest.state?.status).toBe("done");
});

it("ignores an in-flight poll after unmount", async () => {
  let resolve!: (value: unknown) => void;
  fetchMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
  await act(async () => root.render(React.createElement(Harness, { initial: { id: "run-1", state: state("running") } })));
  await act(async () => root.unmount());
  await act(async () => resolve({ ok: true, json: async () => state("done") }));
  expect(refresh).not.toHaveBeenCalled();
});
