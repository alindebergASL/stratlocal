// The neutral starter and synthetic use cases only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { Playbook } from "@/lib/playbook/schema";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { savePlaybook } from "@/lib/playbook/store";
import { suggestPlacement } from "@/lib/playbook/placement";
import { addMinutes, getWorkshop, saveWorkshop } from "@/lib/playbook/workshop";
import { nextFiscalStart, roadmap } from "@/lib/playbook/roadmap";
import { getAccount, listPlays } from "@/lib/queries/accounts";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const rubric = Playbook.parse(STARTER_PLAYBOOK).placement!;

it("places a use case by the rubric and says why, or not at all", () => {
  const sensitive = suggestPlacement(rubric, { sensitivity: 3, volume: 2 });
  expect(sensitive.best?.name).toBe("On premise");
  expect(sensitive.why.map((w) => w.criterion)).toEqual(["Data sensitivity or residency rules", "Steady, high volume of use"]);
  expect(suggestPlacement(rubric, { speed: 3, skills: 2 }).best?.name).toBe("In an application");
  expect(suggestPlacement(rubric, {}).best).toBeNull();
  expect(addMinutes("09:30", 45)).toBe("10:15");
});

it("keeps the workshop whole, refuses a stale save, and puts a use case on the roadmap as a play", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const { accountId, contactId } = seedAccount();
  const first = saveWorkshop(accountId, { date: "2026-11-12", start: "09:00", invitees: [contactId], use_cases: [{ id: "uc-1", name: "Synthetic permit triage", department: "Planning", value: 5, feasibility: 3, relevance: { sensitivity: 3 }, phase: 1 }] }, USER, null);
  expect(() => saveWorkshop(accountId, getWorkshop(accountId).workshop, USER, null)).toThrow(/Someone else saved/);
  expect(() => saveWorkshop(accountId, { use_cases: [{ id: "x", name: "", value: 9 }] }, USER, first)).toThrow();

  const { addToRoadmapAction } = await import("@/app/accounts/[id]/playbook/workshop/actions");
  expect(await addToRoadmapAction(accountId, "uc-1")).toMatchObject({ ok: true, message: "On the roadmap, phase 1." });
  expect(await addToRoadmapAction(accountId, "uc-1")).toMatchObject({ ok: true, message: "Already on the roadmap." });
  const play = listPlays(accountId).find((p) => p.title === "Synthetic permit triage")!;
  expect(play).toMatchObject({ phase: 1, status: "proposed" });
  expect(play.thesis).toContain("Suggested to run: On premise.");
  expect(getWorkshop(accountId).workshop.use_cases[0]!.play_id).toBe(play.id);

  const { default: Page } = await import("@/app/accounts/[id]/playbook/workshop/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId }) }))).document;
  expect(doc.querySelectorAll('[data-testid="workshop-agenda"] li')).toHaveLength(5);
  expect(doc.querySelector('[data-testid="workshop-agenda"]')?.textContent).toContain("09:00–09:10");
  expect(doc.querySelector('[data-testid="use-case-placement"]')?.textContent).toContain("Run: On premise");
});

it("dates the action plan against the customer's fiscal year", async () => {
  const { accountId, playId } = seedAccount();
  expect(nextFiscalStart({ fiscal_year_start_month: 7 }, "2026-10-23")).toBe("2027-07-01");
  expect(nextFiscalStart({ fiscal_year_start_month: 11 }, "2026-10-23")).toBe("2026-11-01");
  expect(nextFiscalStart({ fiscal_year_start_month: null }, "2026-10-23")).toBeNull();

  const actions = await import("@/app/accounts/[id]/playbook/roadmap/actions");
  const phase = new FormData();
  phase.set("phase", "2");
  expect(await actions.setPhaseAction(accountId, playId, phase)).toEqual({ ok: true });
  const budget = new FormData();
  budget.set("fiscal_year_start_month", "7");
  budget.set("budget_calendar", "Departments submit requests in February; the board adopts the budget in June.");
  expect(await actions.setBudgetCalendarAction(accountId, budget)).toEqual({ ok: true });
  expect(getAccount(accountId)).toMatchObject({ fiscal_year_start_month: 7 });
  const milestone = new FormData();
  milestone.set("text", "Synthetic pilot readout");
  milestone.set("play_id", playId);
  milestone.set("due", "2027-08-01");
  expect(await actions.addMilestoneAction(accountId, milestone)).toEqual({ ok: true });
  expect(await actions.addMilestoneAction(accountId, new FormData())).toMatchObject({ ok: false });

  const r = roadmap(accountId);
  expect(r.phases.find((p) => p.phase === 2)?.plays.map((p) => p.id)).toEqual([playId]);
  expect(r.milestones.map((m) => m.text)).toEqual(["Synthetic pilot readout"]);

  const { default: Page } = await import("@/app/accounts/[id]/playbook/roadmap/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId }) }))).document;
  expect(doc.querySelector('[data-testid="budget-calendar"]')?.textContent).toContain("July");
  expect(doc.querySelector('[data-testid="map-milestone"]')?.textContent).toContain("next fiscal year");
});
