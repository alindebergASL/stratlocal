import { afterEach, expect, it, vi } from "vitest";
import * as client from "@/lib/ai/client";
import { checkProviders } from "@/lib/ai/smoke";
import { askTools } from "@/lib/ask/run";

// Exercise the actual request builder, not checkProviders' higher-level Ask seam.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("checks the complete Ask tool set with Opus-compatible automatic tool choice", async () => {
  vi.stubEnv("AI_FAKE", "");
  vi.stubEnv("AWS_REGION", "us-west-2");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-test-only");
  const create = vi.fn(async (request: { model: string; tools?: unknown; tool_choice?: { type: string } }) => {
    if (request.tool_choice?.type === "tool" || request.tool_choice?.type === "any") {
      throw new Error('400 tool_choice: type "tool" and "any" are not supported for this model.');
    }
    return { model: request.model, content: request.tools ? [{ type: "tool_use", name: "final_answer" }] : [{ type: "text", text: "OK" }], usage: { input_tokens: 1, output_tokens: 1 } };
  });
  // The Ask check streams, as Ask does (Bedrock's streaming permission is its
  // own); the stream's final message comes from the same request builder.
  const stream = (request: Parameters<typeof create>[0]) => ({ finalMessage: () => create(request) });
  vi.spyOn(client, "getClient").mockReturnValue({ messages: { create, stream } } as unknown as ReturnType<typeof client.getClient>);
  const checks = await checkProviders(undefined);
  expect(checks.map(c => c.status)).toEqual(["ok", "ok", "ok"]);
  expect(create).toHaveBeenCalledTimes(3);
  expect(create.mock.calls[2]?.[0]).toMatchObject({ tools: askTools(), tool_choice: { type: "auto" } });
  expect(checks[2]?.reply).toBe("called final_answer");
});
it("does not treat a different tool call as a successful Ask diagnostic", async () => {
  vi.stubEnv("AI_FAKE", "");
  vi.stubEnv("AWS_REGION", "us-west-2");
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-test-only");
  const checks = await checkProviders(undefined, async (_provider, model, tools) => ({ model, content: tools ? [{ type: "tool_use", name: "accounts" }] : [{ type: "text", text: "OK" }], usage: { input_tokens: 1, output_tokens: 1 } }));
  expect(checks[2]?.status).toBe("failed");
});
