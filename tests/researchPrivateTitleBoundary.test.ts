// Synthetic taint-flow regression, not a claim about a real model's output.
// Real run -> direct prompt -> extraction -> storage -> accept -> next run;
// both provider transports are mocked and fetch is forbidden.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getRun } from "@/lib/ai/guard";
import { applyEntityChange } from "@/lib/proposals/apply";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { Playbook } from "@/lib/playbook/schema";
import { citedBefore, startResearchRun } from "@/lib/research/run";
import { acceptNote, listNotes, researchForPrompt } from "@/lib/research/notes";
import { urlKey } from "@/lib/ai/runWebResearch";
import { seedAccount, USER } from "./helpers";

const { stream, create, getClient } = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn(), getClient: vi.fn() }));
vi.mock("@/lib/ai/fake", () => ({ fakeEnabled: () => false }));
vi.mock("@/lib/ai/client", async (original) => ({
  ...await original<typeof import("@/lib/ai/client")>(),
  getDirectClient: () => ({ messages: { stream } }),
  getClient,
  providerProblem: () => null,
}));
const PRIVATE = "SYNTHETIC-PRIVATE-ARCHETYPE-ONLY";
const url = "https://example.com/synthetic-release";
const prose = "Synthetic public organisation published its annual plan.";
const usage = { input_tokens: 100, output_tokens: 100 };

beforeEach(() => {
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in synthetic test"); }));
  stream.mockReset().mockReturnValue({ on: vi.fn(), finalMessage: async () => ({
    stop_reason: "end_turn", usage,
    content: [{ type: "text", text: prose, citations: [{ type: "web_search_result_location", url, cited_text: prose, encrypted_index: "synthetic" }] }],
  }) });
  // The private steer must stay on Bedrock during extraction, as well as
  // staying out of the subsequent direct web-research request.
  getClient.mockReset().mockImplementation((provider: "bedrock" | "direct") => {
    expect(provider).toBe("bedrock");
    return { messages: { create } };
  });
  create.mockReset().mockImplementation(async (request) => {
    expect(request.model).toBe(process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-5-5");
    // Demonstrate conditioning on the actual private steer, not a manually
    // inserted title bypassing the extraction/storage/acceptance path.
    expect(JSON.stringify(request.messages)).toContain(PRIVATE);
    return { stop_reason: "end_turn", usage, content: [{ type: "text", text: JSON.stringify({
      title: `Synthetic note ${PRIVATE}`, summary: "Synthetic public summary.", open_questions: [],
      findings: [{ text: prose, quote: prose, url, date: null, topic: "strategy", confidence: "high" }],
    }) }] };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function run(accountId: string, depth: "standard" | "deep", onlyNew = false) {
  const id = startResearchRun({ accountId, userId: USER, focus: null, depth, onlyNew });
  await vi.waitFor(() => expect(getRun(id)?.status).not.toBe("running"));
  const result = getRun(id)!;
  expect(result.status, result.error ?? undefined).toBe("done");
  return result;
}

it.each(["standard", "deep"] as const)("keeps accepted private-conditioned titles off actual %s outbound requests without losing evidence or deduplication", async (depth) => {
  const { accountId } = seedAccount();
  savePlaybook({ playbook: {
    ...STARTER_PLAYBOOK,
    archetypes: Playbook.parse(STARTER_PLAYBOOK).archetypes.map((a) => a.id === "stuck-in-pilots" ? { ...a, name: PRIVATE } : a),
  }, userId: USER, basisId: null });
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: "stuck-in-pilots" }, actorUserId: USER });
  await run(accountId, depth);
  expect(stream).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(stream.mock.calls[0]![0])).not.toContain(PRIVATE);
  const draft = listNotes(accountId, "draft")[0]!;
  expect(draft.meta.title).toContain(PRIVATE);
  expect(draft.meta.findings[0]?.evidence).toMatchObject({ kind: "source_excerpt", text: prose });
  acceptNote(draft.doc.id, [0], USER);
  const kept = listNotes(accountId, "accepted")[0]!;
  expect(kept.meta.title).toContain(PRIVATE);
  expect(researchForPrompt(accountId)).toContain(prose);
  expect(citedBefore(accountId).has(urlKey(url)!)).toBe(true);

  // Exercise both ordinary repeated research and the watch's internal
  // only-new filter. Neither may send note titles to direct research.
  const next = await run(accountId, depth, depth === "deep");
  expect(stream).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(2);
  expect(getClient).toHaveBeenCalledTimes(2);
  expect(listNotes(accountId, "accepted")[0]).toEqual(kept);
  if (depth === "deep") {
    expect(listNotes(accountId, "draft")).toHaveLength(0);
    expect(JSON.parse(next.result_json!)).toMatchObject({ documentId: null, findings: 0, dropped: [expect.stringContaining("Shown before:")] });
  } else {
    expect(listNotes(accountId, "draft")[0]?.meta.findings[0]?.evidence).toMatchObject({ kind: "source_excerpt", text: prose });
  }
  expect(fetch).not.toHaveBeenCalled();
  // These are the actual input summary and SDK stream request from the next
  // run, not a reconstructed prompt or a source-code string assertion.
  expect.soft(JSON.parse(next.input_summary!).avoidTitles).toEqual([]);
  expect.soft(next.input_summary).not.toContain(PRIVATE);
  expect.soft(JSON.stringify(stream.mock.calls[1]![0])).not.toContain(PRIVATE);
  expect(JSON.parse(next.input_summary!).budgetTiming).toBe(true);
});
