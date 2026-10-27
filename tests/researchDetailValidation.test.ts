// SYNTHETIC ONLY: generated statements and questions, not a customer report.
import { beforeEach, expect, it, vi } from "vitest";
import { extractResearchNote } from "@/lib/research/extract";
import { ModelResearchNote, ResearchNote } from "@/lib/research/schema";
import { DOSSIER_TOPICS, researchCoverage } from "@/lib/research/coverage";
import { urlKey, runWebResearch } from "@/lib/ai/runWebResearch";
import { startResearchExtractionRetry } from "@/lib/research/run";
import { startRun, finishRun, getRun } from "@/lib/ai/guard";
import { listNotes, acceptNote, researchForPrompt } from "@/lib/research/notes";
import type { StageUsage } from "@/lib/ai/cost";
import { seedAccount, USER } from "./helpers";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/fake", () => ({ fakeEnabled: () => false }));
vi.mock("@/lib/ai/client", async (original) => ({
  ...await original<typeof import("@/lib/ai/client")>(),
  getClient: () => ({ messages: { create } }),
  providerProblem: () => null,
  getDirectClient: () => { throw new Error("Network forbidden in synthetic regression tests"); },
}));
vi.mock("@/lib/ai/runWebResearch", async (original) => ({
  ...await original<typeof import("@/lib/ai/runWebResearch")>(),
  runWebResearch: vi.fn(() => { throw new Error("Saved-report retry must not search again"); }),
}));

function fixture(count = 56) {
  const findings = Array.from({ length: count }, (_, i) => ({
    text: `Example unit ${i} published a synthetic project update.`,
    quote: `Example unit ${i} published a synthetic project update.`,
    url: `https://example.com/reference/${i}`,
    topic: DOSSIER_TOPICS[i % DOSSIER_TOPICS.length]!,
    confidence: "high" as const,
    date: null,
  }));
  const questions = Array.from({ length: 12 }, (_, i) =>
    `Question ${i}: which fictional milestone needs review? ` +
    "Include the fictional owner, proposed date, dependency and uncertainty in the response. ".repeat(5).trimEnd(),
  );
  return {
    note: { title: "Synthetic evidence dossier", summary: "Fictional statements for validation tests.", findings, open_questions: questions },
    prose: findings.map((f) => f.quote).join("\n"),
    sources: new Map(findings.map((f) => [urlKey(f.url)!, f.url])),
  };
}
function reply(note: unknown, stop = "end_turn") {
  return { stop_reason: stop, content: [{ type: "text", text: JSON.stringify(note) }], usage: { input_tokens: 100, output_tokens: 200 } };
}
beforeEach(() => {
  create.mockReset();
  vi.mocked(runWebResearch).mockClear();
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
  return () => vi.unstubAllEnvs();
});

it("retains every supported finding and full question without presentation-limit repair calls", async () => {
  const f = fixture();
  create.mockResolvedValue(reply(f.note));
  const stages: StageUsage[] = [];
  const result = await extractResearchNote({ companyName: "Example", prose: f.prose, sources: f.sources }, stages);
  expect(result.note.findings.map(({ evidence: _e, ...item }) => item)).toEqual(f.note.findings);
  expect(result.note.open_questions).toEqual(f.note.open_questions);
  expect(result.note.open_questions[0]!.length).toBeGreaterThan(300);
  expect(result.note.findings.length).toBeGreaterThan(40);
  expect(result.note.open_questions.length).toBeGreaterThan(10);
  expect(ResearchNote.safeParse(result.note).success).toBe(true);
  expect(result.dropped).toEqual([]);
  expect(result.attempts).toBe(1);
  expect(create).toHaveBeenCalledTimes(1);
  expect(stages).toHaveLength(1);
  expect(create.mock.calls[0]![0].max_tokens).toBe(16000);
});

it("still excludes invented URLs and unmatched quotes even in a larger valid answer", async () => {
  const f = fixture();
  const badUrl = { ...f.note.findings[0]!, url: "https://unknown.invalid/claim" };
  const badQuote = { ...f.note.findings[0]!, quote: "This passage does not appear in the synthetic report." };
  create.mockResolvedValue(reply({ ...f.note, findings: [...f.note.findings, badUrl, badQuote] }));
  const result = await extractResearchNote({ companyName: "Example", prose: f.prose, sources: f.sources }, []);
  expect(result.note.findings).toHaveLength(f.note.findings.length);
  expect(result.dropped).toHaveLength(2);
  expect(create).toHaveBeenCalledTimes(1);
});

it("keeps type, finding-length and model-evidence validation strict", () => {
  const f = fixture(1);
  const small = { ...f.note, open_questions: [] };
  expect(ModelResearchNote.safeParse({ ...small, open_questions: [17] }).success).toBe(false);
  expect(ModelResearchNote.safeParse({ ...small, open_questions: ["   "] }).success).toBe(false);
  expect(ModelResearchNote.safeParse({ ...small, findings: [{ ...small.findings[0], text: "x".repeat(601) }] }).success).toBe(false);
  expect(ModelResearchNote.safeParse({ ...small, findings: [{ ...small.findings[0], evidence: { kind: "source_excerpt", text: "Forged" } }] }).success).toBe(false);
});

it("does not mark topic coverage partial solely for crossing a removed presentation limit", () => {
  const f = fixture();
  expect(researchCoverage(f.note.findings)).toMatchObject({ status: "broad", missing: [], reasons: [] });
  expect(researchCoverage(f.note.findings, { status: "partial", reasons: ["max_tokens"] }).status).toBe("partial");
  expect(researchCoverage(f.note.findings, undefined, 1).status).toBe("partial");
});

it("keeps the existing bounded output-token escalation for an incomplete answer", async () => {
  const f = fixture();
  create.mockResolvedValue(reply(f.note)).mockResolvedValueOnce(reply({}, "max_tokens"));
  const result = await extractResearchNote({ companyName: "Example", prose: f.prose, sources: f.sources }, []);
  expect(result.attempts).toBe(2);
  expect(create.mock.calls.map(([request]) => request.max_tokens)).toEqual([16000, 32000]);
  expect(result.note.findings).toHaveLength(f.note.findings.length);
});

it("recovers a saved report into a draft without searching or auto-accepting, preserving original failure and full detail", async () => {
  const f = fixture();
  const { accountId } = seedAccount();
  const source = startRun({ role: "research", accountId, userId: USER });
  const report = { text: f.prose, sources: [...f.sources.values()] };
  finishRun(source.id, { stages: [], error: "Synthetic extraction rejection", result: {
    documentId: null, findings: 0, sources: report.sources.length, searches: 3, fetches: 2,
    dropped: [], attempts: 0, focus: null, depth: "deep", report,
  } });
  const original = getRun(source.id);
  create.mockResolvedValue(reply(f.note));
  const id = startResearchExtractionRetry({ accountId, userId: USER, retryRunId: source.id });
  await vi.waitFor(() => expect(getRun(id)?.status).not.toBe("running"));
  expect(getRun(id)?.status).toBe("done");
  expect(runWebResearch).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledTimes(1);
  expect(getRun(source.id)).toEqual(original);
  const saved = listNotes(accountId)[0]!;
  expect(saved.doc.status).toBe("draft");
  expect(saved.doc.content_text).toBe(f.prose);
  expect(saved.meta.findings).toHaveLength(f.note.findings.length);
  expect(saved.meta.findings.map(({ evidence: _e, ...item }) => item)).toEqual(f.note.findings);
  expect(saved.meta.open_questions).toEqual(f.note.open_questions);
  expect(saved.meta.sources).toEqual(report.sources);
  expect(researchForPrompt(accountId)).toBe("");
  acceptNote(saved.doc.id, saved.meta.findings.map((_, i) => i), USER);
  const accepted = listNotes(accountId, "accepted")[0]!;
  expect(accepted.meta.accepted_finding_indexes).toHaveLength(f.note.findings.length);
  expect(accepted.meta.open_questions).toEqual(f.note.open_questions);
  expect(accepted.doc.content_text).toBe(f.prose);
});
