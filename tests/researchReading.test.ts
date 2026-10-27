// Invented records only; exercising the server reading page cannot call a provider.
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { acceptNote, storeDraftNote, listNotes } from "@/lib/research/notes";
import { archiveDocument } from "@/lib/documents";
import { FindingRow } from "@/components/FindingList";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const finding = (i: number) => ({ text: `Synthetic retained statement ${i}.`, quote: "Synthetic report wording.", url: "https://example.test/source", date: "2026-09-01", confidence: "medium" as const, topic: "technology" as const });
function fixture() {
  const { accountId } = seedAccount();
  const ids = Array.from({ length: 3 }, (_, n) => {
    const doc = storeDraftNote({ accountId, userId: USER, aiRunId: "synthetic", note: { title: `Reading note ${n}`, summary: "Original model paragraph.", open_questions: [], findings: Array.from({ length: 5 }, (_, i) => finding(i)) }, prose: "Whole original report.", capture: { status: "partial", reasons: ["max_tokens"] }, focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });
    acceptNote(doc.id, [1, 2, 3, 4], USER);
    return doc.id;
  });
  return { accountId, ids };
}
async function page(accountId: string, query: Record<string, string | undefined> = {}) {
  const { default: ResearchPage } = await import("@/app/accounts/[id]/research/page");
  const html = renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve(query) }));
  return { html, document: parseHTML(html).document };
}
it("opens on what we know by topic, lists every run and reads one without an adjustment checklist or writes", async () => {
  const { accountId, ids } = fixture();
  const before = JSON.stringify(listNotes(accountId));
  const initial = await page(accountId);
  // By topic across runs, not one note at a time.
  expect(initial.document.querySelectorAll('[data-testid="research-reading-note"]')).toHaveLength(0);
  expect(initial.document.querySelectorAll('[data-testid="research-topic-row"]')).toHaveLength(1);
  expect(initial.document.querySelector('[data-testid="research-topic-more"]')?.textContent).toBe("All 12 →");
  // The runs, and each one's full report, are on the Full report tab.
  expect(initial.document.querySelectorAll('[data-testid="research-runs"] a')).toHaveLength(0);
  expect(initial.document.querySelector('[data-testid="research-tab-report"]')?.textContent).toBe("Full report3");
  const report = await page(accountId, { view: "report" });
  expect(report.document.querySelectorAll('[data-testid="research-runs"] a')).toHaveLength(3);
  expect(report.document.querySelector('[data-testid="research-full-report"]')?.hasAttribute("open")).toBe(true);
  expect(report.document.querySelector('[data-testid="research-tab-report"]')?.getAttribute("aria-current")).toBe("page");
  expect(initial.document.querySelector('[data-testid="account-tab-research"]')?.getAttribute('aria-current')).toBe('page');
  expect(initial.html).toContain('12 kept findings from 3 runs, newest dated 2026-09-01');
  expect(initial.document.querySelector('[data-testid="research-topic-gaps"]')?.textContent).toContain('Leadership');
  // Who said it and when, on the row itself.
  expect(initial.document.querySelector('[data-testid="source-kind"]')?.textContent).toBe("Other");
  expect(initial.document.querySelector('[data-testid="finding-age"]')?.textContent).toContain("2026-09-01");
  const other = await page(accountId, { read: ids[0]! });
  expect(other.document.querySelector('[data-testid="research-reading-note"]')?.id).toBe(`research-${ids[0]!}`);
  expect(other.document.querySelector('[data-testid="research-note-picker"] [aria-current="page"]')?.getAttribute("href")).toContain(`read=${ids[0]!}`);
  expect(other.html).not.toContain('data-testid="research-adjust"');
  expect(other.html).not.toContain('data-testid="research-rereview"');
  expect(other.html).toContain("Showing 2 of 4 retained findings");
  expect(other.html).toContain("No retained findings:");
  expect(other.html).toContain('not independently verified');
    expect(other.document.querySelector('[data-testid="research-note-picker"]')?.hasAttribute('open')).toBe(false);
    expect(other.document.querySelector('[data-testid="research-dossier"]')?.textContent).toContain('No retained findings:');
    expect(other.document.querySelector('[data-testid="research-dossier"]')?.textContent).toContain('output limit');
  expect(other.html).toContain("output limit");
  expect(other.document.querySelector('[data-testid="research-manage"]')?.hasAttribute("open")).toBe(false);
  expect(other.html).toContain("Whole original report.");
  expect(JSON.stringify(listNotes(accountId))).toBe(before);
});
it("preserves adjustment and original-index reading links, including unavailable findings", async () => {
  const { accountId, ids } = fixture();
  expect((await page(accountId, { note: ids[0]! })).html).toContain('data-testid="research-adjust"');
  for (const query of [{ note: ids[0]!, topic: "technology" }, { note: ids[0]!, finding: "3" }]) {
    const result = await page(accountId, query);
    expect(result.html).not.toContain('data-testid="research-adjust"');
    expect(result.html).toContain("Synthetic retained statement 3.");
    expect(result.html).toContain("output limit");
  }
  expect((await page(accountId, { note: ids[0]!, finding: "0" })).html).toContain('data-testid="research-finding-unavailable"');
  acceptNote(ids[0]!, [1], USER);
  expect((await page(accountId, { note: ids[0]!, finding: "3" })).html).toContain('data-testid="research-finding-unavailable"');
});
it("keeps all notes and all findings accessible and does not substitute another note for an unavailable selection", async () => {
  const { accountId, ids } = fixture();
  const all = await page(accountId, { all: "1" });
  expect(all.document.querySelectorAll('[data-testid="research-reading-note"]')).toHaveLength(3);
  expect(all.document.querySelectorAll('[data-finding-anchor]')).toHaveLength(12);
  archiveDocument(ids[0]!, USER);
  const gone = await page(accountId, { read: ids[0]! });
  expect(gone.html).toContain('data-testid="research-note-unavailable"');
  expect(gone.document.querySelectorAll('[data-testid="research-reading-note"]')).toHaveLength(0);
  expect(gone.html).toContain("Restore");
});
it("handles an empty account and a note with nothing retained without inventing findings", async () => {
  const { accountId, ids } = fixture();
  acceptNote(ids[0]!, [], USER);
  const emptyNote = await page(accountId, { read: ids[0]! });
  expect(emptyNote.html).toContain("Showing 0 of 0 retained findings");
  expect(emptyNote.html).toContain("Nothing in this note was accepted");
  for (const id of ids) archiveDocument(id, USER);
  const empty = await page(accountId);
  expect(empty.html).toContain("Nothing kept yet");
  expect(empty.document.querySelectorAll('[data-testid="research-reading-note"]')).toHaveLength(0);
});
it("moves confidence into Evidence only in reading mode and preserves both provenance labels", () => {
  for (const sourceBound of [false, true]) {
    const f = { ...finding(1), ...(sourceBound ? { evidence: { kind: "source_excerpt" as const, text: "Source-bound words.", location: "Synthetic page" } } : {}) };
    const html = renderToStaticMarkup(createElement(FindingRow, { finding: f, reading: true }));
    const doc = parseHTML(html).document;
    expect(doc.querySelector('details')?.textContent).toContain("Model confidence: medium");
    expect(doc.querySelector('details')?.textContent).toContain("not verification");
    expect(doc.querySelector('[data-testid="finding-age"]')?.textContent).toContain("2026-09-01");
    expect(html).toContain(sourceBound ? "Source-bound excerpt" : "not an original-source quotation");
    doc.querySelector('details')?.remove();
    expect(doc.toString()).not.toContain("Model confidence");
  }
  // In review too, the model's opinion of itself is evidence detail, not a
  // label on every row.
  const review = parseHTML(renderToStaticMarkup(createElement(FindingRow, { finding: finding(1) }))).document;
  expect(review.querySelector("details")?.textContent).toContain("Model confidence:");
  review.querySelector("details")?.remove();
  expect(review.toString()).not.toContain("Model confidence");
});
