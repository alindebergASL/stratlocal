// The neutral starter and synthetic accounts only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { getRun } from "@/lib/ai/guard";
import { acceptProposal, applyEntityChange, rejectProposal } from "@/lib/proposals/apply";
import { getAccount } from "@/lib/queries/accounts";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { archetypeHistory, pendingArchetype, startArchetypeSuggestion } from "@/lib/playbook/archetype";
import { supersedePendingPlanDrafts } from "@/lib/plan/run";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

it("needs a playbook with archetypes before it suggests one", () => {
  const { accountId } = seedAccount();
  expect(() => startArchetypeSuggestion(accountId, USER)).toThrow(/no archetypes/);
});

it("suggests an archetype as a proposal, sets it only when accepted, and keeps the moves as history", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const { accountId } = seedAccount();
  const runId = startArchetypeSuggestion(accountId, USER);
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const pending = pendingArchetype(accountId)!;
  expect(pending).toMatchObject({ archetypeId: "exploring", why: expect.stringContaining("no published AI policy") });
  expect(getAccount(accountId)?.archetype_id ?? null).toBeNull();
  expect(() => startArchetypeSuggestion(accountId, USER)).toThrow(/already waiting/);
  // A plan re-draft does not sweep it away.
  supersedePendingPlanDrafts(accountId);
  expect(pendingArchetype(accountId)?.id).toBe(pending.id);

  acceptProposal(pending.id, USER);
  expect(getAccount(accountId)).toMatchObject({ archetype_id: "exploring", archetype_hypothesis: expect.stringContaining("looks like Exploring") });

  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: "builder" }, actorUserId: USER });
  expect(archetypeHistory(accountId).map((h) => [h.from, h.to])).toEqual([["exploring", "builder"], [null, "exploring"]]);

  const second = startArchetypeSuggestion(accountId, USER);
  await vi.waitFor(() => expect(getRun(second)?.status).toBe("done"));
  rejectProposal(pendingArchetype(accountId)!.id, USER);
  expect(getAccount(accountId)?.archetype_id).toBe("builder");

  const { default: Page } = await import("@/app/accounts/[id]/playbook/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId }) }))).document;
  expect(doc.querySelector('[data-testid="archetype-current"]')?.textContent).toBe("Building their own");
  expect(doc.querySelector('[data-testid="account-archetype"]')?.textContent).toBe("Building their own");
  expect(doc.querySelectorAll('[data-testid="archetype-history"] li')).toHaveLength(2);
});
