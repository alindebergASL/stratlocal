// SYNTHETIC ONLY: no Salesforce, web, or AI requests are made by preparation.
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { seedAccount, USER } from "./helpers";
import { prepareRequest, PackageManifest } from "@/lib/local/packages";
import { readZip } from "@/lib/local/zip";
import { preserveArtifact, linkArtifact } from "@/lib/local/evidence";
import { applyEntityChange } from "@/lib/proposals/apply";
import { POST } from "@/app/api/local/action/route";
import { GET } from "@/app/api/local/files/[id]/route";

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireUser: () => ({ id: USER }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function action(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/local/action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify(body),
    }),
  );
}

it("prepares intake for a fresh account without evidence, a question, or external calls", async () => {
  const { accountId } = seedAccount();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const before = db()
    .prepare("SELECT * FROM accounts WHERE id=?")
    .get(accountId);
  const response = await action({
    operation: "prepare_intake_request",
    accountId,
  });
  expect(response.status).toBe(200);
  const { href } = await response.json();
  const id = href.split("/").pop();
  const markdown = await GET(
    new NextRequest(`http://localhost/api/local/files/${id}?format=markdown`),
    { params: Promise.resolve({ id }) },
  );
  expect(markdown.status).toBe(200);
  expect(markdown.headers.get("content-type")).toContain("text/markdown");
  expect(markdown.headers.get("content-disposition")).toContain('.md"');
  const prompt = await markdown.text();
  expect(prompt).toContain(
    '"strategyLocalAccountName": "Synthetic Orchard Lab"',
  );
  expect(prompt).toContain("IsClosed=false");
  expect(prompt).toContain("## 3. Conduct web research");
  expect(prompt).toContain("### Meeting preparation");
  expect(prompt).toContain(
    "Standard Salesforce Amount is NOT automatically TCV",
  );
  expect(prompt).toContain("stage: OMIT");
  expect(prompt).toContain("Keep report.team empty");
  const zipResponse = await GET(
    new NextRequest(`http://localhost/api/local/files/${id}`),
    { params: Promise.resolve({ id }) },
  );
  const files = await readZip(Buffer.from(await zipResponse.arrayBuffer()));
  expect(files.get("request.md")?.toString()).toBe(prompt);
  const manifest = PackageManifest.parse(
    JSON.parse(files.get("manifest-template.json")!.toString()),
  );
  expect(manifest.request_id).toBe(id);
  expect(manifest.accounts[0]?.report.account).toEqual({
    name: "Synthetic Orchard Lab",
  });
  expect(manifest.artifacts.map((a) => a.path)).toEqual([
    "sources/salesforce-records.json",
    "sources/web-research.md",
    "sources/account-brief.md",
  ]);
  expect(fetch).not.toHaveBeenCalled();
  expect(
    db().prepare("SELECT * FROM accounts WHERE id=?").get(accountId),
  ).toEqual(before);
  expect(db().prepare("SELECT count(*) n FROM local_jobs").get()).toEqual({
    n: 0,
  });
});

it("uses saved identity and selected context, with optional website and focus", async () => {
  const { accountId } = seedAccount();
  applyEntityChange({
    accountId,
    entityType: "account",
    entityId: accountId,
    op: "update",
    payload: { crm_id: "SYN-CRM-42" },
    actorUserId: USER,
  });
  const original = await preserveArtifact(
    "synthetic.md",
    Buffer.from("Synthetic planning context"),
  );
  linkArtifact(original.id, accountId, USER);
  const request = await prepareRequest(
    accountId,
    "Prioritize procurement timelines",
    [original.id],
    USER,
    { website: "https://example.org" },
  );
  const files = await readZip(request.bytes);
  const manifest = JSON.parse(files.get("manifest-template.json")!.toString());
  expect(manifest.accounts[0].report.account).toEqual({
    name: "Synthetic Orchard Lab",
    crm_id: "SYN-CRM-42",
  });
  expect(request.prompt).toContain("https://example.org");
  expect(request.prompt).toContain("Prioritize procurement timelines");
  expect(
    [...files.keys()].filter((k) => k.startsWith("context/")),
  ).toHaveLength(1);
});

it("rejects invalid websites and another account's selected originals before saving", async () => {
  const a = seedAccount(),
    b = seedAccount({ name: "Synthetic Other", dealId: "SYN-DEAL-2" });
  const original = await preserveArtifact(
    "other.md",
    Buffer.from("Other synthetic account"),
  );
  linkArtifact(original.id, b.accountId, USER);
  await expect(
    prepareRequest(a.accountId, "", [original.id], USER, { website: "" }),
  ).rejects.toThrow(/does not belong/);
  for (const website of [
    "javascript:alert(1)",
    "example.org",
    "https://user:secret@example.org",
  ]) {
    const res = await action({
      operation: "prepare_intake_request",
      accountId: a.accountId,
      website,
    });
    expect(res.status).toBe(400);
  }
  expect(db().prepare("SELECT count(*) n FROM local_requests").get()).toEqual({
    n: 0,
  });
});

it("keeps Markdown downloads scoped to the request author", async () => {
  const { accountId } = seedAccount();
  const request = await prepareRequest(
    accountId,
    "",
    [],
    "another-synthetic-user",
    { website: "" },
  );
  const response = await GET(
    new NextRequest(
      `http://localhost/api/local/files/${request.id}?format=markdown`,
    ),
    { params: Promise.resolve({ id: request.id }) },
  );
  expect(response.status).toBe(404);
});

it("retains the ordinary research request contract", async () => {
  const { accountId } = seedAccount();
  await expect(prepareRequest(accountId, "", [], USER)).rejects.toThrow(
    /Enter a request/,
  );
  const request = await prepareRequest(
    accountId,
    "Research a specific follow-up",
    [],
    USER,
  );
  expect(request.prompt).toContain("Research a specific follow-up");
  expect(request.prompt).not.toContain("new account intake");
});
