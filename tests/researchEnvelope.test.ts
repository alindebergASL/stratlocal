import { beforeEach, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runWebResearch } from "@/lib/ai/runWebResearch";
import type { StageUsage } from "@/lib/ai/cost";

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/ai/fake", () => ({ fakeEnabled: () => false }));
// No real client or transport is reachable, even though fake mode is off.
vi.mock("@/lib/ai/client", () => ({ getDirectClient: () => ({ messages: { stream } }) }));
const usage = { input_tokens: 45000, output_tokens: 6000, server_tool_use: { web_search_requests: 8, web_fetch_requests: 5 } };
const input = { companyName: "Public company", depth: "standard" as const };
const answer = "Full report\n\n" + "A supported public signal.\n".repeat(200) + "THE END";
const toolBlocks = [
  { type: "server_tool_use", name: "web_search", id: "search1", input: { query: "public company" } },
  { type: "web_search_tool_result", tool_use_id: "search1", content: [{ type: "web_search_result", url: "https://example.com/source", encrypted_content: "x".repeat(600 * 1024) }] },
];
function reply(content: unknown[], stop_reason = "end_turn") {
  return { content, stop_reason, usage } as unknown as Anthropic.Message;
}
beforeEach(() => stream.mockReset());

const cite = (url: string, cited_text: string) => ({ type: "web_search_result_location", url, cited_text, encrypted_index: "opaque" });
const fetched = (url: string) => ({ type: "web_fetch_tool_result", content: { type: "web_fetch_result", url, content: { source: { type: "text", data: "Official source document." } } } });

it("retains text before/between tools and scopes returned citations to their own block", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply([
    { type: "text", text: "Organization scope." },
    ...toolBlocks,
    { type: "text", text: "Leadership is changing.", citations: [cite("https://example.com/leaders", "Leadership source excerpt.")] },
    fetched("https://example.com/finance"),
    { type: "text", text: "Unsupported neighboring claim." },
    { type: "text", text: "Budget is published.", citations: [cite("https://example.com/budget", "Budget source excerpt."), cite("javascript:alert(1)", "Unsafe source.")] },
    { type: "text", text: "Open questions." },
  ]) });
  const result = await runWebResearch(input, []);
  expect(result.text).toBe([
    "Organization scope.",
    "Leadership is changing.\n[Provider citation for this text block: https://example.com/leaders]",
    "Unsupported neighboring claim.",
    "Budget is published.\n[Provider citation for this text block: https://example.com/budget]",
    "Open questions.",
  ].join("\n\n"));
  expect(result.text).not.toContain("javascript:");
  expect(result.evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ url: "https://example.com/leaders", text: "Leadership source excerpt." }),
    expect.objectContaining({ url: "https://example.com/budget", text: "Budget source excerpt." }),
  ]));
  expect([...result.sources.values()]).toContain("https://example.com/leaders");
  expect(result.capture).toEqual({ status: "complete", reasons: [] });
});

it("accumulates multiple pauses and resolves fetch document citations across turns", async () => {
  stream.mockReturnValueOnce({ finalMessage: async () => reply([fetched("https://example.com/doc"), { type: "text", text: "Part one." }], "pause_turn") })
    .mockReturnValueOnce({ finalMessage: async () => reply([{ type: "text", text: "Part two.", citations: [{ type: "char_location", document_index: 0, start_char_index: 0, end_char_index: 8, cited_text: "Official" }] }], "pause_turn") })
    .mockReturnValueOnce({ finalMessage: async () => reply([{ type: "text", text: "Part three." }]) });
  const stages: StageUsage[] = [];
  const result = await runWebResearch(input, stages);
  expect(result.text).toBe("Part one.\n\nPart two.\n[Provider citation for this text block: https://example.com/doc]\n\nPart three.");
  expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ url: "https://example.com/doc", text: "Official", citation: expect.objectContaining({ document_index: 0 }) })]));
  expect(result.turns).toBe(3);
  expect(stages).toHaveLength(3);
  expect(stream.mock.calls[2]?.[0].messages).toHaveLength(3);
});

it("keeps partial report and evidence when both tool budgets are exhausted", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply([
    ...Array.from({ length: 8 }, () => ({ type: "server_tool_use", name: "web_search" })),
    ...Array.from({ length: 5 }, () => ({ type: "server_tool_use", name: "web_fetch" })),
    fetched("https://example.com/partial"), { type: "text", text: "Useful partial dossier." },
  ], "pause_turn") });
  const result = await runWebResearch(input, []);
  expect(result.text).toBe("Useful partial dossier.");
  expect(result.evidence).toHaveLength(1);
  expect(result.turns).toBe(1);
  expect(result.budgetExhausted).toBe(true);
  expect(result.capture).toEqual({ status: "partial", reasons: ["tool_budget_exhausted"] });
  expect(stream).toHaveBeenCalledTimes(1);
});

it("stops at three continuations with every readable partial block", async () => {
  for (let n = 0; n < 4; n++) stream.mockReturnValueOnce({ finalMessage: async () => reply([{ type: "text", text: `Part ${n}.` }], "pause_turn") });
  const result = await runWebResearch(input, []);
  expect(result.text).toBe("Part 0.\n\nPart 1.\n\nPart 2.\n\nPart 3.");
  expect(result.capture).toEqual({ status: "partial", reasons: ["continuation_limit"] });
  expect(result.turns).toBe(4);
  expect(stream).toHaveBeenCalledTimes(4);
});

it("labels max_tokens incomplete and retains earlier text even if final turn has none", async () => {
  stream.mockReturnValueOnce({ finalMessage: async () => reply([{ type: "text", text: "Earlier substantive report." }], "pause_turn") })
    .mockReturnValueOnce({ finalMessage: async () => reply([], "max_tokens") });
  const result = await runWebResearch(input, []);
  expect(result.text).toBe("Earlier substantive report.");
  expect(result.capture).toEqual({ status: "partial", reasons: ["max_tokens"] });
  expect(stream).toHaveBeenCalledTimes(2);
});

it("bounds cumulative UTF-8 report bytes across pauses after recording usage", async () => {
  stream.mockReturnValueOnce({ finalMessage: async () => reply([{ type: "text", text: "é".repeat(150 * 1024) }], "pause_turn") })
    .mockReturnValueOnce({ finalMessage: async () => reply([{ type: "text", text: "é".repeat(150 * 1024) }]) });
  const stages: StageUsage[] = [];
  await expect(runWebResearch(input, stages)).rejects.toThrow("The research answer was larger than this app will accept.");
  expect(stages).toHaveLength(2);
});

it("requests a full category dossier with entity separation and bounded gap-driven research", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply([{ type: "text", text: "Report." }]) });
  await runWebResearch({ ...input, companyName: "Example State University" }, []);
  const request = stream.mock.calls[0]?.[0];
  const prompt = request.system[0].text;
  for (const category of ["Organization and entity scope", "People and governance", "Money", "Strategic programs", "Technology and vendors", "Procurement", "Risks, change and hiring"]) expect(prompt).toContain(category);
  expect(prompt).toContain("named campus");
  expect(prompt).toContain("similarly named institutions");
  expect(prompt).toContain("not a one-page briefing");
  expect(request.messages[0].content).toContain("missing categories");
});

it("keeps the entire report and usage when tool content alone exceeds 512 KiB", async () => {
  const content = [...toolBlocks, { type: "text", text: answer }];
  expect(Buffer.byteLength(JSON.stringify(content))).toBeGreaterThan(512 * 1024);
  stream.mockReturnValue({ finalMessage: async () => reply(content) });
  const stages: StageUsage[] = [];
  const result = await runWebResearch(input, stages);
  expect(result.text).toBe(answer);
  expect([...result.sources.values()]).toEqual(["https://example.com/source"]);
  expect(stages).toHaveLength(1);
  expect(stages[0]?.usage).toEqual(usage);
  expect(stream.mock.calls[0]?.[0]).toMatchObject({ max_tokens: 24000, tools: [{ max_uses: 8 }, { max_uses: 5, max_content_tokens: 30000 }] });
});

it("rejects genuinely oversized final prose without losing billed usage", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply([{ type: "text", text: "é".repeat(270 * 1024) }]) });
  const stages: StageUsage[] = [];
  await expect(runWebResearch(input, stages)).rejects.toThrow("The research answer was larger than this app will accept.");
  expect(stages[0]?.usage).toEqual(usage);
});

it("continues with full large tool messages and harvests sources across turns", async () => {
  const first = [...toolBlocks, { type: "text", text: "Reading sources." }];
  stream.mockReturnValueOnce({ finalMessage: async () => reply(first, "pause_turn") })
    .mockReturnValueOnce({ finalMessage: async () => reply([
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://example.com/second" } },
      { type: "text", text: answer },
    ]) });
  const stages: StageUsage[] = [];
  const result = await runWebResearch({ ...input, depth: "deep" }, stages);
  expect(result.text).toBe(`Reading sources.\n\n${answer}`);
  expect(result.sources.size).toBe(2);
  expect(stages.map((s) => s.usage)).toEqual([usage, usage]);
  expect(stream.mock.calls[1]?.[0]).toMatchObject({ max_tokens: 32000, tools: [{ max_uses: 14 }, { max_uses: 10 }] });
  expect(stream.mock.calls[1]?.[0].messages[1].content).toBe(first);
});

it("does not fabricate citation URLs from unsupported prose markers or invalid document indices", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply([
    fetched("https://user:secret@example.com/unsafe"), fetched("https://example.com/safe"),
    { type: "text", text: "Claim [1].", citations: [
      { type: "char_location", document_index: 0, cited_text: "Do not remap this." },
      { type: "char_location", document_index: 99, cited_text: "Missing document." },
      { type: "unknown", url: "https://example.com/invented", cited_text: "Unknown type." },
    ] },
  ]) });
  const result = await runWebResearch(input, []);
  expect(result.text).toBe("Claim [1].");
  expect(result.evidence?.map((e) => e.url)).toEqual(["https://example.com/safe"]);
});

it("counts rendered citation URLs toward the report byte cap and still records usage", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply([{ type: "text", text: "x".repeat(512 * 1024 - 10), citations: [cite("https://example.com/source", "Source excerpt.")] }]) });
  const stages: StageUsage[] = [];
  await expect(runWebResearch(input, stages)).rejects.toThrow("The research answer was larger than this app will accept.");
  expect(stages).toHaveLength(1);
});

it("does not retry empty max_tokens or lose its usage", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply([], "max_tokens") });
  const stages: StageUsage[] = [];
  await expect(runWebResearch(input, stages)).rejects.toThrow("ran out of room");
  expect(stages).toHaveLength(1);
  expect(stream).toHaveBeenCalledTimes(1);
});

it("records usage even for a provider refusal", async () => {
  stream.mockReturnValue({ finalMessage: async () => reply(toolBlocks, "refusal") });
  const stages: StageUsage[] = [];
  await expect(runWebResearch(input, stages)).rejects.toThrow();
  expect(stages[0]?.usage).toEqual(usage);
});
