// Synthetic files only: the account report in other formats, a JSON export
// read without the model, and a customer document kept as context.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { seedAccount, tinyPdf, USER } from "./helpers";
import { db } from "@/lib/db";
import { documentText, DocumentFileError } from "@/lib/documents/text";
import { jsonExtraction } from "@/lib/import/jsonReport";
import { startImportRun, storeCustomerDocument, storeReportDocument, UploadError } from "@/lib/import/run";
import { customerDocsForPrompt, listCustomerDocs } from "@/lib/documents/customer";
import { buildContextPack, evidenceIndex } from "@/lib/meetings/contextPack";
import { briefEvidenceResolver } from "@/lib/meetings/briefEvidence";
import { getRun } from "@/lib/ai/guard";
import { listPendingProposals } from "@/lib/queries/accounts";

vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

it("reads Markdown, JSON and PDF, and says plainly when it cannot", async () => {
  expect(await documentText("r.md", Buffer.from("# Synthetic plan\r\n\r\n\r\n- one"))).toBe("# Synthetic plan\n\n- one");
  expect(await documentText("r.json", Buffer.from('{"deals":[{"deal_id":"SYN-1"}]}'))).toContain('"deal_id": "SYN-1"');
  await expect(documentText("r.json", Buffer.from("{not json"))).rejects.toBeInstanceOf(DocumentFileError);
  await expect(documentText("r.xlsx", Buffer.from("x"))).rejects.toThrow(/PDF.*Markdown.*JSON/);
});

it("stores a report as the format it came in, and refuses what it cannot read", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Formats Co" });
  const pdf = await storeReportDocument({ accountId, filename: "report.pdf", bytes: tinyPdf("SYN-PDF-0001 Synthetic renewal"), userId: USER });
  expect(pdf.mime).toBe("application/pdf");
  expect(pdf.storage_path).toMatch(/\.pdf$/);
  expect(pdf.content_text).toContain("SYN-PDF-0001");
  const md = await storeReportDocument({ accountId, filename: "report.md", bytes: Buffer.from("# Synthetic report\n\n| SYN-MD-0001 | Renewal |"), userId: USER });
  expect(md.mime).toBe("text/markdown");
  await expect(storeReportDocument({ accountId, filename: "r.xlsx", bytes: Buffer.from("x"), userId: USER })).rejects.toBeInstanceOf(UploadError);
});

it("maps a simple JSON export straight to proposals, with no model", async () => {
  const json = {
    deals: [
      { deal_id: "SYN-JSON-0001", name: "Synthetic data platform", stage: 2, close_date: "2027-01-15", tcv_usd: 50000 },
      { deal_id: "x", name: "Not a CRM id" },
    ],
    install_base: [{ product_family: "Synthetic storage", value_usd: 1000 }, { product_family: "TOTAL" }],
    plays: [{ title: "Synthetic expansion", deal_ids: ["SYN-JSON-0001", "SYN-NOPE-9999"] }],
  };
  const text = JSON.stringify(json, null, 2);
  const read = jsonExtraction(text, "Synthetic JSON Co")!;
  expect(read.extraction.deals.map((d) => d.deal_id)).toEqual(["SYN-JSON-0001"]);
  expect(read.dropped).toEqual(["deal x"]);
  expect(read.extraction.install_base.map((r) => r.product_family)).toEqual(["Synthetic storage"]);
  expect(read.extraction.plays[0]!.deal_ids).toEqual(["SYN-JSON-0001"]);
  expect(jsonExtraction('{"anything": 1}', "X")).toBeNull();
  expect(jsonExtraction("[1, 2]", "X")).toBeNull();

  const { accountId } = seedAccount({ name: "Synthetic JSON Co" });
  const doc = await storeReportDocument({ accountId, filename: "export.json", bytes: Buffer.from(text), userId: USER });
  const runId = startImportRun(doc, USER);
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  const result = JSON.parse(getRun(runId)!.result_json!);
  expect(result.attempts).toBe(0);
  const proposals = listPendingProposals(accountId);
  expect(proposals.some((p) => p.entity_type === "deal" && p.payload_json.includes("SYN-JSON-0001"))).toBe(true);
});

it("keeps a customer document as context: listed, wrapped for prompts, citable, never a run", async () => {
  const { accountId } = seedAccount({ name: "Synthetic Customer Doc Co" });
  const runsBefore = (db().prepare("SELECT COUNT(*) AS n FROM ai_runs").get() as { n: number }).n;
  const doc = await storeCustomerDocument({ accountId, filename: "their-plan.md", bytes: Buffer.from("# Synthetic county plan\n\nWe will consolidate three data centres by 2028."), userId: USER });
  expect((db().prepare("SELECT COUNT(*) AS n FROM ai_runs").get() as { n: number }).n).toBe(runsBefore);
  expect(listCustomerDocs(accountId).map((d) => d.id)).toEqual([doc.id]);
  // The same file as a report is a different thing to keep.
  const asReport = await storeReportDocument({ accountId, filename: "their-plan.md", bytes: Buffer.from("# Synthetic county plan\n\nWe will consolidate three data centres by 2028."), userId: USER });
  expect(asReport.id).not.toBe(doc.id);

  const block = customerDocsForPrompt(accountId);
  expect(block).toContain("<untrusted_source>");
  expect(block).toContain("consolidate three data centres");
  expect(block).toContain(doc.id);
  const pack = buildContextPack(accountId);
  expect(evidenceIndex(pack).get(doc.id)).toEqual({ kind: "document", label: "their-plan.md" });
  const r = briefEvidenceResolver(accountId).resolve({ kind: "document", id: doc.id });
  expect(r).toMatchObject({ status: "current", href: `/accounts/${accountId}/documents/${doc.id}` });

  const { default: DocPage } = await import("@/app/accounts/[id]/documents/[docId]/page");
  const page = parseHTML(renderToStaticMarkup(await DocPage({ params: Promise.resolve({ id: accountId, docId: doc.id }) }))).document;
  expect(page.querySelector('[data-testid="customer-doc-text"]')?.textContent).toContain("consolidate three data centres");
});
