import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/lib/db";
import { POST } from "@/app/api/accounts/[id]/import/route";
import ImportPage from "@/app/accounts/[id]/import/page";
import { seedAccount, USER } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("notFound"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireUser: () => ({ id: USER }),
  requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }),
}));
afterEach(() => vi.unstubAllEnvs());

it("shows intentional local-only setup instead of cloud connection requirements", async () => {
  vi.stubEnv("STRATEGY_LOCAL_ONLY", "1");
  const { default: SetupPage } = await import("@/app/setup/page");
  const html = renderToStaticMarkup(await SetupPage());
  expect(html).toContain("Local only — cloud AI off");
  expect(html).not.toContain("Check providers");
  expect(html).not.toContain("BACKUP_S3_URI is not set");
  expect(html).not.toContain("Price for bedrock");
});

async function upload(accountId: string, purpose: string, file = new File(["# Synthetic customer plan\nKeep this locally."], "plan.md", { type: "text/markdown" })) {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", file);
  const encoded = new Response(form);
  const bytes = await encoded.arrayBuffer();
  return POST(new NextRequest(`http://localhost/api/accounts/${accountId}/import`, {
    method: "POST", body: bytes,
    headers: { "content-type": encoded.headers.get("content-type")!, "content-length": String(bytes.byteLength) },
  }), { params: Promise.resolve({ id: accountId }) });
}

it("keeps customer uploads available in local mode and does not start AI or create proposals", async () => {
  vi.stubEnv("STRATEGY_LOCAL_ONLY", "1");
  const { accountId } = seedAccount();
  const page = parseHTML(renderToStaticMarkup(await ImportPage({ params: Promise.resolve({ id: accountId }) }))).document;
  expect(page.querySelector('input[value="report"]')?.hasAttribute("disabled")).toBe(false);
  expect(page.querySelector('input[value="customer_doc"]')).not.toBeNull();
  expect(page.querySelector('[data-testid="import-submit"]')?.textContent).toBe("Import for review");
  const response = await upload(accountId, "customer_doc");
  expect(response.status).toBe(200);
  const { documentId } = await response.json();
  expect(db().prepare("SELECT content_text FROM documents WHERE id = ?").get(documentId)).toMatchObject({ content_text: expect.stringContaining("Keep this locally") });
  expect(db().prepare("SELECT COUNT(*) AS n FROM ai_runs").get()).toEqual({ n: 0 });
  expect(db().prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
});

it("refuses report extraction before storing a file when local AI is unavailable", async () => {
  vi.stubEnv("STRATEGY_LOCAL_ONLY", "1");
  const { accountId } = seedAccount();
  const response = await upload(accountId, "report");
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("structured JSON") });
  expect(db().prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
  expect(db().prepare("SELECT COUNT(*) AS n FROM ai_runs").get()).toEqual({ n: 0 });
});


const report = (name = "Synthetic Orchard Lab") => new File([JSON.stringify({
  account: { name },
  deals: [{ deal_id: "SYN-MYAGENT-001", name: "Synthetic expansion", stage: 2, tcv_usd: 1000 }],
})], "myagent.json", { type: "application/json" });

it("imports MyAgent JSON for review with cloud AI off and zero budget, without a model run", async () => {
  vi.stubEnv("STRATEGY_LOCAL_ONLY", undefined); // Production default.
  vi.stubEnv("AI_DAILY_CAP_CENTS", "0");
  const { accountId } = seedAccount();
  const response = await upload(accountId, "report", report());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result).toMatchObject({ attempts: 0, proposals: 1 });
  expect(body.runId).toBeUndefined();
  expect(db().prepare("SELECT COUNT(*) AS n FROM ai_runs").get()).toEqual({ n: 0 });
  expect(db().prepare("SELECT 1 FROM deals WHERE deal_id = 'SYN-MYAGENT-001'").get()).toBeUndefined();
  expect(db().prepare("SELECT status, ai_run_id FROM proposals").get()).toEqual({ status: "pending", ai_run_id: null });
  expect((await upload(accountId, "report", report())).status).toBe(200);
  expect(db().prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 1 });
  expect(db().prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 1 });
});

it("blocks conflicting local JSON and preserves the original without proposing changes", async () => {
  vi.stubEnv("STRATEGY_LOCAL_ONLY", "1");
  const { accountId } = seedAccount();
  const response = await upload(accountId, "report", report("Synthetic Other County"));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("Account identity conflict") });
  expect(db().prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  expect(db().prepare("SELECT COUNT(*) AS n FROM ai_runs").get()).toEqual({ n: 0 });
  expect(db().prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 1 });
});

it("rejects unidentified JSON instead of assigning it to the selected account", async () => {
  vi.stubEnv("STRATEGY_LOCAL_ONLY", "1");
  const { accountId } = seedAccount();
  const file = new File([JSON.stringify({ deals: [{ deal_id: "SYN-001", name: "Unknown owner" }] })], "unknown.json");
  const response = await upload(accountId, "report", file);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("account.name") });
  expect(db().prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
});
