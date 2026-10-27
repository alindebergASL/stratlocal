// SYNTHETIC ONLY.
//
// /review deals what is waiting into one card at a time, like the meeting
// page, with the whole list one press away. A drafted thesis can run to
// paragraphs; the card shows two lines and the rest on request, with why it
// was proposed and what it rests on.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
import { createProposalBatch } from "@/lib/proposals/apply";
import { seedAccount, USER } from "./helpers";

async function review(id: string) {
  // An account's changes are reviewed in the Inbox now (DECISIONS #105).
  const { default: Page } = await import("@/app/inbox/page");
  return parseHTML(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ kind: "changes", account: id }) }))).document;
}

it("opens on one card, says where each change came from, and shortens a long thesis", async () => {
  const seed = seedAccount();
  const thesis = "Win the platform decision by proving operational reliability first. ".repeat(6).trim();
  createProposalBatch(seed.accountId, { kind: "plan_draft", id: "synthetic", aiRunId: null }, [
    { entity_type: "account", op: "update", entity_id: seed.accountId, payload: { thesis }, rationale: "The meetings keep returning to uptime.", source_ref: { kind: "deal", id: seed.dealId, refs: [{ kind: "play", id: seed.playId }, { kind: "deal", id: seed.dealId }] } },
  ]);
  createProposalBatch(seed.accountId, { kind: "meeting", id: seed.meetingId, aiRunId: null }, [
    { entity_type: "action_item", op: "create", payload: { text: "Send the sizing notes", due: "2026-11-02" } },
  ]);
  const doc = await review(seed.accountId);
  expect(doc.querySelectorAll('[data-testid="change-card"]')).toHaveLength(1);
  const card = doc.querySelector('[data-testid="change-card"]')!;
  expect(card.textContent).toContain("Plan draft · Account · change");
  expect(card.querySelector('[data-testid="change-value-toggle"]')?.textContent).toBe("Show all");
  expect(card.querySelector('[data-testid="change-why"]')?.textContent).toBe("The meetings keep returning to uptime. · Evidence: 2 deals, 1 play");
  expect(doc.querySelector('[data-testid="review-as-list"]')).not.toBeNull();
});

it("says so when nothing is waiting", async () => {
  const seed = seedAccount();
  const doc = await review(seed.accountId);
  expect(doc.querySelector('[data-testid="change-deck"]')).toBeNull();
  expect(doc.documentElement?.textContent ?? doc.toString()).toContain("Nothing to review.");
});
