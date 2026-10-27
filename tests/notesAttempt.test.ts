import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { NotesPanel } from "@/components/NotesPanel";
import type { RunState } from "@/components/useAiRun";

const mock = vi.hoisted(() => ({ start: vi.fn(), state: null as RunState<{ proposals?: number }> | null, error: null as string | null, busy: false }));
vi.mock("@/components/useAiRun", () => ({ useAiRun: () => mock }));
vi.mock("@/components/AccountFreshness", () => ({ useFreshnessAdoptions: () => 0 }));
let root: Root;
let container: HTMLElement;
const initial = "Synthetic meeting A notes long enough to extract.";
let props: React.ComponentProps<typeof NotesPanel>;
const render = () => act(async () => root.render(React.createElement(NotesPanel, props)));
const lower = () => container.querySelector('#notes-controls [role="status"]')!.textContent;
const summary = () => container.querySelector('[data-testid="post-meeting-status"]')!.textContent;
const button = (name: string) => [...container.querySelectorAll("button")].find(b => b.textContent === name)!;
async function click(name: string) { await act(async () => button(name).click()); }
async function edit(text: string) {
  // Linkedom does not implement React's native textarea input tracking. Invoke
  // the mounted host's real onChange; state, transitions and saves remain real.
  const node = container.querySelector("textarea")!;
  const key = Object.keys(node).find(k => k.startsWith("__reactProps$"))!;
  const handler = (node as unknown as Record<string, { onChange: (e: { target: { value: string } }) => void }>)[key]!;
  await act(async () => handler.onChange({ target: { value: text } }));
}
function terminal(status: "done" | "failed") {
  mock.state = { status, error: status === "failed" ? "Synthetic extraction failed" : null, result: status === "done" ? { proposals: 0 } : null, cost_cents: null, cost_estimated: null };
}
beforeEach(() => {
  const { window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document); vi.stubGlobal("navigator", window.navigator); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mock.state = null; mock.error = null; mock.busy = false; mock.start.mockReset().mockResolvedValue("run-A");
  props = { initial, extractUrl: "/api/meetings/A/extract", version: 1, hasPending: false, save: vi.fn().mockResolvedValue({ ok: true, version: 2 }) };
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("reuses the real panel A→B without associating A's failed run with B", async () => {
  await render(); await click("Save and extract changes"); terminal("failed"); await render();
  expect(summary()).toContain("Extraction needs attention");
  props = { ...props, extractUrl: "/api/meetings/B/extract", initial: "Synthetic B saved notes are distinct.", pendingCount: 1, hasPending: true };
  await render();
  expect(summary()).toContain("Proposals still require your decision.");
  expect(summary()).not.toContain("Extraction needs attention"); expect(lower()).toBe("Saved");
  expect(container.querySelector("textarea")!.value).toBe(props.initial);
});
it("failed old text does not override edited then Save-only current text", async () => {
  await render(); await click("Save and extract changes"); terminal("failed"); await render();
  await edit("Replacement synthetic notes saved without extraction.");
  expect(summary()).toContain("Unsaved notes");
  await click("Save only");
  expect(summary()).toContain("Notes saved. Review or extract when ready.");
  expect(lower()).toBe("Saved"); expect(mock.start).toHaveBeenCalledTimes(1);
  expect((props.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].get("base_version")).toBe("1");
});
it("records a rejected start and never reuses the preceding done result", async () => {
  await render(); await click("Save and extract changes"); terminal("done"); await render(); expect(lower()).toMatch(/^Read/);
  mock.start.mockImplementation(async () => { mock.error = "Synthetic start rejected"; return null; });
  await click("Save and extract changes"); expect(lower()).toBe("Synthetic start rejected");
  await edit("Changed synthetic notes after the rejected start."); await click("Save only");
  expect(lower()).toBe("Saved"); expect(summary()).toContain("Notes saved. Review or extract when ready.");
  // Even if an unrelated hook refresh clears its error, the old done result
  // must not be relabelled as the rejected attempt's result.
  mock.error = null; await edit(initial); await click("Save only"); expect(lower()).toBe("Saved");
});
it("keeps real-run locking after navigation without claiming B is running", async () => {
  await render(); await click("Save and extract changes"); mock.busy = true;
  mock.state = { status: "running", error: null, result: null, cost_cents: null, cost_estimated: null };
  props = { ...props, extractUrl: "/api/meetings/B/extract", pendingCount: 1 }; await render();
  expect(summary()).not.toContain("Extraction is running"); expect(button("Reading the notes…").disabled).toBe(true); expect(button("Save only").disabled).toBe(true);
});
