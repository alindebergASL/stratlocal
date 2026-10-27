// Keep the real locked SDK's request adapter and Zod parser, but replace its
// transport and skip auth: no credentials, metadata lookup, or live AI calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StageUsage } from "@/lib/ai/cost";

const { transport, runtimeOptions, mantle } = vi.hoisted(() => ({
  transport: vi.fn<typeof fetch>(),
  runtimeOptions: vi.fn(),
  mantle: vi.fn(() => { throw new Error("Mantle cannot serve structured output"); }),
}));

vi.mock("@anthropic-ai/bedrock-sdk", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@anthropic-ai/bedrock-sdk")>();
  return {
    ...sdk,
    AnthropicBedrock: class extends sdk.AnthropicBedrock {
      constructor(options: NonNullable<ConstructorParameters<typeof sdk.AnthropicBedrock>[0]>) {
        runtimeOptions(options);
        super({ ...options, skipAuth: true, fetch: transport });
      }
    },
    AnthropicBedrockMantle: mantle,
  };
});

const schema = z.object({ answer: z.string() });
let runStructured: typeof import("@/lib/ai/runStructured").runStructured;
let getClient: typeof import("@/lib/ai/client").getClient;
let stages: StageUsage[];
const cache = globalThis as unknown as { __aiClients?: unknown };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  transport.mockReset();
  delete cache.__aiClients;
  // Exercise the real-call branch, with BOTH SDK auth and transport isolated.
  vi.stubEnv("AI_FAKE", "0");
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("BEDROCK_MODEL_ID", "");
  vi.stubEnv("DIRECT_MODEL_ID", "");
  vi.stubEnv("ANTHROPIC_BEDROCK_BASE_URL", undefined);
  stages = [];
  ({ runStructured } = await import("@/lib/ai/runStructured"));
  ({ getClient } = await import("@/lib/ai/client"));
});

afterEach(() => {
  delete cache.__aiClients;
  vi.unstubAllEnvs();
});

function reply(text: string | null, stopReason = "end_turn") {
  return new Response(JSON.stringify({
    id: "msg_mock", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: text === null ? [] : [{ type: "text", text }],
    stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 7 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function run(extra: Partial<Parameters<typeof runStructured<typeof schema>>[0]> = {}) {
  return runStructured({ role: "import", stageName: "extract", system: "Extract an answer.",
    user: "Example input.", schema, stages, ...extra });
}

function request(index = 0) {
  const [url, init] = transport.mock.calls[index]!;
  return { url: String(url), body: JSON.parse(init!.body as string) };
}

describe("Bedrock Runtime structured calls", () => {
  it("uses Invoke and retains adaptive thinking, JSON schema and parsed output", async () => {
    transport.mockResolvedValueOnce(reply('{"answer":"ok"}'));
    await expect(run()).resolves.toEqual({ data: { answer: "ok" }, attempts: 1 });
    expect(mantle).not.toHaveBeenCalled();
    expect(runtimeOptions).toHaveBeenCalledWith({ awsRegion: "us-east-1", timeout: 600000, maxRetries: 1 });
    expect(getClient("bedrock")).toBe(getClient("bedrock"));
    expect(runtimeOptions).toHaveBeenCalledTimes(1);
    expect(request().url).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-opus-5-5/invoke");
    expect(request().body).toMatchObject({
      anthropic_version: "bedrock-2023-05-31", max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: {
        type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false,
      } } },
      system: [{ type: "text", text: "Extract an answer.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "Example input." }],
    });
    expect(request().body).not.toHaveProperty("model");
    expect(stages).toEqual([{ name: "extract", provider: "bedrock", model: "us.anthropic.claude-opus-5-5",
      usage: { input_tokens: 12, output_tokens: 7 }, stop_reason: "end_turn" }]);
  });

  it("keeps client-side schema validation rather than accepting arbitrary JSON", async () => {
    transport.mockResolvedValueOnce(reply('{"answer":42}')).mockResolvedValueOnce(reply('{"answer":"ok"}'));
    await expect(run()).resolves.toEqual({ data: { answer: "ok" }, attempts: 2 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(stages).toHaveLength(2);
  });

  it("retains semantic correction turns and usage for each attempt", async () => {
    transport.mockResolvedValueOnce(reply('{"answer":"wrong"}')).mockResolvedValueOnce(reply('{"answer":"ok"}'));
    await expect(run({ effort: "high", maxTokens: 2000,
      check: (data) => data.answer === "ok" ? [] : [{ path: "answer", message: "Must be ok" }],
    })).resolves.toEqual({ data: { answer: "ok" }, attempts: 2 });
    expect(request(1).body).toMatchObject({ max_tokens: 2000, output_config: { effort: "high" } });
    expect(request(1).body.messages).toEqual([
      { role: "user", content: "Example input." },
      { role: "assistant", content: [{ type: "text", text: '{"answer":"wrong"}' }] },
      { role: "user", content: expect.stringContaining("answer: Must be ok") },
    ]);
    expect(stages.map((s) => s.name)).toEqual(["extract", "extract_retry_1"]);
  });

  it("retries incomplete JSON with usage retained and bounded research output growth", async () => {
    transport.mockResolvedValueOnce(reply('{"answer":"unfinished', "max_tokens"))
      .mockResolvedValueOnce(reply('{"answer":"ok"}'));
    await expect(run({ maxRetryTokens: 32000 })).resolves.toMatchObject({ attempts: 2 });
    expect(stages).toHaveLength(2);
    expect(stages[0]).toMatchObject({ stop_reason: "max_tokens", usage: { output_tokens: 7 } });
    expect(request(1).body.max_tokens).toBe(32000);
  });

  it("exhausts malformed JSON at three attempts and keeps all usage", async () => {
    transport.mockImplementation(async () => reply('{"answer":"unfinished'));
    await expect(run()).rejects.toMatchObject({ name: "AiRejected" });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(stages).toHaveLength(3);
  });

  it("never accepts max_tokens even when JSON is syntactically complete", async () => {
    transport.mockImplementation(async () => reply('{"answer":"partial"}', "max_tokens"));
    await expect(run({ maxRetryTokens: 32000 })).rejects.toThrow(/max_tokens/);
    expect(transport).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map(i => request(i).body.max_tokens)).toEqual([16000, 32000, 32000]);
  });

  it("does not swallow transport failures or retry them as invalid JSON", async () => {
    transport.mockResolvedValue(new Response('denied', { status: 403 }));
    await expect(run()).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(stages).toEqual([]);
  });

  it("preserves refusal handling", async () => {
    transport.mockResolvedValueOnce(reply(null, "refusal"));
    await expect(run()).rejects.toMatchObject({ name: "AiRefusal" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(stages).toHaveLength(1);
  });

  it("honors region fallback and the explicitly configured model", async () => {
    vi.stubEnv("AWS_REGION", undefined);
    vi.stubEnv("AWS_DEFAULT_REGION", "us-west-2");
    vi.stubEnv("BEDROCK_MODEL_ID", "us.anthropic.claude-opus-4-6-v1");
    vi.resetModules();
    ({ runStructured } = await import("@/lib/ai/runStructured"));
    transport.mockResolvedValueOnce(reply('{"answer":"ok"}'));
    await run();
    expect(request().url).toBe("https://bedrock-runtime.us-west-2.amazonaws.com/model/us.anthropic.claude-opus-4-6-v1/invoke");
  });

  it("keeps customer-data roles on US Bedrock and research on direct Anthropic", async () => {
    const { ROLES } = await import("@/lib/ai/models");
    for (const role of ["import", "meeting_extract", "meeting_invite", "meeting_recap", "brief", "plan_draft", "plan_check", "handoff_draft", "ask", "mail_extract", "summary"] as const) {
      expect(ROLES[role]).toEqual({ provider: "bedrock", model: "us.anthropic.claude-opus-5-5" });
    }
    expect(ROLES.research).toEqual({ provider: "direct", model: "claude-opus-5-5" });
  });
});
