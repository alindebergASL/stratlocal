// The neutral starter and synthetic edits only: no team's real playbook.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { USER } from "./helpers";
import { Playbook } from "@/lib/playbook/schema";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { currentPlaybook, playbookHistory, playbookProblems, restorePlaybook, savePlaybook } from "@/lib/playbook/store";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/settings/playbook", useSearchParams: () => new URLSearchParams() }));

it("ships a neutral starter that is a valid playbook", () => {
  const p = Playbook.parse(STARTER_PLAYBOOK);
  expect(p.steps).toHaveLength(7);
  expect(p.archetypes).toHaveLength(5);
  expect(p.movements).toHaveLength(4);
  expect(new Set(p.questions.flatMap((q) => q.meddpicc ?? [])).size).toBe(8);
  expect(p.workshop.reduce((n, s) => n + s.minutes, 0)).toBe(90);
});

it("refuses a playbook whose pieces point at things it does not have", () => {
  const bad = { ...STARTER_PLAYBOOK, steps: [{ id: "x", name: "X", owner_role: "nobody" }], questions: [{ id: "q", text: "Q?", movement_id: "nowhere", archetypes: ["ghost"] }], roles: [], movements: [], archetypes: [] };
  expect(playbookProblems(bad)).toEqual(expect.arrayContaining(['steps.0.owner_role: no role "nobody"', 'questions.0.movement_id: no movement "nowhere"', 'questions.0.archetypes: no archetype "ghost"']));
  expect(playbookProblems(STARTER_PLAYBOOK)).toBeNull();
});

it("keeps every version, refuses a stale save and brings an old version back", () => {
  expect(currentPlaybook()).toBeNull();
  const first = savePlaybook({ playbook: STARTER_PLAYBOOK, note: "Started", userId: USER, basisId: null });
  expect(() => savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null })).toThrow(/changed since this page was opened/);
  const second = savePlaybook({ playbook: { ...STARTER_PLAYBOOK, name: "Synthetic team playbook" }, userId: USER, basisId: first.id });
  expect(currentPlaybook()?.playbook.name).toBe("Synthetic team playbook");
  restorePlaybook(first.id, USER, second.id);
  expect(currentPlaybook()?.playbook.name).toBe("AI outcome starter");
  expect(currentPlaybook()?.note).toMatch(/^Restored the version of/);
  expect(playbookHistory().map((v) => v.playbook.name)).toEqual(["AI outcome starter", "Synthetic team playbook", "AI outcome starter"]);
});

it("shows the playbook on its page, and offers the starter when there is none", async () => {
  const { default: PlaybookPage } = await import("@/app/settings/playbook/page");
  const empty = parseHTML(renderToStaticMarkup(await PlaybookPage())).document;
  expect(empty.querySelector('[data-testid="playbook-use-starter"]')?.textContent).toBe("Start from the neutral starter");
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const doc = parseHTML(renderToStaticMarkup(await PlaybookPage())).document;
  expect(doc.querySelectorAll('[data-testid="playbook-steps"] > li')).toHaveLength(7);
  expect(doc.querySelectorAll('[data-testid="playbook-archetypes"] tbody tr')).toHaveLength(5);
  expect(doc.querySelector('[data-testid="playbook-view"]')?.textContent).toContain("Workshop · 90 minutes");
});

it("says what changed between versions, section by section", async () => {
  const { playbookDiff } = await import("@/lib/playbook/diff");
  const a = Playbook.parse(STARTER_PLAYBOOK);
  const b = { ...a, name: "Synthetic", steps: a.steps.slice(1), questions: [...a.questions, { id: "q-new", text: "New?", movement_id: null, meddpicc: null, personas: [], archetypes: [] }], archetypes: a.archetypes.map((x, i) => (i === 0 ? { ...x, pain: "Changed" } : x)) };
  expect(playbookDiff(a, b)).toEqual(["Renamed to “Synthetic”", "1 step removed", "1 archetype changed", "1 question added"]);
  expect(playbookDiff(null, a)).toEqual(["First version"]);
  expect(playbookDiff(a, a)).toEqual(["No change"]);
});

it("exports the current playbook as a file another team can load", async () => {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("@/app/api/playbook/export/route");
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const auth = await import("@/lib/auth");
  vi.spyOn(auth, "requireUser").mockReturnValue({ id: USER } as ReturnType<typeof auth.requireUser>);
  const res = await GET(new NextRequest("http://localhost/api/playbook/export"));
  expect(res.headers.get("content-disposition")).toBe('attachment; filename="ai-outcome-starter.json"');
  const body = await res.json();
  expect(body).toMatchObject({ kind: "playbook", version: 1, playbook: { name: "AI outcome starter" } });
  expect(Playbook.safeParse(body.playbook).success).toBe(true);
});
