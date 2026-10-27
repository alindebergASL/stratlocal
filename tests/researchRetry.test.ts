import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { finishRun, getRun, startRun } from "@/lib/ai/guard";
import { startResearchExtractionRetry } from "@/lib/research/run";
import { extractResearchNote } from "@/lib/research/extract";
import { runWebResearch } from "@/lib/ai/runWebResearch";
import { listNotes } from "@/lib/research/notes";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { POST } from "@/app/api/accounts/[id]/research/route";
import { seedAccount, USER } from "./helpers";

vi.mock("@/lib/research/extract", () => ({ extractResearchNote: vi.fn() }));
vi.mock("@/lib/ai/runWebResearch", async original => ({
  ...await original<typeof import("@/lib/ai/runWebResearch")>(),
  runWebResearch: vi.fn(() => { throw new Error("Web research forbidden during retry"); }),
}));
const report = { text: "A complete synthetic report.\nAn unselected detail survives.", sources: ["https://example.com/a", "https://example.com/b"] };
const note = { title: "Synthetic findings", summary: "Synthetic summary", findings: [{ text: "A complete synthetic report.", quote: "A complete synthetic report.", url: report.sources[0]!, confidence: "high" as const, date: null, topic: "strategy" as const }], open_questions: [] };
let accountId: string;
let session: string;
beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
  accountId = seedAccount().accountId;
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(USER, "test@example.com", "unused", "Test", 1, 1);
  session = createSession(USER).id;
  vi.mocked(extractResearchNote).mockReset().mockResolvedValue({ note, dropped: [], attempts: 1 });
  vi.mocked(runWebResearch).mockClear();
  return () => vi.unstubAllEnvs();
});
function source() {
  const run = startRun({ role: "research", accountId, userId: USER, inputSummary: JSON.stringify({ depth: "deep", focusQuestion: "Synthetic focus" }) });
  finishRun(run.id, { stages: [], error: "synthetic extraction failure", result: { documentId: null, report, searches: 8, fetches: 5 } });
  return getRun(run.id)!;
}
const retry = (retryRunId: string) => startResearchExtractionRetry({ accountId, userId: USER, retryRunId });
async function finished(id: string) {
  await vi.waitFor(() => expect(getRun(id)?.status).not.toBe("running"));
  return getRun(id)!;
}
function request(body: unknown, authenticated = true) {
  return POST(new NextRequest("http://localhost/api/accounts/test/research", { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { cookie: `${SESSION_COOKIE}=${session}` } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: accountId }) });
}

it("recovers only the saved report into an unaccepted draft, with immutable source and duplicate guard", async () => {
  const old = source();
  vi.mocked(extractResearchNote).mockImplementation(async (input) => {
    expect(input.prose).toBe(report.text);
    expect([...input.sources.values()]).toEqual(report.sources);
    const running = db().prepare("SELECT result_json FROM ai_runs WHERE status = 'running'").get() as { result_json: string };
    expect(JSON.parse(running.result_json)).toMatchObject({ report, retryRunId: old.id });
    return { note, dropped: [], attempts: 1 };
  });
  const id = retry(old.id);
  expect(() => retry(old.id)).toThrow(/running|progress/);
  const recovered = await finished(id);
  expect(recovered.status).toBe("done");
  expect(JSON.parse(recovered.input_summary!)).toMatchObject({ retryRunId: old.id });
  const draft = listNotes(accountId)[0]!;
  expect(draft.doc.status).toBe("draft");
  expect(draft.doc.content_text).toBe(report.text);
  expect(draft.meta.sources).toEqual(report.sources);
  expect(draft.meta.depth).toBe("deep");
  expect(getRun(old.id)).toEqual(old);
  expect(() => retry(old.id)).toThrow(/completed/);
  expect(runWebResearch).not.toHaveBeenCalled();
});

it("preserves both reports after retry failure and allows explicit retry from the original", async () => {
  const old = source();
  vi.mocked(extractResearchNote).mockRejectedValue(new Error("synthetic malformed JSON"));
  const failed = await finished(retry(old.id));
  expect(failed.status).toBe("failed");
  expect(JSON.parse(failed.result_json!)).toMatchObject({ report, retryRunId: old.id });
  expect(getRun(old.id)).toEqual(old);
  expect(listNotes(accountId)).toEqual([]);
  vi.mocked(extractResearchNote).mockResolvedValue({ note, dropped: [], attempts: 1 });
  expect((await finished(retry(old.id))).status).toBe("done");
  expect(runWebResearch).not.toHaveBeenCalled();
});

it("rejects wrong-account, wrong-kind, nonfailed, absent and invalid checkpoints before extraction", () => {
  const old = source();
  expect(() => startResearchExtractionRetry({ accountId: seedAccount({ dealId: "other" }).accountId, userId: USER, retryRunId: old.id })).toThrow(/for this account/);
  expect(() => retry("missing")).toThrow(/failed research/);
  for (const update of ["kind = 'import'", "kind = 'research', status = 'done'", "status = 'failed', result_json = 'null'", "result_json = '{\"documentId\":null,\"report\":{\"text\":\" \"},\"searches\":0,\"fetches\":0}'", "result_json = 'broken'"]) {
    db().prepare(`UPDATE ai_runs SET ${update} WHERE id = ?`).run(old.id);
    expect(() => retry(old.id)).toThrow();
  }
  expect(extractResearchNote).not.toHaveBeenCalled();
  expect(runWebResearch).not.toHaveBeenCalled();
});

it("enforces budget, active account and unrelated per-account exclusion", () => {
  const old = source();
  vi.stubEnv("AI_DAILY_CAP_CENTS", "0");
  expect(() => retry(old.id)).toThrow(/budget|cost/);
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
  const running = startRun({ role: "research", accountId, userId: USER });
  expect(() => retry(old.id)).toThrow(/progress/);
  finishRun(running.id, { stages: [] });
  db().prepare("UPDATE accounts SET archived_at = 1 WHERE id = ?").run(accountId);
  expect(() => retry(old.id)).toThrow(/archived/);
  expect(extractResearchNote).not.toHaveBeenCalled();
});

it("authenticates before starting and strictly discriminates retry payloads", async () => {
  const old = source();
  expect((await request({ retryRunId: old.id }, false)).status).toBe(401);
  for (const body of [{ retryRunId: old.id, focus: "must not research" }, { retryRunId: "invalid" }, { retryRunID: old.id }, null]) {
    expect((await request(body)).status).toBe(400);
  }
  expect(extractResearchNote).not.toHaveBeenCalled();
  const response = await request({ retryRunId: old.id });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect((await finished(result.runId)).status).toBe("done");
  expect(runWebResearch).not.toHaveBeenCalled();
});
