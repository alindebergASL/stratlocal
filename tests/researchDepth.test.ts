// Synthetic organisations, people and example domains only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { harvestUrls, userMessage, WebResearchInput } from "@/lib/ai/runWebResearch";
import { sanitizeResearchNote } from "@/lib/research/extract";
import { sourceKind } from "@/lib/research/provenance";
import { rankChanges } from "@/lib/research/rank";
import { openQuestions } from "@/components/ResearchOpen";
import { confirmedEntity, startResearchRun } from "@/lib/research/run";
import { acceptNote, listNotes } from "@/lib/research/notes";
import { getRun } from "@/lib/ai/guard";
import type { ResearchFinding } from "@/lib/research/schema";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

const finding = (i: number, over: Partial<ResearchFinding> = {}): ResearchFinding => ({ text: `Synthetic statement ${i}.`, quote: `Synthetic quote number ${i}.`, url: `https://example.test/page/${i}`, date: "2026-09-01", confidence: "medium", topic: "strategy", ...over });

it("keeps the search index's own date for each result", () => {
  const sources = new Map<string, string>();
  const ages = new Map<string, string>();
  harvestUrls(
    [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.test/a", page_age: "April 30, 2025" }, { type: "web_search_result", url: "https://example.test/b" }] }] as never,
    sources,
    ages,
  );
  expect([...sources.keys()]).toEqual(["example.test/a", "example.test/b"]);
  expect(Object.fromEntries(ages)).toEqual({ "example.test/a": "April 30, 2025" });
});

it("pins the run to a confirmed domain and names filings and earnings calls as targets", () => {
  const msg = userMessage(WebResearchInput.parse({ companyName: "Synthetic Org", domain: "synthetic.example", depth: "standard" }));
  expect(msg).toContain("Website: synthetic.example");
});

it("attaches index dates in code, checks the entity's page and keeps the buying group as guesses", () => {
  const prose = "Synthetic quote number 0.";
  const sources = new Map([["example.test/page/0", "https://example.test/page/0"]]);
  const { note } = sanitizeResearchNote(
    {
      title: "T",
      summary: "S",
      open_questions: [],
      findings: [finding(0)],
      entity: { name: "Synthetic Org", domain: "https://WWW.Synthetic.example/about", ticker: null, parent: "Synthetic Group", hq: null, url: "https://not-returned.example/x" },
      buying_group: [{ role: "Synthetic CIO", likely: "signer", basis: "Likely owns the budget.", question: "Who signs?" }],
    },
    prose,
    sources,
    [],
    [],
    new Map([["example.test/page/0", "3 days ago"]]),
  );
  expect(note.findings[0]?.page_age).toBe("3 days ago");
  expect(note.entity).toMatchObject({ name: "Synthetic Org", domain: "www.synthetic.example", parent: "Synthetic Group", url: null });
  expect(note.buying_group).toHaveLength(1);
});

it("knows the account's own pages by its confirmed domain", () => {
  expect(sourceKind("https://careers.synthetic.example/jobs", ["Unrelated Name", "www.synthetic.example"])).toBe("Company");
  expect(sourceKind("https://elsewhere.example/x", ["Unrelated Name", "synthetic.example"])).toBe("Other");
});

it("ranks what a watch found by reason to act, plays and fit, and marks the old down", () => {
  const findings = [finding(0), finding(1), finding(2, { date: "2024-01-01" }), finding(3)];
  const reads = {
    "1": { signal: "trigger" as const, owner: null, fits: ["Synthetic agents"], so_what: null },
    "2": { signal: "compelling_event" as const, owner: null, fits: [], so_what: null },
    "3": { signal: "compelling_event" as const, owner: "the CFO", fits: [], so_what: null },
  };
  const ranked = rankChanges(findings, reads, { 0: [{ playTitle: "Synthetic play" }] }, "2026-10-22");
  expect(ranked.map((r) => r.index)).toEqual([1, 3, 0, 2]);
  expect(ranked[1]!.reasons).toEqual(["a compelling event, owned by the CFO"]);
  expect(ranked.at(-1)!.reasons).toContain("but over a year old");
});

it("lists each open question once, newest run first", () => {
  expect(openQuestions([
    { generated_at: "2026-01-01", open_questions: ["Older question?", "Shared question?"] },
    { generated_at: "2026-09-01", open_questions: ["shared question", "Newer question?"] },
  ])).toEqual(["shared question", "Newer question?", "Older question?"]);
});

it("a run records the entity, buying group and index dates, and the page shows them", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Depth Co" });
  const runId = startResearchRun({ accountId, userId: USER, focus: null, depth: "standard" });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const draft = listNotes(accountId, "draft")[0]!;
  expect(draft.meta.entity).toMatchObject({ name: "Synthetic Depth Co", domain: "example.com" });
  expect(draft.meta.buying_group?.[0]?.likely).toBe("signer");
  expect(draft.meta.findings.some((f) => f.page_age === "July 15, 2026")).toBe(true);
  acceptNote(draft.doc.id, draft.meta.findings.map((_, i) => i), USER);
  expect(confirmedEntity(accountId)?.domain).toBe("example.com");

  const { default: ResearchPage } = await import("@/app/accounts/[id]/research/page");
  const doc = parseHTML(renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve({}) }))).document;
  expect(doc.querySelector('[data-testid="research-entity"]')?.textContent).toContain("Synthetic Depth Co · example.com");
  // Who decides and what is still open live on their own tab.
  const open = parseHTML(renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve({ view: "open" }) }))).document;
  expect(open.querySelector('[data-testid="research-buying-group"]')?.textContent).toContain("Likely signsChief information officer");
  expect(open.querySelector('[data-testid="research-open-questions"]')?.textContent).toContain("How the capital plan is split by year.");
  expect(doc.querySelector('[data-testid="research-plan-entity"]')?.textContent).toContain("It stays on Synthetic Depth Co (example.com)");
  // The account's own site, by its confirmed domain.
  expect([...doc.querySelectorAll('[data-testid="source-kind"]')].some((b) => b.textContent === "Company")).toBe(true);
});
