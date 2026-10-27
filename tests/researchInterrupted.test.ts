// SYNTHETIC ONLY.
//
// A research run the server restarts under keeps what its finished turns
// found and its known usage, retains the hold for an unknown final bill, and
// can be turned into a draft without searching again.
import { beforeEach, expect, it, vi } from "vitest";
import { db, failOrphanedRuns } from "@/lib/db";
import { getRun, todaySpend, monthSpendByBucket } from "@/lib/ai/guard";
import { ROLES } from "@/lib/ai/models";
import { startResearchExtractionRetry, startResearchRun } from "@/lib/research/run";
import { extractResearchNote } from "@/lib/research/extract";
import { runWebResearch } from "@/lib/ai/runWebResearch";
import { listNotes } from "@/lib/research/notes";
import { seedAccount, USER } from "./helpers";

vi.mock("@/lib/research/extract", () => ({ extractResearchNote: vi.fn() }));
vi.mock("@/lib/ai/runWebResearch", async (original) => ({
  ...(await original<typeof import("@/lib/ai/runWebResearch")>()),
  runWebResearch: vi.fn(),
}));

const url = "https://example.com/synthetic-plan";
const note = { title: "Synthetic partial findings", summary: "Synthetic summary", findings: [{ text: "A synthetic finding from the first turn.", quote: "A synthetic finding from the first turn.", url, confidence: "high" as const, date: null, topic: "strategy" as const }], open_questions: [] };
let accountId: string;

beforeEach(() => {
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-test-key");
  accountId = seedAccount().accountId;
  vi.mocked(extractResearchNote).mockReset().mockResolvedValue({ note, dropped: [], attempts: 1 });
  // One finished turn, saved; then the process "dies": the promise never settles.
  vi.mocked(runWebResearch).mockReset().mockImplementation(async (_input, stages, onTurn) => {
    stages.push({ name: "web_research", provider: ROLES.research.provider, model: ROLES.research.model, usage: { input_tokens: 20000, output_tokens: 3000 } });
    onTurn?.({ text: "A synthetic finding from the first turn.", sources: new Map([[url, url]]), evidence: [], searches: 3, fetches: 1, turns: 1 });
    return new Promise(() => {});
  });
  return () => vi.unstubAllEnvs();
});

it("keeps completed turns without treating partial cost as final, and extracts without searching again", async () => {
  const runId = startResearchRun({ accountId, userId: USER, focus: null, depth: "standard" });
  await vi.waitFor(() => expect(JSON.parse(getRun(runId)!.result_json ?? "null")?.searches).toBe(3));

  failOrphanedRuns(db());

  const dead = getRun(runId)!;
  expect(dead.status).toBe("failed");
  expect(dead.error).toBe("process restarted");
  expect(dead.cost_cents).toBeNull();
  expect(JSON.parse(dead.usage_json!).partial_cost_cents).toBeGreaterThan(0);
  expect(todaySpend().unpriced).toBe(1);
  expect(todaySpend().held).toBeGreaterThan(0);
  expect(monthSpendByBucket().get(null)?.unpriced).toBe(1);
  expect(monthSpendByBucket().get(null)?.held).toBeGreaterThan(0);
  const saved = JSON.parse(dead.result_json!);
  expect(saved.report.capture).toEqual({ status: "partial", reasons: ["interrupted"] });

  vi.mocked(runWebResearch).mockClear();
  const retryId = startResearchExtractionRetry({ accountId, userId: USER, retryRunId: runId });
  await vi.waitFor(() => expect(getRun(retryId)?.status).toBe("done"));
  expect(runWebResearch).not.toHaveBeenCalled();
  const draft = listNotes(accountId, "draft")[0]!;
  expect(draft.meta.capture?.reasons).toContain("interrupted");
});
