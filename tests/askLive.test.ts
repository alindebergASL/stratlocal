// SYNTHETIC ONLY.
//
// While a question is being answered: the time so far, and after a while
// what a long wait means.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));
const { AskLive } = await import("@/components/AskBox");

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  const { window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The poll never comes back: the run is still going.
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const run = { id: "run-1", state: { status: "running" as const, error: null, cost_cents: null, cost_estimated: null, result: { steps: ["Read Synthetic Orchard Lab"] } } };

it("counts the seconds, and says nothing about waiting at first", async () => {
  await act(async () => root.render(React.createElement(AskLive, { run, startedAt: Date.now() - 5000 })));
  expect(container.querySelector('[data-testid="ask-elapsed"]')?.textContent).toBe("5s");
  expect(container.querySelector('[data-testid="ask-slow"]')).toBeNull();
});

it("after twenty seconds, says it is still working and the page can be left", async () => {
  await act(async () => root.render(React.createElement(AskLive, { run, startedAt: Date.now() - 25_000 })));
  expect(container.querySelector('[data-testid="ask-slow"]')?.textContent).toMatch(/You can leave this page/);
});
