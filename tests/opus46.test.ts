import { afterEach, describe, expect, it, vi } from "vitest";
import { bareModel, priceFor } from "@/lib/ai/models";
const model = "us.anthropic.claude-opus-4-6-v1";
const prefix = "AI_PRICE_US_ANTHROPIC_CLAUDE_OPUS_4_6_V1_";
afterEach(() => vi.unstubAllEnvs());
describe("Opus 4.6 deployment pricing", () => {
  it("recognizes the US inference profile and labels fallback prices as estimates", () => {
    for (const key of ["INPUT", "OUTPUT", "CACHE_READ", "CACHE_WRITE"]) vi.stubEnv(prefix + key, "");
    expect(bareModel(model)).toBe("claude-opus-4-6");
    expect(priceFor("bedrock", model)).toMatchObject({ estimated: true, price: { input_per_mtok: 5, output_per_mtok: 25 } });
  });
  it("applies the explicitly configured regional rates to the selected profile", () => {
    for (const [key, value] of Object.entries({ INPUT: "5.5", OUTPUT: "27.5", CACHE_READ: "0.55", CACHE_WRITE: "6.875" })) vi.stubEnv(prefix + key, value);
    expect(priceFor("bedrock", model)).toEqual({ estimated: false, price: { input_per_mtok: 5.5, output_per_mtok: 27.5, cache_read_per_mtok: 0.55, cache_write_per_mtok: 6.875 } });
  });
});
