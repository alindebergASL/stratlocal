import { beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { finishRun, getRun, startRun, todaySpend } from "@/lib/ai/guard";
import { runWebResearch } from "@/lib/ai/runWebResearch";
import { startResearchRun } from "@/lib/research/run";
import { extractResearchNote } from "@/lib/research/extract";
import { acceptNote, listNotes, researchForPrompt } from "@/lib/research/notes";
import { seedAccount, USER } from "./helpers";

vi.mock("@/lib/research/extract", () => ({ extractResearchNote: vi.fn() }));
vi.mock("@/lib/ai/runWebResearch", async (original) => ({
  ...await original<typeof import("@/lib/ai/runWebResearch")>(),
  runWebResearch: vi.fn(async (_input, stages) => {
    stages.push({ name: "web_research", provider: "direct", model: "claude-opus-4-6", usage: { input_tokens: 45000, output_tokens: 6000 } });
    return { text: "Full original report.\nAn unselected detail must survive.", sources: new Map([["a", "https://example.com/a"], ["b", "https://example.com/b"]]), searches: 8, fetches: 5, turns: 1, budgetExhausted: false };
  }),
}));
vi.mock("@/lib/ai/client", async (original) => ({
  ...await original<typeof import("@/lib/ai/client")>(),
  getDirectClient: () => { throw new Error("Transport forbidden in retention tests"); },
}));
const report = { text: "Full original report.\nAn unselected detail must survive.", sources: ["https://example.com/a", "https://example.com/b"] };
const note = { title: "Public signals", summary: "Summary only", findings: [{ text: "Full original report.", quote: "Full original report.", url: report.sources[0]!, confidence: "high" as const, date: null, topic: "strategy" as const }], open_questions: [] };
let accountId: string;
beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
  accountId = seedAccount().accountId;
  vi.mocked(extractResearchNote).mockReset();
  return () => vi.unstubAllEnvs();
});
const start = () => startResearchRun({ accountId, userId: USER, focus: null, depth: "deep" });
async function finished(id: string) {
  await vi.waitFor(() => expect(getRun(id)?.status).not.toBe("running"));
  return getRun(id)!;
}

it("checkpoints before extraction, retaining the unreviewed full report on extraction failure", async () => {
  vi.mocked(extractResearchNote).mockImplementation(async () => {
    const run = db().prepare("SELECT result_json FROM ai_runs WHERE account_id = ?").get(accountId) as { result_json: string };
    expect(JSON.parse(run.result_json)?.report).toEqual(report);
    throw new Error("extraction unavailable");
  });
  const run = await finished(start());
  expect(run.status).toBe("failed");
  expect(run.error).toContain("extraction unavailable");
  expect(JSON.parse(run.result_json!)?.report).toEqual(report);
  expect(run.cost_cents).toBeGreaterThan(0);
  expect(listNotes(accountId)).toEqual([]);
  expect(researchForPrompt(accountId)).toBe("");
});

it("retains report and all sources when no supported finding survives", async () => {
  vi.mocked(extractResearchNote).mockResolvedValue({ note: { ...note, findings: [] }, dropped: ["Unsupported"], attempts: 1 });
  const run = await finished(start());
  expect(run.status).toBe("done");
  expect(JSON.parse(run.result_json!)).toMatchObject({ documentId: null, findings: 0, report });
  expect(listNotes(accountId)).toEqual([]);
  expect(researchForPrompt(accountId)).toBe("");
});

it("keeps full prose and all sources in the draft and accepted document, without promoting the prose", async () => {
  vi.mocked(extractResearchNote).mockResolvedValue({ note, dropped: [], attempts: 1 });
  const run = await finished(start());
  const draft = listNotes(accountId)[0]!;
  expect(draft.doc.status).toBe("draft");
  expect(draft.doc.content_text).toBe(report.text);
  expect(draft.meta.sources).toEqual(report.sources);
  expect(researchForPrompt(accountId)).toBe("");
  acceptNote(draft.doc.id, [0], USER);
  expect(listNotes(accountId)[0]?.doc.content_text).toBe(report.text);
  expect(listNotes(accountId)[0]?.meta.sources).toEqual(report.sources);
  expect(researchForPrompt(accountId)).not.toContain("An unselected detail");
  expect(JSON.parse(run.result_json!).report).toBeUndefined();
  // Later failed extraction must never rewrite an accepted note.
  vi.mocked(extractResearchNote).mockRejectedValue(new Error("extraction unavailable"));
  await finished(start());
  expect(listNotes(accountId, "accepted")[0]?.doc).toEqual(listNotes(accountId)[0]?.doc);
  expect(listNotes(accountId, "accepted")[0]?.doc.content_text).toBe(report.text);
});

it("failed research with no received usage is unknown, but provider-check semantics stay unchanged", () => {
  const research = startRun({ role: "research", accountId, userId: USER });
  finishRun(research.id, { stages: [], error: "connection lost" });
  expect(getRun(research.id)?.cost_cents).toBeNull();
  expect(todaySpend().unpriced).toBe(1);
  const check = startRun({ role: "research", kind: "provider_check", accountId: null, userId: USER });
  finishRun(check.id, { stages: [], error: "not configured" });
  expect(getRun(check.id)?.cost_cents).toBe(0);
});

it("does not finish twice or erase a saved failed report on a later finish", async () => {
  vi.mocked(extractResearchNote).mockRejectedValue(new Error("extraction unavailable"));
  const run = await finished(start());
  expect(finishRun(run.id, { stages: [], result: null })).toBe(false);
  expect(getRun(run.id)).toEqual(run);
  expect(JSON.parse(run.result_json!).report).toEqual(report);
});

it("persists original evidence and partial capture state after successful extraction", async () => {
  const evidence=[{url:report.sources[0]!,text:"An actual source passage.",location:"Page 1"}];
  const capture={status:"partial" as const,reasons:["Output limit reached"]};
  vi.mocked(runWebResearch).mockResolvedValueOnce({text:report.text,sources:new Map(report.sources.map(x=>[x,x])),evidence,capture,searches:8,fetches:5,turns:1,budgetExhausted:false});
  vi.mocked(extractResearchNote).mockResolvedValue({note,dropped:[],attempts:1});
  const run=await finished(start());const draft=listNotes(accountId)[0]!;
  expect(draft.meta.report_evidence).toEqual(evidence);expect(draft.meta.capture).toEqual(capture);
  expect(JSON.parse(run.result_json!).coverage).toMatchObject({status:"partial",reasons:capture.reasons});
  expect(draft.doc.status).toBe("draft");expect(researchForPrompt(accountId)).toBe("");
});
