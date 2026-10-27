// The neutral starter and synthetic accounts only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { savePlaybook, currentPlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { lifecycle, moveToStep, playbookHealth, setCheck, stepDue, timeboxDays } from "@/lib/playbook/lifecycle";
import { needsYou } from "@/lib/accountOverview";
import { listActionItems } from "@/lib/queries/meetings";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

it("reads a deadline from a timebox only when it sets one", () => {
  expect(timeboxDays("48 hours")).toBe(2);
  expect(timeboxDays("Within 24 hours, then quarterly")).toBe(1);
  expect(timeboxDays("5 days")).toBe(5);
  expect(timeboxDays("2 to 3 weeks")).toBe(21);
  expect(timeboxDays("90 to 120 minutes")).toBeNull();
  expect(timeboxDays("3 to 5 business days before")).toBeNull();
  expect(timeboxDays(null)).toBeNull();
  expect(stepDue({ timebox: "48 hours" } as never, "2026-10-20")).toBe("2026-10-22");
});

it("puts an account on a step, ticks items, says what is next, and counts where accounts are", () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const playbook = currentPlaybook()!.playbook;
  const { accountId } = seedAccount();
  const fresh = lifecycle(accountId, playbook);
  expect(fresh).toMatchObject({ started: false, current: null, next: null });

  moveToStep(accountId, playbook, "intel", USER, 1_000);
  expect(lifecycle(accountId, playbook).next?.text).toBe("Strategic plan and mandates read");
  for (const item of playbook.steps[0]!.checklist) setCheck(accountId, playbook, "intel", item, true, USER);
  expect(lifecycle(accountId, playbook).next?.text).toBe("Move on to Classify and hypothesise");
  setCheck(accountId, playbook, "intel", "Budget calendar found", false, USER);
  expect(lifecycle(accountId, playbook).next?.text).toBe("Budget calendar found");
  expect(() => setCheck(accountId, playbook, "intel", "Not on the list", true, USER)).toThrow(/checklist/);
  expect(() => moveToStep(accountId, playbook, "nowhere", USER)).toThrow(/not in the playbook/);

  moveToStep(accountId, playbook, "discovery", USER, 2_000);
  moveToStep(accountId, playbook, "discovery", USER, 3_000); // already there: no new move
  const life = lifecycle(accountId, playbook);
  expect(life).toMatchObject({ started: true, since: 2_000 });
  expect(life.current?.step.id).toBe("discovery");
  expect(life.moves.map((m) => m.stepId)).toEqual(["discovery", "intel"]);

  const health = playbookHealth(playbook, 2_000 + 3 * 86_400_000);
  expect(health.find((h) => h.step.id === "discovery")).toMatchObject({ accounts: 1, medianDays: 3 });
  expect(health.find((h) => h.step.id === "intel")?.accounts).toBe(0);

  const base = { accountId, today: "2026-10-23", now: new Date("2026-10-23T12:00:00Z"), followUps: [], pending: 0, planDraft: 0, meetings: [], deals: [], plays: [], researchDrafts: 0 };
  const row = needsYou({ ...base, playbookNext: { text: life.next!.text, step: "Executive discovery", position: "step 4 of 7" } }).find((n) => n.key === "playbook");
  expect(row).toMatchObject({ text: "All four movements covered", href: `/accounts/${accountId}/playbook#lifecycle` });
});

it("shows the lifecycle on the Playbook tab and turns a timebox into one follow-up", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const playbook = currentPlaybook()!.playbook;
  const { accountId } = seedAccount();
  const { default: Page } = await import("@/app/accounts/[id]/playbook/page");
  const render = async () => parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId }) }))).document;
  let doc = await render();
  expect(doc.querySelector('[data-testid="playbook-start"]')?.textContent).toContain("Pre-meeting intelligence");
  expect(doc.querySelector('[data-testid="account-playbook-step"]')).toBeNull();

  moveToStep(accountId, playbook, "readout", USER);
  doc = await render();
  expect(doc.querySelector('[data-testid="playbook-step"][data-current="true"]')?.textContent).toContain("Outcome readout");
  expect(doc.querySelector('[data-testid="playbook-next"]')?.textContent).toContain("Readout sent");
  expect(doc.querySelector('[data-testid="account-playbook-step"]')?.textContent).toBe("Step 5: Outcome readout");
  expect(doc.querySelector('[data-testid="playbook-step-follow-up"]')?.textContent).toMatch(/Add a follow-up due \d{4}-\d{2}-\d{2}/);

  const { stepFollowUpAction, checkAction } = await import("@/app/accounts/[id]/playbook/actions");
  expect(await stepFollowUpAction(accountId, "readout")).toMatchObject({ ok: true, message: expect.stringMatching(/^Follow-up due/) });
  expect(await stepFollowUpAction(accountId, "readout")).toMatchObject({ ok: true, message: "Already a follow-up." });
  const items = listActionItems(accountId).filter((a) => a.text.includes("Outcome readout"));
  expect(items).toHaveLength(1);
  expect(await stepFollowUpAction(accountId, "intel")).toMatchObject({ ok: false });

  expect(await checkAction(accountId, "readout", "Readout sent", true)).toMatchObject({ ok: true });
  doc = await render();
  expect(doc.querySelector('[data-testid="playbook-next"]')?.textContent).toContain("Workshop invitation forwarded");
});
