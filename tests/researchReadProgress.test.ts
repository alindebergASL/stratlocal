// SYNTHETIC ONLY. Structured model transport is replaced; no provider calls.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as structured from "@/lib/ai/runStructured";
import { getRun } from "@/lib/ai/guard";
import { acceptNote, listNotes, storeDraftNote } from "@/lib/research/notes";
import { READ_BATCH, startResearchReads, unreadKept } from "@/lib/research/reads";
import { seedAccount, USER } from "./helpers";

beforeEach(() => { vi.stubEnv("AI_FAKE", "1"); vi.stubEnv("AI_DAILY_CAP_CENTS", "10000"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function seed(n: number) {
  const { accountId } = seedAccount();
  const findings = Array.from({ length: n }, (_, i) => ({ text: `Synthetic finding ${i}`, quote: `Synthetic source quote ${i}`, url: `https://example.test/${i}`, date: null, confidence: "medium" as const, topic: "strategy" as const }));
  const doc = storeDraftNote({ accountId, userId: USER, aiRunId: "synthetic", note: { title: "Synthetic research", summary: "Synthetic", findings, open_questions: [] }, prose: "Synthetic", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });
  acceptNote(doc.id, findings.map((_, i) => i), USER);
  return accountId;
}

it("advances beyond 120 including null classifications and finishes without repeating paid inputs", async () => {
  const accountId = seed(READ_BATCH + 3);
  const batches: string[][] = [];
  vi.spyOn(structured, "runStructured").mockImplementation(async (opts) => {
    const ids = (opts.fakeContext as { researchReads: { ids: string[] } }).researchReads.ids;
    batches.push(ids);
    const data = { reads: ids.map((id) => ({ id, signal: null, fits: [] })) };
    expect(opts.check?.(data as never)).toEqual([]);
    return { data, raw: "" } as never;
  });
  const first = startResearchReads(accountId, USER);
  await vi.waitFor(() => expect(getRun(first)?.status).toBe("done"));
  expect(unreadKept(accountId).map((p) => p.index)).toEqual([120, 121, 122]);
  expect(listNotes(accountId, "accepted")[0]!.meta.read_at).toBeUndefined();
  const second = startResearchReads(accountId, USER);
  await vi.waitFor(() => expect(getRun(second)?.status).toBe("done"));
  expect(batches.map((b) => b.length)).toEqual([120, 3]);
  expect(new Set(batches.flat()).size).toBe(123);
  expect(unreadKept(accountId)).toEqual([]);
  expect(listNotes(accountId, "accepted")[0]!.meta.read_at).toBeTruthy();
  expect(() => startResearchReads(accountId, USER)).toThrow(/already been read/);
});

it.each(["missing", "duplicate", "unknown"])("rejects %s model result coverage without consuming progress", async (mode) => {
  const accountId = seed(3);
  let problems: unknown[] = [];
  vi.spyOn(structured, "runStructured").mockImplementation(async (opts) => {
    const ids = (opts.fakeContext as { researchReads: { ids: string[] } }).researchReads.ids;
    const bad = mode === "missing" ? ids.slice(1) : mode === "duplicate" ? [ids[0]!, ids[0]!, ids[2]!] : [...ids, "unknown#0"];
    const data = { reads: bad.map((id) => ({ id, signal: null, fits: [] })) };
    problems = opts.check?.(data as never) ?? [];
    if (problems.length) throw new Error("Synthetic invalid coverage");
    return { data, raw: "" } as never;
  });
  const run = startResearchReads(accountId, USER);
  await vi.waitFor(() => expect(getRun(run)?.status).not.toBe("running"));
  expect(problems.length).toBeGreaterThan(0);
  expect(getRun(run)?.status).toBe("failed");
  expect(unreadKept(accountId)).toHaveLength(3);
  expect(listNotes(accountId, "accepted")[0]!.meta.read_at).toBeUndefined();
});
