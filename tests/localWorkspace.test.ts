// SYNTHETIC ONLY. Local workflows must work with no provider credentials.
import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { seedAccount, USER, tinyPdf } from "./helpers";
import {
  stagePackage,
  parsePackage,
  resolveAccount,
  proposePackage,
  prepareRequest,
} from "@/lib/local/packages";
import {
  preserveArtifact,
  linkArtifact,
  extractEvidence,
} from "@/lib/local/evidence";
import { readZip, safeArchivePath } from "@/lib/local/zip";
import {
  enqueue,
  claim,
  heartbeat,
  assertLease,
  finish,
  cancel,
} from "@/lib/local/queue";
import { job, packageRow, saveLocalSettings } from "@/lib/local/store";
import {
  buildModelContext,
  stageDraftPreview,
  confirmDraft,
  runDraft,
} from "@/lib/local/models";
import { processNext, scanExchange } from "@/lib/local/worker";
import { sameOrigin, boundedBody } from "@/lib/local/http";
import { applyEntityChange } from "@/lib/proposals/apply";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function bundle(
  report: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify({
      version: 1,
      as_of: "2026-01-01",
      artifacts: [
        {
          path: "sources/notes.md",
          audience: "internal",
          author_labels: ["R", "I"],
        },
      ],
      accounts: [
        {
          key: "one",
          report,
          sources: [
            {
              path: "sources/notes.md",
              locator: "section:1",
              quote: "Synthetic evidence",
            },
          ],
        },
      ],
      ...extra,
    }),
  );
  zip.file("sources/notes.md", "# Meeting\nSynthetic evidence");
  return zip.generateAsync({ type: "nodebuffer" });
}
const count = (table: string) =>
  (db().prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
it("preserves originals and creates review proposals without changing the account", async () => {
  const a = seedAccount();
  const bytes = await bundle({
    account: { name: "Synthetic Orchard Lab" },
    plays: [{ title: "Synthetic proposed play", thesis: "Check demand" }],
  });
  const p = stagePackage("report.zip", bytes, USER);
  expect(stagePackage("report.zip", bytes, USER).id).toBe(p.id);
  await parsePackage(p.id, null);
  expect(packageRow(p.id)?.state).toBe("review");
  expect(count("local_artifacts")).toBe(2);
  resolveAccount(p.id, "one", a.accountId, false, USER);
  const result = proposePackage(p.id, USER);
  expect(result.proposals).toBeGreaterThan(0);
  expect(count("plays")).toBe(1);
  expect(count("local_artifact_links")).toBe(1);
  const l = db()
    .prepare("SELECT audience,author_labels_json FROM local_artifact_links")
    .get();
  expect(l).toEqual({ audience: "internal", author_labels_json: '["R","I"]' });
  expect(proposePackage(p.id, USER).proposals).toBe(0);
});
it("rejects copied CRM identifiers even with an explicitly approved alias", async () => {
  const a = seedAccount({ name: "Synthetic WaTech" }),
    b = seedAccount({ name: "Synthetic King County", dealId: "SYN-DEAL-200" });
  applyEntityChange({
    accountId: b.accountId,
    entityType: "account",
    entityId: b.accountId,
    op: "update",
    payload: { crm_id: "SYN-COUNTY-ID" },
    actorUserId: USER,
  });
  const p = stagePackage(
    "conflict.zip",
    await bundle({
      account: { name: "Synthetic WaTech", crm_id: "SYN-COUNTY-ID" },
      team: [],
    }),
    USER,
  );
  await parsePackage(p.id, null);
  expect(() => resolveAccount(p.id, "one", a.accountId, true, USER)).toThrow(
    /already assigned/,
  );
  expect(() => proposePackage(p.id, USER)).toThrow(/already assigned/);
  expect(count("local_artifact_links")).toBe(0);
});
it("requires an explicit alias for different names", async () => {
  const a = seedAccount();
  const p = stagePackage(
    "alias.zip",
    await bundle({
      account: { name: "Synthetic Orchard Laboratory" },
      team: [],
    }),
    USER,
  );
  await parsePackage(p.id, null);
  expect(() => resolveAccount(p.id, "one", a.accountId, false, USER)).toThrow(
    /identity conflict/,
  );
  resolveAccount(p.id, "one", a.accountId, true, USER);
  expect(count("local_aliases")).toBe(1);
});
it("keeps metric measures and territory scope separate and reports inconsistent counts", async () => {
  const a = seedAccount();
  const p = stagePackage(
    "territory.zip",
    await bundle(
      { account: { name: "Synthetic Orchard Lab" }, team: [] },
      {
        territory: {
          name: "Synthetic West",
          account_keys: ["one"],
          reported_member_count: 2,
        },
        metrics: ["wallet", "pipeline", "bookings", "installed_base"].map(
          (measure, i) => ({
            key: measure,
            ...(i ? { account_key: "one" } : {}),
            measure,
            value: 10,
            unit: "USD",
            period_start: "2025-01-01",
            period_end: "2025-12-31",
            definition: `Synthetic ${measure}`,
            source: { path: "sources/notes.md", locator: "section:1" },
          }),
        ),
      },
    ),
    USER,
  );
  await parsePackage(p.id, null);
  expect(packageRow(p.id)?.warnings_json).toContain(
    "reports 2 members but lists 1",
  );
  resolveAccount(p.id, "one", a.accountId, false, USER);
  proposePackage(p.id, USER);
  expect(count("local_metrics")).toBe(4);
  expect(
    db()
      .prepare("SELECT count(*) n FROM local_metrics WHERE status='pending'")
      .get(),
  ).toEqual({ n: 4 });
  expect(
    db()
      .prepare(
        "SELECT count(*) n FROM local_metrics WHERE account_id IS NULL AND territory_id IS NOT NULL",
      )
      .get(),
  ).toEqual({ n: 1 });
});
it("rejects bad source quotations and missing originals", async () => {
  seedAccount();
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify({
      version: 1,
      as_of: "2026-01-01",
      accounts: [],
      artifacts: [{ path: "missing.md" }],
    }),
  );
  const p = stagePackage(
    "missing.zip",
    await zip.generateAsync({ type: "nodebuffer" }),
    USER,
  );
  await expect(parsePackage(p.id, null)).rejects.toThrow(/Missing original/);
});
it("extracts PDF pages, Markdown sections and strips active HTML content", async () => {
  const pdf = await extractEvidence(
    "brief.pdf",
    tinyPdf("Synthetic meeting text"),
  );
  expect(pdf.segments[0]).toMatchObject({
    locator: "page:1",
    text: expect.stringContaining("Synthetic"),
  });
  const html = await extractEvidence(
    "console.html",
    Buffer.from(
      "<h1>Internal Account Strategy</h1><script>doBadThing()</script><p>Evidence</p>",
    ),
  );
  expect(JSON.stringify(html)).not.toContain("doBadThing");
  expect(html.segments[0]?.label).toContain("Internal");
});
it("preserves presentation order and speaker notes with slide citations", async () => {
  const z = new JSZip();
  z.file(
    "ppt/presentation.xml",
    '<p:presentation><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
  );
  z.file(
    "ppt/_rels/presentation.xml.rels",
    '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
  );
  z.file("ppt/slides/slide1.xml", "<p:sld><a:t>Second slide</a:t></p:sld>");
  z.file("ppt/slides/slide2.xml", "<p:sld><a:t>First slide</a:t></p:sld>");
  z.file(
    "ppt/slides/_rels/slide2.xml.rels",
    '<Relationships><Relationship Type="http://example/notesSlide" Target="../notesSlides/notesSlide2.xml"/></Relationships>',
  );
  z.file(
    "ppt/notesSlides/notesSlide2.xml",
    "<p:notes><a:t>Speaker preparation</a:t></p:notes>",
  );
  const r = await extractEvidence(
    "prep.pptx",
    await z.generateAsync({ type: "nodebuffer" }),
  );
  expect(r.segments).toEqual([
    { locator: "slide:1", label: "Slide 1", text: "First slide" },
    {
      locator: "slide:1:notes",
      label: "Slide 1 speaker notes",
      text: "Speaker preparation",
    },
    { locator: "slide:2", label: "Slide 2", text: "Second slide" },
  ]);
});
it("rejects traversal, symlinks and excessive archive entries", async () => {
  for (const p of ["../file", "/abs", "C:/bad", "a/../b", "a\\b"])
    expect(() => safeArchivePath(p)).toThrow();
  const z = new JSZip();
  z.file("link", "target", { unixPermissions: 0o120777 });
  await expect(
    readZip(await z.generateAsync({ type: "nodebuffer", platform: "UNIX" })),
  ).rejects.toThrow(/symlinks/);
  const many = new JSZip();
  for (let i = 0; i < 501; i++) many.file(`f${i}`, "x");
  await expect(
    readZip(await many.generateAsync({ type: "nodebuffer" })),
  ).rejects.toThrow(/500/);
});
it("makes request packages without invoking a model or sending anything", async () => {
  const a = seedAccount();
  const source = await preserveArtifact(
    "notes.md",
    Buffer.from("# Evidence\nSynthetic evidence"),
  );
  linkArtifact(source.id, a.accountId, USER);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const result = await prepareRequest(
    a.accountId,
    "Research next meeting",
    [source.id],
    USER,
  );
  const entries = await readZip(result.bytes);
  expect(entries.has("request.md")).toBe(true);
  expect(result.prompt).toContain("Do not send messages");
  expect(fetch).not.toHaveBeenCalled();
  expect(count("local_requests")).toBe(1);
});
it("only includes selected account evidence, with visible context omissions", async () => {
  const a = seedAccount(),
    b = seedAccount({ name: "Synthetic Other", dealId: "SYN-DEAL-300" });
  const source = await preserveArtifact(
    "large.md",
    Buffer.from("# Evidence\n" + "x".repeat(10000)),
  );
  linkArtifact(source.id, a.accountId, USER);
  expect(() =>
    buildModelContext(b.accountId, "summary", [source.id], null, ""),
  ).toThrow(/does not belong/);
  const context = buildModelContext(
    a.accountId,
    "summary",
    [source.id],
    null,
    "",
  );
  expect(context.omissions.length).toBeGreaterThan(0);
  expect(context.sources[0]?.text.length).toBeLessThanOrEqual(3000);
  expect(() =>
    buildModelContext(a.accountId, "meeting_brief", [source.id], null, ""),
  ).toThrow(/Select the meeting/);
});
it("requires enabled policy and explicit per-task external approval", async () => {
  const a = seedAccount();
  const source = await preserveArtifact(
    "notes.md",
    Buffer.from("Synthetic evidence"),
  );
  linkArtifact(source.id, a.accountId, USER);
  const context = buildModelContext(
    a.accountId,
    "summary",
    [source.id],
    null,
    "",
  );
  const preview = stageDraftPreview(
    { provider: "bedrock", model: "test", context, externalApproved: false },
    USER,
  );
  expect(() => confirmDraft(preview, USER, true)).toThrow(/Enable external AI/);
  saveLocalSettings({ externalEnabled: true }, USER);
  expect(() => confirmDraft(preview, USER, false)).toThrow(
    /explicitly approve/,
  );
  const j = confirmDraft(preview, USER, true);
  expect(confirmDraft(preview, USER, true).id).toBe(j.id);
  saveLocalSettings({}, USER);
  expect(job(j.id)?.cancel_requested).toBe(1);
});
it("fails a local model task visibly and never falls back to a cloud provider", async () => {
  const a = seedAccount();
  const source = await preserveArtifact(
    "notes.md",
    Buffer.from("Synthetic evidence"),
  );
  linkArtifact(source.id, a.accountId, USER);
  const input = {
    provider: "ollama" as const,
    model: "missing",
    context: buildModelContext(a.accountId, "summary", [source.id], null, ""),
    externalApproved: false,
  };
  vi.stubEnv("MODEL_BRIDGE_TOKEN", "a".repeat(32));
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: "Model unavailable" }), {
      status: 503,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const j = enqueue("draft", "synthetic:local", input, USER);
  await processNext();
  expect(job(j.id)?.status).toBe("failed");
  expect(count("local_drafts")).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]![1].body).provider).toBe("ollama");
});
it("rejects invented citation keys without saving model output", async () => {
  const a = seedAccount();
  const source = await preserveArtifact(
    "notes.md",
    Buffer.from("Synthetic evidence"),
  );
  linkArtifact(source.id, a.accountId, USER);
  const input = {
    provider: "ollama" as const,
    model: "test",
    context: buildModelContext(a.accountId, "summary", [source.id], null, ""),
    externalApproved: false,
  };
  vi.stubEnv("MODEL_BRIDGE_TOKEN", "a".repeat(32));
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ text: "Made-up claim [S99]", model: "test" }),
        ),
      ),
  );
  const j = enqueue("draft", "bad-cite", input, USER);
  await expect(
    runDraft(j.id, USER, input, new AbortController().signal, () => {}),
  ).rejects.toThrow(/valid source citations/);
  expect(count("local_drafts")).toBe(0);
});
it("recovers expired tasks and fences stale workers", () => {
  const j = enqueue("import", "queue:one", { packageId: "fake" }, USER),
    now = Date.now();
  expect(claim("old", now)?.id).toBe(j.id);
  expect(claim("other", now)).toBeNull();
  expect(claim("new", now + 60001)?.id).toBe(j.id);
  expect(() => heartbeat(j.id, "old")).toThrow(/lease lost/);
  expect(() => assertLease(j.id, "old")).toThrow();
  finish(j.id, "old", { bad: true });
  expect(job(j.id)?.status).toBe("running");
  finish(j.id, "new", { good: true });
  expect(job(j.id)?.status).toBe("done");
});
it("cancels queued tasks and bounds repeated recovery", () => {
  const j = enqueue("draft", "cancel", {}, USER);
  cancel(j.id, USER);
  expect(claim("worker")).toBeNull();
  expect(job(j.id)?.status).toBe("cancelled");
  const k = enqueue("draft", "retry", {}, USER),
    now = Date.now();
  claim("1", now);
  claim("2", now + 60001);
  claim("3", now + 120002);
  expect(claim("4", now + 180003)).toBeNull();
  expect(job(k.id)?.status).toBe("failed");
});
it("rejects cross-site mutations and oversized streaming requests", async () => {
  expect(() =>
    sameOrigin(
      new Request("http://localhost/api/local/action", {
        headers: { origin: "https://outside.example" },
      }),
    ),
  ).toThrow();
  await expect(
    boundedBody(
      new Request("http://localhost", { method: "POST", body: "12345" }),
      4,
    ),
  ).rejects.toThrow(/size limit/);
});
it("watches stable files once and leaves failed imports in Incoming", async () => {
  seedAccount();
  db()
    .prepare(
      "INSERT OR IGNORE INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run(USER, "synthetic@example.test", "fake", "Synthetic", 1, 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-exchange-"));
  vi.stubEnv("STRATEGY_EXCHANGE_DIR", dir);
  saveLocalSettings({ watchEnabled: true }, USER);
  try {
    scanExchange(100);
    fs.writeFileSync(path.join(dir, "Incoming", "bad.zip"), "invalid");
    scanExchange(200);
    scanExchange(5201);
    expect(count("local_packages")).toBe(1);
    await processNext();
    scanExchange(6000);
    expect(fs.existsSync(path.join(dir, "Incoming", "bad.zip"))).toBe(true);
    expect(count("local_packages")).toBe(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("accepts same-origin requests when Next normalizes the URL hostname", () => {
  expect(() =>
    sameOrigin(
      new Request("http://localhost:3000/api/local/action", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
  ).not.toThrow();
});
it("classifies explicit internal content and preserves author labels regardless of filename", async () => {
  const a = seedAccount();
  const source = await preserveArtifact(
    "Executive Briefing.md",
    Buffer.from("# Internal Account Strategy\n[R] Research\n[I] Inference"),
  );
  linkArtifact(source.id, a.accountId, USER, "", "customer");
  expect(
    db()
      .prepare("SELECT audience,author_labels_json FROM local_artifact_links")
      .get(),
  ).toEqual({ audience: "internal", author_labels_json: '["R","I"]' });
});
