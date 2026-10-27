// SYNTHETIC ONLY.
//
// The research page as a seller's brief: what we know by topic across every
// note, why now, where we fit, what changed — and the fixes on the way.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { acceptNote, storeDraftNote } from "@/lib/research/notes";
import type { ResearchFinding, Topic as ResearchTopic } from "@/lib/research/schema";
import { USER } from "./helpers";

beforeEach(() => vi.stubEnv("AI_FAKE", "1"));
afterEach(() => vi.unstubAllEnvs());

export const finding = (topic: ResearchTopic, n: number, over: Partial<ResearchFinding> = {}): ResearchFinding => ({
  topic,
  text: `Synthetic finding ${n} about ${topic}, written long enough to read like one.`,
  quote: `Synthetic quoted passage number ${n} from the source page.`,
  url: `https://www.example.com/source/${topic}/${n}`,
  confidence: "high",
  date: null,
  ...over,
});

export function account(name = "Synthetic Research Co") {
  return applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name }, actorUserId: USER }).entityId;
}

export function kept(accountId: string, title: string, findings: ResearchFinding[], generatedAt?: string) {
  const doc = storeDraftNote({
    accountId,
    userId: USER,
    aiRunId: "synthetic",
    note: { title, summary: "", open_questions: [], findings },
    prose: "Original",
    focus: null,
    depth: "standard",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
  if (generatedAt) {
    const meta = JSON.parse((db().prepare("SELECT meta_json FROM documents WHERE id = ?").get(doc.id) as { meta_json: string }).meta_json);
    meta.generated_at = generatedAt;
    db().prepare("UPDATE documents SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), doc.id);
  }
  acceptNote(doc.id, findings.map((_, i) => i), USER);
  return doc.id;
}

describe("fixes", () => {
  it("an account with more than ten kept notes can still be researched without sending their titles", async () => {
    const id = account();
    for (let i = 1; i <= 11; i++) kept(id, `Synthetic note ${String(i).padStart(2, "0")}`, [finding("strategy", i)], `2026-0${Math.min(9, Math.ceil(i / 2))}-${String(10 + i).padStart(2, "0")}`);
    const { startResearchRun } = await import("@/lib/research/run");
    const runId = startResearchRun({ accountId: id, userId: USER, focus: null, depth: "standard" });
    const sent = JSON.parse((db().prepare("SELECT input_summary FROM ai_runs WHERE id = ?").get(runId) as { input_summary: string }).input_summary);
    expect(sent.avoidTitles).toEqual([]);
    expect(JSON.stringify(sent)).not.toContain("Synthetic note");
    const { getRun } = await import("@/lib/ai/guard");
    await vi.waitFor(() => expect(getRun(runId)?.status).toBe("done"));
  });
});
