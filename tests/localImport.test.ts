import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/lib/db";
import { POST } from "@/app/api/accounts/[id]/import/route";
import ImportPage from "@/app/accounts/[id]/import/page";
import { seedAccount, USER } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("notFound"); } }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireUser: () => ({ id: USER }),
  requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }),
}));
afterEach(() => vi.unstubAllEnvs());

async function upload(accountId: string, purpose: string) {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new File(["# Synthetic customer plan\nKeep this locally."], "plan.md", { type: "text/markdown" }));
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
  expect(page.querySelector('input[value="report"]')?.hasAttribute("disabled")).toBe(true);
  expect(page.querySelector('input[value="customer_doc"]')?.hasAttribute("checked")).toBe(true);
  expect(page.querySelector('[data-testid="import-submit"]')?.textContent).toBe("Upload and keep");
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
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("External AI is disabled") });
  expect(db().prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
  expect(db().prepare("SELECT COUNT(*) AS n FROM ai_runs").get()).toEqual({ n: 0 });
});
