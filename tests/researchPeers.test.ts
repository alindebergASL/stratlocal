// Synthetic organisations and example domains only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { sanitizeResearchNote } from "@/lib/research/extract";
import { startResearchRun } from "@/lib/research/run";
import { acceptNote, listNotes, researchForPrompt } from "@/lib/research/notes";
import { keptPeers } from "@/lib/research/peers";
import { getRun } from "@/lib/ai/guard";
import type { ResearchNote } from "@/lib/research/schema";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

it("a peer stands only on a peers finding that survives the checks", () => {
  const prose = "Synthetic Peer Board moved to a shared data centre in 2026 (https://example.test/peer). Synthetic Org opened an office (https://example.test/org).";
  const sources = new Map([["example.test/peer", "https://example.test/peer"], ["example.test/org", "https://example.test/org"]]);
  const f = (quote: string, url: string, topic: "peers" | "org") => ({ text: quote, quote, url, confidence: "medium" as const, date: null, topic });
  const note: ResearchNote = {
    title: "Synthetic Org",
    summary: "S.",
    findings: [
      f("Synthetic Org made up a fact that is not in the prose at all.", "https://example.test/org", "org"),
      f("Synthetic Peer Board moved to a shared data centre in 2026", "https://example.test/peer", "peers"),
      f("Synthetic Org opened an office", "https://example.test/org", "org"),
    ],
    open_questions: [],
    peers: [
      { name: "Synthetic Peer Board", kind: "peer", doing: "Moved to a shared data centre.", finding: 1 },
      { name: "Synthetic Rival", kind: "competitor", doing: "Pinned on a finding about the account itself.", finding: 2 },
      { name: "Synthetic Ghost", kind: "peer", doing: "Its finding was dropped.", finding: 0 },
    ],
    peers_summary: "Peers are consolidating.",
  };
  const { note: clean, dropped } = sanitizeResearchNote(note, prose, sources);
  expect(clean.peers).toEqual([{ name: "Synthetic Peer Board", kind: "peer", doing: "Moved to a shared data centre.", finding: 0 }]);
  expect(clean.peers_summary).toBe("Peers are consolidating.");
  expect(dropped.filter((d) => d.startsWith("peer "))).toHaveLength(2);
});

it("research asks for peers, keeps them with their finding, and shows them on Research and to prompts", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Peers Co" });
  const runId = startResearchRun({ accountId, userId: USER, focus: null, depth: "standard" });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const draft = listNotes(accountId, "draft")[0]!;
  expect(draft.meta.peers?.[0]).toMatchObject({ name: "Synthetic Neighbour Authority", kind: "peer" });
  const at = draft.meta.peers![0]!.finding;
  expect(draft.meta.findings[at]?.topic).toBe("peers");

  // Not kept: no peer.
  acceptNote(draft.doc.id, draft.meta.findings.map((_, i) => i).filter((i) => i !== at), USER);
  expect(keptPeers(accountId)).toBeNull();
  expect(researchForPrompt(accountId)).not.toContain("peers_and_competitors");
});

it("a kept peer is on Research, the Overview and in the research prompt", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Peers Two" });
  const runId = startResearchRun({ accountId, userId: USER, focus: null, depth: "standard" });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const draft = listNotes(accountId, "draft")[0]!;
  acceptNote(draft.doc.id, draft.meta.findings.map((_, i) => i), USER);
  expect(keptPeers(accountId)?.peers.map((p) => p.name)).toEqual(["Synthetic Neighbour Authority"]);
  expect(researchForPrompt(accountId)).toContain("Synthetic Neighbour Authority (peer)");

  const { default: ResearchPage } = await import("@/app/accounts/[id]/research/page");
  const known = parseHTML(renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve({}) }))).document;
  // Peers live on their own tab, once: not again under What we know.
  expect(known.querySelector('[data-testid="research-tab-peers"]')?.textContent).toBe("Peers and competitors1");
  expect([...known.querySelectorAll('[data-testid="research-topic-row"]')].some((r) => r.getAttribute("data-topic") === "peers")).toBe(false);
  const doc = parseHTML(renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve({ view: "peers" }) }))).document;
  expect(doc.querySelectorAll('[data-testid="peer"]')).toHaveLength(1);
  expect(doc.querySelectorAll('[data-testid="research-topic-row"]')).toHaveLength(0);
  expect(doc.querySelector('[data-testid="peers-summary"]')?.textContent).toContain("consolidating data centres");
  expect(doc.querySelector('[data-testid="peer"]')?.textContent).toContain("Synthetic Neighbour Authority");

  const { default: Overview } = await import("@/app/accounts/[id]/page");
  const ov = parseHTML(renderToStaticMarkup(await Overview({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve({}) } as never))).document;
  expect(ov.querySelector('[data-testid="research-panel-peers"]')?.textContent).toContain("Synthetic Neighbour Authority");
});
