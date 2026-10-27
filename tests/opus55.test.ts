import { afterEach, describe, expect, it, vi } from "vitest";
import { bareModel, priceFor } from "@/lib/ai/models";
import { estimateCostCents } from "@/lib/ai/cost";

afterEach(() => vi.unstubAllEnvs());

describe("Opus 5.5 pricing and cached-token accounting", () => {
  it("prices first-party cache reads at 5%, not the older 10% multiplier", () => {
    expect(priceFor("direct", "claude-opus-5-5")).toEqual({
      price: { input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.2, cache_write_per_mtok: 5 },
      estimated: false,
    });
  });

  it("retains US regional pricing as an explicit Bedrock estimate", () => {
    expect(bareModel("us.anthropic.claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(priceFor("bedrock", "us.anthropic.claude-opus-5-5")).toEqual({
      price: { input_per_mtok: 4.4, output_per_mtok: 22, cache_read_per_mtok: 0.22, cache_write_per_mtok: 5.5 },
      estimated: true,
    });
  });

  it("charges uncached inputs, outputs, cache reads and cache writes separately", () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 };
    expect(estimateCostCents([{ name: "synthetic", provider: "direct", model: "claude-opus-5-5", usage }])).toEqual({ cents: 2920, estimated: false });
    expect(estimateCostCents([{ name: "synthetic", provider: "bedrock", model: "us.anthropic.claude-opus-5-5", usage }])).toEqual({ cents: 3212, estimated: true });
  });

  it("honors explicitly supplied rates for the exact new model id", () => {
    for (const [suffix, value] of Object.entries({ INPUT: "6", OUTPUT: "30", CACHE_READ: "0.3", CACHE_WRITE: "7.5" })) {
      vi.stubEnv(`AI_PRICE_US_ANTHROPIC_CLAUDE_OPUS_5_5_${suffix}`, value);
    }
    expect(priceFor("bedrock", "us.anthropic.claude-opus-5-5")).toEqual({
      price: { input_per_mtok: 6, output_per_mtok: 30, cache_read_per_mtok: 0.3, cache_write_per_mtok: 7.5 }, estimated: false,
    });
  });

  it("preserves legacy prices for existing history and explicit rollbacks", () => {
    expect(priceFor("direct", "claude-opus-5")?.price.cache_read_per_mtok).toBe(0.5);
    expect(priceFor("bedrock", "us.anthropic.claude-opus-4-6-v1")?.price.input_per_mtok).toBe(5);
    expect(priceFor("bedrock", "unknown-model")).toBeNull();
  });
});
