// Synthetic organisations and example domains only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { startResearchRun } from "@/lib/research/run";
import { acceptNote, listNotes } from "@/lib/research/notes";
import { storeCustomerDocument } from "@/lib/import/run";
import { getRun } from "@/lib/ai/guard";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

async function researched(name: string) {
  const { accountId } = seedAccount({ name });
  const runId = startResearchRun({ accountId, userId: USER, focus: null, depth: "standard" });
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const draft = listNotes(accountId, "draft")[0]!;
  acceptNote(draft.doc.id, draft.meta.findings.map((_, i) => i), USER);
  return { accountId, noteId: draft.doc.id };
}

async function view(accountId: string, query: Record<string, string> = {}) {
  const { default: ResearchPage } = await import("@/app/accounts/[id]/research/page");
  return parseHTML(renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve(query) }))).document;
}

const tabs = (doc: Document) => [...doc.querySelectorAll('[data-testid="research-tabs"] a')].map((a) => [a.textContent, a.getAttribute("aria-current")]);

it("opens on the brief, a compact research action and five tabs, one shown at a time", async () => {
  const { accountId, noteId } = await researched("Synthetic Workspace Co");
  await storeCustomerDocument({ accountId, filename: "their-plan.md", bytes: Buffer.from("# Synthetic plan\n\nConsolidate by 2028."), userId: USER });

  const known = await view(accountId);
  expect(tabs(known)).toEqual([
    ["What we know3", "page"],
    ["Peers and competitors1", null],
    ["Their documents1", null],
    ["Still to find out4", null],
    ["Full report1", null],
  ]);
  const html = known.toString();
  expect(html.indexOf('data-testid="research-brief"')).toBeLessThan(html.indexOf('data-testid="research-tabs"'));
  // Running again is one closed action, not a section in the reading.
  expect(known.querySelector('[data-testid="research-run-open"]')?.hasAttribute("open")).toBe(false);
  expect(known.querySelector('[data-testid="research-run-open"] [data-testid="research-run"]')).not.toBeNull();
  expect(known.querySelector('[data-testid="research-by-topic"]')).not.toBeNull();
  expect(known.querySelector('[data-testid="peers-list"]')).toBeNull();
  expect(known.querySelector('[data-testid="customer-docs"]')).toBeNull();
  expect(known.querySelector('[data-testid="research-full-report"]')).toBeNull();

  const docs = await view(accountId, { view: "documents" });
  expect(docs.querySelector('[data-testid="customer-doc"]')?.textContent).toBe("their-plan.md");
  expect(docs.querySelector('[data-testid="research-by-topic"]')).toBeNull();

  const open = await view(accountId, { view: "open" });
  expect(open.querySelector('[data-testid="research-buying-group"]')).not.toBeNull();
  expect(open.querySelector("#research-updates")).not.toBeNull();

  const report = await view(accountId, { view: "report" });
  expect(report.querySelector('[data-testid="research-report-tab"] [data-testid="research-full-report"]')?.hasAttribute("open")).toBe(true);
  expect(report.querySelector('[data-testid="research-report-tab"]')?.textContent).toContain("capital plan");
  const chosen = await view(accountId, { view: "report", run: noteId });
  expect(chosen.querySelector('[data-testid="research-runs"] [aria-current="page"]')?.getAttribute("href")).toContain(`run=${noteId}`);
  const missing = await view(accountId, { view: "report", run: "no-such-run" });
  expect(missing.querySelector('[data-testid="research-run-unavailable"]')).not.toBeNull();

  // Older addresses still open what they did, under the right tab.
  const read = await view(accountId, { read: noteId });
  expect(read.querySelector('[data-testid="research-reading-note"]')).not.toBeNull();
  expect(read.querySelector('[data-testid="research-tab-report"]')?.getAttribute("aria-current")).toBe("page");
  const topic = await view(accountId, { topic: "peers" });
  expect(topic.querySelector('[data-testid="research-tab-peers"]')?.getAttribute("aria-current")).toBe("page");
  const finding = await view(accountId, { note: noteId, finding: "0" });
  expect(finding.querySelector('[data-testid="research-tab-known"]')?.getAttribute("aria-current")).toBe("page");
});

it("an account with no research leads with the form, and its documents are still a tab away", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Empty Co" });
  await storeCustomerDocument({ accountId, filename: "rfp.md", bytes: Buffer.from("# Synthetic RFP"), userId: USER });
  const doc = await view(accountId);
  expect(doc.querySelector('[data-testid="research-first-time"]')).not.toBeNull();
  expect(doc.querySelector('[data-testid="research-run-open"]')).toBeNull();
  expect(doc.querySelector('[data-testid="research-tab-documents"]')?.textContent).toBe("Their documents1");
  const docs = await view(accountId, { view: "documents" });
  expect(docs.querySelector('[data-testid="customer-doc"]')?.textContent).toBe("rfp.md");
});
