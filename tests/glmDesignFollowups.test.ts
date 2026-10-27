// Focused coverage for the two approved design follow-ups. Invented data only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { USER } from "./helpers";
import { seedAccount } from "./helpers";
import { DealQuickEdit } from "@/components/DealQuickEdit";
import { useRefreshHold } from "@/components/AccountFreshness";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/AccountFreshness", async (orig) => ({
  ...(await orig<typeof import("@/components/AccountFreshness")>()),
  // DealQuickEdit must keep taking the editing hold; observing it here keeps
  // the client render runnable without the provider's polling timer.
  useRefreshHold: (key: string, reason: string | null) => holds.push([key, reason]),
}));

const holds: Array<[string, string | null]> = [];

// ---- 1. collapsed quick-edit trigger ---------------------------------------

let root: Root;
let container: HTMLElement;
type Props = React.ComponentProps<typeof DealQuickEdit>;
const base: Props = { accountId: "acc", dealId: "SYN-1", stage: 3, nextStep: null, status: "open", closeDate: null, tcvUsd: null, version: 1 };
const render = (p: Props) => act(async () => root.render(React.createElement(DealQuickEdit, p)));

beforeEach(() => {
  const { window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document); vi.stubGlobal("navigator", window.navigator); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  holds.length = 0;
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("shows the next step as one control: the text with a pen, or quiet guidance when there is none", () => {
  const doc = parseHTML(renderToStaticMarkup(React.createElement(DealQuickEdit, { ...base, nextStep: "Confirm the planning date" }))).document;
  const btn = doc.querySelector('button[data-testid="deal-quick-SYN-1"]')!;
  expect(btn.textContent).toBe("Confirm the planning date");
  expect(btn.getAttribute("aria-label")).toBe("Edit next step: Confirm the planning date");
  expect(btn.querySelector("svg")).not.toBeNull();
  expect(doc.querySelector('[data-testid="deal-follow-ups"]')).toBeNull();
  const unset = parseHTML(renderToStaticMarkup(React.createElement(DealQuickEdit, base))).document;
  const emptyBtn = unset.querySelector('button[data-testid="deal-quick-SYN-1"]')!;
  expect(emptyBtn.textContent).toBe("+Set a next step");
  // Quiet, not a warning on every row: the counts above carry that.
  expect(emptyBtn.innerHTML).not.toContain("text-warning");
  const linked = parseHTML(renderToStaticMarkup(React.createElement(DealQuickEdit, { ...base, linked: { label: "2 open follow-ups", href: "/accounts/a/deals/SYN-1#commitments" } }))).document;
  expect(linked.querySelector('[data-testid="deal-follow-ups"]')?.textContent).toBe("2 open follow-ups →");
});

it("keeps the affordance a real button with focus ring, room and no clamping", () => {
  const doc = parseHTML(renderToStaticMarkup(React.createElement(DealQuickEdit, { ...base, nextStep: "A complete synthetic next step that must stay readable in full" }))).document;
  const btn = doc.querySelector('button[data-testid="deal-quick-SYN-1"]')!;
  expect(btn.tagName).toBe("BUTTON");
  expect(btn.getAttribute("type")).toBe("button");
  expect(btn.className).toContain("focus-visible:ring-2");
  expect(btn.className).not.toMatch(/line-clamp|truncate/);
  // The text sits in its own span so the label never wraps into it.
  expect(btn.firstElementChild?.children).toHaveLength(2);
  expect(btn.className).toContain("min-h-11");
});

it("opens the editor with the row's version as basis and takes the editing hold", async () => {
  await render({ ...base, version: 7, nextStep: "Send the redline" });
  await act(async () => container.querySelector("button")!.click());
  const form = container.querySelector("form")!;
  expect(form.querySelector('input[name="base_version"]')!.getAttribute("value")).toBe("7");
  expect(form.querySelector("textarea")!.defaultValue).toBe("Send the redline");
  expect(form.querySelector<HTMLSelectElement>('select[name="stage"]')!.value).toBe("3");
  expect(holds.at(-1)).toEqual(["deal-quick-editor", "A deal is open for editing here."]);
  // Save/Cancel both survive the new trigger.
  expect([...form.querySelectorAll("button")].map(b => b.textContent)).toContain("Cancel");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Cancel")!.click());
  expect(container.querySelector("form")).toBeNull();
  expect(holds.at(-1)![1]).toBeNull();
});

// ---- 2. The Plan tab, empty and not -----------------------------------------

async function account(id: string) {
  const { default: Page } = await import("@/app/accounts/[id]/plays/page");
  return parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }))).document;
}

it("an empty Plan keeps its heading, count, drafting and manual add", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Quiet Plan Lab", dealId: "SYN-PLAN-Q" });
  // The seed has a play and no thesis: that is populated, not empty.
  const seeded = await account(accountId);
  expect(seeded.querySelectorAll('[data-testid="play-scan-row"]')).toHaveLength(1);
  // Remove the play and add nothing: thesis, plays and proposals all empty.
  const db = (await import("@/lib/db")).db();
  db.prepare("DELETE FROM plays WHERE account_id=?").run(accountId);
  const empty = await account(accountId);
  const plan = empty.querySelector("#plan")!;
  expect(plan.querySelector("h2")?.textContent).toBe("Plan");
  expect(plan.textContent).toContain("0 plays");
  expect(plan.textContent).toContain("Draft plan");
  expect(plan.textContent).toContain("No account thesis yet.");
  const add = empty.querySelector('[data-testid="play-new-open"]');
  expect(add).not.toBeNull();
  // The existing client form starts closed; actual expansion is browser-tested.
  expect(add?.textContent).toContain("Add play");
  expect(add?.getAttribute("aria-expanded")).toBe("false");
});

it("says a drafted plan is waiting, and shows a thesis in full", async () => {
  const pendingId = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic Pending Plan Lab" }, actorUserId: USER }).entityId;
  createProposalBatch(pendingId, { kind: "plan_draft", id: null, aiRunId: null }, [{ entity_type: "account", op: "update", entity_id: pendingId, payload: { thesis: "A drafted plan is waiting." } }]);
  const withPending = await account(pendingId);
  expect(withPending.querySelector("#plan")?.textContent).toContain("A drafted plan is waiting");
  expect(withPending.querySelector("#plan")?.textContent).toContain("No account thesis yet.");
  const thesisId = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic Thesis Plan Lab", thesis: "Keep the complete account thesis in view." }, actorUserId: USER }).entityId;
  const withThesis = await account(thesisId);
  expect(withThesis.querySelector("#plan")?.textContent).toContain("Keep the complete account thesis in view.");
  expect(withThesis.querySelector("#plan")?.textContent).not.toContain("No account thesis yet.");
});
