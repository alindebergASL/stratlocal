// Synthetic accounts and records only.
import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: "user-1", name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/accounts", useSearchParams: () => new URLSearchParams() }));
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { acceptNote, storeDraftNote } from "@/lib/research/notes";
import { accountSignals, attentionScore } from "@/lib/queries/accountSignals";
import { SignalChips } from "@/components/Signal";

const NOW = new Date("2026-10-22T12:00:00Z");

it("counts what deserves attention, in one pass, and names the newest reason to act", () => {
  const busy = seedAccount({ name: "Synthetic Busy" });
  const calm = seedAccount({ name: "Synthetic Calm", dealId: "SYN-DEAL-002" });
  applyEntityChange({ accountId: busy.accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic late", status: "open", due: "2026-10-01" }, actorUserId: USER });
  applyEntityChange({ accountId: busy.accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic later", status: "open", due: "2026-12-01" }, actorUserId: USER });
  createProposalBatch(busy.accountId, { kind: "plan_draft", id: "synthetic", aiRunId: null }, [{ entity_type: "action_item", op: "create", payload: { text: "Synthetic proposed" }, rationale: "synthetic" }]);
  const doc = storeDraftNote({
    accountId: busy.accountId, userId: USER, aiRunId: "synthetic", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [], prose: "P",
    note: { title: "T", summary: "S", open_questions: [], findings: [{ text: "Synthetic support ends.", quote: "Synthetic quote here.", url: "https://example.test/a", confidence: "high", date: "2026-09-30", topic: "procurement" }], reads: { "0": { signal: "compelling_event", owner: null, fits: [], so_what: null } } },
  });
  acceptNote(doc.id, [0], USER);
  // Calm has had nothing written down for a month.
  db().prepare("UPDATE change_log SET created_at = ? WHERE account_id = ?").run(NOW.getTime() - 30 * 86400000, calm.accountId);

  const s = accountSignals([busy.accountId, calm.accountId], NOW);
  const b = s.get(busy.accountId)!;
  expect(b).toMatchObject({ overdue: 1, review: 1, noNextStep: 1, quiet: false, reason: { kind: "compelling_event", date: "2026-09-30", text: "Synthetic support ends." } });
  const c = s.get(calm.accountId)!;
  expect(c).toMatchObject({ overdue: 0, review: 0, reason: null, quiet: true, quietDays: 30 });
  expect(attentionScore(b)).toBeGreaterThan(attentionScore(c));
  expect(accountSignals([]).size).toBe(0);

  const doc2 = parseHTML(renderToStaticMarkup(createElement(SignalChips, { accountId: busy.accountId, signals: b }))).document;
  expect([...doc2.querySelectorAll("[data-testid^='signal-']")].map((e) => e.getAttribute("data-testid"))).toEqual(["signal-reason", "signal-overdue", "signal-review", "signal-next-step"]);
  expect(doc2.querySelector('[data-testid="signal-reason"]')?.textContent).toBe("Compelling event· 2026-09-30");
  expect(doc2.querySelector('[data-testid="signal-overdue"]')?.getAttribute("href")).toBe(`/accounts/${busy.accountId}/follow-ups`);
  // Nothing to say renders nothing.
  expect(renderToStaticMarkup(createElement(SignalChips, { accountId: "x", signals: { reason: null, overdue: 0, review: 0, noNextStep: 0, quiet: false, quietDays: 3 } }))).toBe("");
});

it("lists the accounts that need you first, says how many in the header, and can show only those with a reason to act", async () => {
  const plain = seedAccount({ name: "Synthetic A Plain", dealId: "SYN-DEAL-101" });
  const urgent = seedAccount({ name: "Synthetic Z Urgent", dealId: "SYN-DEAL-102" });
  const doc = storeDraftNote({
    accountId: urgent.accountId, userId: USER, aiRunId: "synthetic", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [], prose: "P",
    note: { title: "T", summary: "S", open_questions: [], findings: [{ text: "Synthetic deadline.", quote: "Synthetic quote here.", url: "https://example.test/b", confidence: "high", date: "2026-10-01", topic: "risk" }], reads: { "0": { signal: "trigger", owner: null, fits: [], so_what: null } } },
  });
  acceptNote(doc.id, [0], USER);
  const { default: AccountsPage } = await import("@/app/accounts/page");
  const render = async (q: Record<string, string> = {}) => parseHTML(renderToStaticMarkup(await AccountsPage({ searchParams: Promise.resolve(q) }))).document;
  const names = (d: Document) => [...d.querySelectorAll('[data-testid="accounts-list"] li a[href^="/accounts/"]')].map((a) => a.textContent).filter((t) => t?.startsWith("Synthetic"));
  const first = await render();
  expect(names(first)[0]).toBe("Synthetic Z Urgent");
  expect(first.toString()).toContain("1 with a reason to act");
  expect(names(await render({ sort: "name" }))[0]).toBe("Synthetic A Plain");
  expect(names(await render({ only: "reasons" }))).toEqual(["Synthetic Z Urgent"]);
  expect(plain.accountId).toBeTruthy();
});
