// The neutral starter and synthetic people only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { Playbook } from "@/lib/playbook/schema";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { savePlaybook } from "@/lib/playbook/store";
import { discoveryGuide, isPersona, titleAcronym } from "@/lib/playbook/discovery";
import { playbookForPrompt } from "@/lib/playbook/prompt";
import { moveToStep } from "@/lib/playbook/lifecycle";
import { applyEntityChange } from "@/lib/proposals/apply";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const playbook = Playbook.parse(STARTER_PLAYBOOK);
const ids = (g: ReturnType<typeof discoveryGuide>) => g.flatMap((m) => m.questions.map((q) => q.id));

it("matches a persona by title words or initials", () => {
  expect(titleAcronym("Chief Information Security Officer")).toBe("CISO");
  expect(titleAcronym("Chief AI Officer")).toBe("CAIO");
  expect(isPersona("CIO", { title: "Chief Information Officer" })).toBe(true);
  expect(isPersona("CIO", { title: "Deputy CIO, Operations" })).toBe(true);
  expect(isPersona("CISO", { title: "Chief Information Officer" })).toBe(false);
  expect(isPersona("CIO", { title: "Social media lead" })).toBe(false);
});

it("chooses questions by archetype and by who is in the room", () => {
  const all = discoveryGuide(playbook, { archetypeId: null, attendees: [] });
  expect(all.map((g) => g.movement.name)).toEqual(["Mission outcomes", "Current AI footprint", "Gaps and readiness", "Decision dynamics"]);
  expect(all.every((g) => g.questions.length <= 3)).toBe(true);

  const pilots = discoveryGuide(playbook, { archetypeId: "stuck-in-pilots", attendees: [{ name: "Synthetic Security Lead", title: "Chief Information Security Officer" }] });
  expect(ids(pilots)).toContain("q-blocker");
  expect(ids(pilots)).not.toContain("q-built"); // for other archetypes only
  const criteria = pilots.flatMap((g) => g.questions).find((q) => q.id === "q-criteria")!;
  expect(criteria.why).toEqual(["for Synthetic Security Lead"]);
  expect(criteria.meddpicc).toBe("DC");

  const gaps = discoveryGuide(playbook, { archetypeId: null, attendees: [], gaps: ["CH"] });
  expect(gaps.flatMap((g) => g.questions).find((q) => q.id === "q-champion")?.why).toEqual(["still to find out"]);
});

it("shows the guide on the meeting page and gives the brief the account's place in the playbook", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const { accountId } = seedAccount();
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: "builder", archetype_hypothesis: "Synthetic hypothesis to test." }, actorUserId: USER });
  moveToStep(accountId, playbook, "discovery", USER);
  const contact = applyEntityChange({ accountId, entityType: "contact", op: "create", payload: { name: "Synthetic Info Chief", title: "Chief Information Officer", org: "customer" }, actorUserId: USER });
  const meeting = applyEntityChange({ accountId, entityType: "meeting", op: "create", payload: { title: "Synthetic discovery", held_at: "2026-11-02", attendees: [{ contact_id: contact.entityId, name: "Synthetic Info Chief", note: null }] }, actorUserId: USER });

  const prompt = playbookForPrompt(accountId, [{ contact_id: contact.entityId, name: "Synthetic Info Chief" }]);
  expect(prompt).toContain('"Building their own"');
  expect(prompt).toContain("Synthetic hypothesis to test.");
  expect(prompt).toContain('step "Executive discovery"');
  expect(prompt).toContain("What have you built on your own data");
  expect(prompt).toContain("never cite it");

  const { default: Page } = await import("@/app/accounts/[id]/meetings/[mid]/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId, mid: meeting.entityId }) }))).document;
  const questions = [...doc.querySelectorAll('[data-testid="discovery-question"]')].map((q) => q.textContent ?? "");
  expect(questions.some((q) => q.includes("What have you built on your own data") && q.includes("for Synthetic Info Chief"))).toBe(true);
  expect(questions.some((q) => q.includes("stopped your pilots"))).toBe(false);
});
