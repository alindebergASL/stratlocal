// SYNTHETIC ONLY.
//
// The team's own direction: what it sells, what it is after, what matters,
// what to steer away from. Briefs and plan drafts read all of it; web
// research and Account watch read only the focus areas, because they run on
// the direct Anthropic API (DECISIONS #3). Nothing written there is a fact
// about a customer, and with nothing written every prompt is as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { currentDirection, directionForPrompt, directionHistory, focusForResearch, saveDirection, withDirection } from "@/lib/teamDirection";
import { userMessage, WebResearchInput } from "@/lib/ai/runWebResearch";
import { seedAccount, USER, type Seed } from "./helpers";

const captured: Array<{ role: string; system: string }> = [];
vi.mock("@/lib/ai/runStructured", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/runStructured")>();
  return {
    ...real,
    runStructured: vi.fn(async (args: { role: string; system: string }) => {
      captured.push({ role: args.role, system: args.system });
      throw new Error("captured");
    }),
  };
});
import { generateBrief } from "@/lib/meetings/brief";
import { generatePlanDraft } from "@/lib/plan/draft";
import { buildContextPack, evidenceIds } from "@/lib/meetings/contextPack";

let seed: Seed;
beforeEach(() => {
  seed = seedAccount();
  captured.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

const GOAL = "Land three agent-platform pilots this half";
const write = (over: Partial<Parameters<typeof saveDirection>[0]> = {}) =>
  saveDirection({
    focusAreas: ["AI agents", "AI systems", "AI security", "Observability"],
    goals: GOAL,
    signals: "A named AI programme with a budget",
    avoid: "Pure hardware refreshes",
    userId: USER,
    basisId: currentDirection()?.id ?? null,
    ...over,
  });

describe("writing the direction", () => {
  it("keeps every version, newest first, with who wrote it", () => {
    const first = write();
    const second = write({ goals: "Two pilots and one production rollout" });
    expect(currentDirection()?.id).toBe(second.id);
    expect(directionHistory().map((d) => d.id)).toEqual([second.id, first.id]);
    expect(currentDirection()?.createdBy).toBe(USER);
  });

  it("refuses a save from a page opened before the other of you saved", () => {
    const first = write();
    write({ goals: "Changed by the other one" });
    expect(() => write({ basisId: first.id, goals: "From the stale page" })).toThrow(/changed since this page was opened/);
    expect(currentDirection()?.goals).toBe("Changed by the other one");
  });

  it("tidies focus areas and refuses ones too long, too many, or carrying an address", () => {
    expect(write({ focusAreas: ["  AI   agents ", "ai agents", "", "Observability"] }).focusAreas).toEqual(["AI agents", "Observability"]);
    expect(() => write({ focusAreas: ["x".repeat(61)] })).toThrow(/under 60/);
    expect(() => write({ focusAreas: Array.from({ length: 13 }, (_, i) => `Area ${i}`) })).toThrow(/at most 12/);
    expect(() => write({ focusAreas: ["contact me@example.com"] })).toThrow(/email/);
  });
});

describe("what reads it", () => {
  it("changes nothing when the team has written nothing", () => {
    expect(directionForPrompt()).toBe("");
    expect(withDirection("SYSTEM", directionForPrompt())).toBe("SYSTEM");
    expect(focusForResearch()).toEqual([]);
  });

  it("gives briefs and plan drafts the whole direction, labelled as the team's and not evidence", async () => {
    write();
    const pack = buildContextPack(seed.accountId);
    const direction = directionForPrompt();
    await expect(generateBrief({ pack, ids: evidenceIds(pack), title: "Synthetic call", heldAt: "2026-10-30", attendees: [], direction }, [])).rejects.toThrow("captured");
    await expect(generatePlanDraft({ pack, ids: evidenceIds(pack), direction }, [])).rejects.toThrow("captured");
    expect(captured.map((c) => c.role)).toEqual(["brief", "plan_draft"]);
    for (const c of captured) {
      expect(c.system).toContain("AI agents; AI systems; AI security; Observability");
      expect(c.system).toContain(GOAL);
      expect(c.system).toMatch(/not evidence about this account/);
    }
  });

  it("sends web research the focus areas and nothing else of it", () => {
    write();
    const sent = WebResearchInput.parse({ companyName: "Synthetic Org", depth: "standard", teamFocus: focusForResearch() });
    const message = userMessage(sent);
    expect(message).toContain("AI agents; AI systems; AI security; Observability");
    expect(message).not.toContain(GOAL);
    expect(message).not.toContain("named AI programme");
    expect(message).not.toContain("hardware refreshes");
  });

  it("puts the focus areas, and no goal, into what a research run actually sends", async () => {
    vi.stubEnv("AI_FAKE", "1");
    write();
    const { startResearchRun } = await import("@/lib/research/run");
    const runId = startResearchRun({ accountId: seed.accountId, userId: USER, focus: null, depth: "standard" });
    const summary = (db().prepare("SELECT input_summary FROM ai_runs WHERE id = ?").get(runId) as { input_summary: string }).input_summary;
    expect(JSON.parse(summary).teamFocus).toEqual(["AI agents", "AI systems", "AI security", "Observability"]);
    expect(summary).not.toContain(GOAL);
  });
});
