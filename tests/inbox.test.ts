// Synthetic data only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { createProposalBatch } from "@/lib/proposals/apply";
import { inboxCount, inboxSummary } from "@/lib/inbox/query";
import { getDeal, listContacts, listPendingProposals } from "@/lib/queries/accounts";
import { storeDraftNote } from "@/lib/research/notes";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, display_name: "Synthetic Me", email: "me@example.test" }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

it("gathers every decision in one place, and accepts only the quick ones in one press", async () => {
  const { accountId, dealId, meetingId } = seedAccount({ name: "Synthetic Inbox Co" });
  createProposalBatch(accountId, { kind: "meeting", id: meetingId, aiRunId: null }, [
    { entity_type: "contact", op: "create", payload: { name: "Synthetic New Person", org: "customer" }, rationale: "named in the meeting" },
    { entity_type: "action_item", op: "create", payload: { text: "Synthetic send the deck" }, rationale: "agreed" },
    { entity_type: "deal", op: "update", entity_id: dealId, payload: { stage: 5 }, rationale: "they said so" },
  ]);
  storeDraftNote({ accountId, userId: USER, aiRunId: "synthetic", note: { title: "Synthetic findings", summary: "S.", open_questions: [], findings: [{ text: "A synthetic fact.", quote: "A synthetic quote here.", url: "https://example.test/a", confidence: "medium", date: null, topic: "strategy" }] }, prose: "P", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });

  const s = inboxSummary(USER);
  expect(s.changes).toEqual([{ accountId, accountName: "Synthetic Inbox Co", total: 3, quick: 2, sources: ["meeting notes"] }]);
  expect(s.research).toEqual([expect.objectContaining({ accountId, title: "Synthetic findings", findings: 1 })]);
  expect(s.total).toBe(4);
  expect(inboxCount(USER)).toBe(4);

  const { default: Inbox } = await import("@/app/inbox/page");
  const doc = parseHTML(renderToStaticMarkup(await Inbox({ searchParams: Promise.resolve({}) }))).document;
  expect(doc.querySelector('[data-testid="inbox-change-row"]')?.textContent).toContain("3 changes from meeting notes · 2 quick to check");
  expect(doc.querySelector('[data-testid="inbox-research"]')?.textContent).toContain("1 finding to keep or drop");
  const onlyResearch = parseHTML(renderToStaticMarkup(await Inbox({ searchParams: Promise.resolve({ kind: "research" }) }))).document;
  expect(onlyResearch.querySelector('[data-testid="inbox-changes"]')).toBeNull();
  expect(onlyResearch.querySelector('[data-testid="inbox-kind-research"]')?.getAttribute("aria-current")).toBe("page");

  // The quick ones, and never the stage.
  const { acceptQuickAction } = await import("@/app/inbox/actions");
  expect(await acceptQuickAction(accountId)).toEqual({ ok: true, message: "2 accepted", ids: expect.any(Array) });
  expect(listContacts(accountId).some((c) => c.name === "Synthetic New Person")).toBe(true);
  expect(getDeal(dealId)!.stage).toBe(3);
  expect(listPendingProposals(accountId).map((p) => p.entity_type)).toEqual(["deal"]);
  expect(inboxSummary(USER).changes[0]).toMatchObject({ total: 1, quick: 0 });
});
