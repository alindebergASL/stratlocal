import { afterEach, describe, expect, it, vi } from "vitest";
import { spendIsTight, spendSub } from "@/lib/format";
import { startRun } from "@/lib/ai/guard";
import { estimateCostCents } from "@/lib/ai/cost";
import { bareModel, priceFor } from "@/lib/ai/models";

const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };

afterEach(() => {
  delete process.env.AI_PRICE_ANTHROPIC_CLAUDE_OPUS_5_INPUT;
  delete process.env.AI_PRICE_ANTHROPIC_CLAUDE_OPUS_5_OUTPUT;
  delete process.env.AI_PRICE_WEB_SEARCH_PER_1K_USD;
  delete process.env.AI_PRICE_WEB_FETCH_PER_1K_USD;
});

describe("what a run costs", () => {
  // AWS publishes its own Bedrock rates and we do not guess them. Until they
  // are configured the figure is derived from list prices and must say so.
  it("a Bedrock run is flagged as an estimate", () => {
    const cost = estimateCostCents([{ name: "s", provider: "bedrock", model: "anthropic.claude-opus-5", usage }]);
    expect(cost).not.toBeNull();
    expect(cost!.estimated).toBe(true);
    expect(cost!.cents).toBe(3000);
  });

  it("configuring the real rates makes it exact", () => {
    process.env.AI_PRICE_ANTHROPIC_CLAUDE_OPUS_5_INPUT = "6";
    process.env.AI_PRICE_ANTHROPIC_CLAUDE_OPUS_5_OUTPUT = "30";
    const cost = estimateCostCents([{ name: "s", provider: "bedrock", model: "anthropic.claude-opus-5", usage }]);
    expect(cost!.estimated).toBe(false);
    expect(cost!.cents).toBe(3600);
  });

  it("a direct API run with no tool use uses the published list price and is not an estimate", () => {
    const cost = estimateCostCents([{ name: "s", provider: "direct", model: "claude-opus-5", usage }]);
    expect(cost!.estimated).toBe(false);
    expect(cost!.cents).toBe(3000);
  });

  // Web search and page fetch are billed per request. Printing the token cost
  // alone as though it were the bill is the thing this must not do.
  //
  // Phase 3 wrote this the other way round: any server-tool use forced
  // `estimated: true`, because the rates were genuinely unknown then. They are
  // published — $10 per 1,000 searches, nothing at all for a fetch — so the
  // honest answer now is a number, and the flag goes back to meaning the one
  // thing it should mean: we do not know this model's price.
  it("counts searches at the published rate with nothing configured", () => {
    const cost = estimateCostCents([
      { name: "s", provider: "direct", model: "claude-opus-5", usage: { ...usage, server_tool_use: { web_search_requests: 8, web_fetch_requests: 5 } } },
    ]);
    expect(cost!.estimated).toBe(false);
    // $30 of tokens, 8 searches at $10 per 1,000 is 8 cents, and the five
    // fetches are free — which is why this is a default and not a setting.
    expect(cost!.cents).toBe(3008);
  });

  it("a deep run's searches are money the cap can see", () => {
    // 15 searches is the deep budget in runWebResearch. Fifteen cents a run
    // against a $15 day is the charge that used to be counted as zero.
    const cost = estimateCostCents([
      { name: "s", provider: "direct", model: "claude-opus-5", usage: { server_tool_use: { web_search_requests: 15 } } },
    ]);
    expect(cost).toEqual({ cents: 15, estimated: false });
  });

  it("an override replaces the default rather than sitting beside it", () => {
    process.env.AI_PRICE_WEB_SEARCH_PER_1K_USD = "20";
    process.env.AI_PRICE_WEB_FETCH_PER_1K_USD = "10";
    const cost = estimateCostCents([
      { name: "s", provider: "direct", model: "claude-opus-5", usage: { ...usage, server_tool_use: { web_search_requests: 8, web_fetch_requests: 5 } } },
    ]);
    expect(cost!.estimated).toBe(false);
    // 8 at $20 per 1,000 is 16 cents; 5 at $10 per 1,000 is 5.
    expect(cost!.cents).toBe(3021);
  });

  it("falls back to the published rate for a blank or nonsense override", () => {
    // Compose forwards an unset variable as the empty string, which is exactly
    // the state the deployed box is in.
    process.env.AI_PRICE_WEB_SEARCH_PER_1K_USD = "";
    process.env.AI_PRICE_WEB_FETCH_PER_1K_USD = "  ";
    const a = estimateCostCents([{ name: "s", provider: "direct", model: "claude-opus-5", usage: { server_tool_use: { web_search_requests: 10 } } }]);
    expect(a).toEqual({ cents: 10, estimated: false });
    process.env.AI_PRICE_WEB_SEARCH_PER_1K_USD = "free";
    const b = estimateCostCents([{ name: "s", provider: "direct", model: "claude-opus-5", usage: { server_tool_use: { web_search_requests: 10 } } }]);
    expect(b).toEqual({ cents: 10, estimated: false });
  });

  it("still says estimated when it is the model price that is unknown", () => {
    // The flag has one meaning left, and a research-shaped stage must not
    // launder a Bedrock list-price guess into an exact-looking figure.
    const cost = estimateCostCents([
      { name: "s", provider: "bedrock", model: "anthropic.claude-opus-5", usage: { ...usage, server_tool_use: { web_search_requests: 8 } } },
    ]);
    expect(cost!.estimated).toBe(true);
    expect(cost!.cents).toBe(3008);
  });

  it("regional and global Bedrock model ids resolve to the same base model", () => {
    for (const id of ["anthropic.claude-opus-5", "us.anthropic.claude-opus-5", "global.anthropic.claude-opus-5"]) {
      expect(priceFor("bedrock", id)?.price.input_per_mtok).toBe(5);
    }
  });

  it("an unknown model yields no figure at all rather than a wrong one", () => {
    expect(estimateCostCents([{ name: "s", provider: "bedrock", model: "anthropic.something-else", usage }])).toBeNull();
  });

  it("the fake provider contributes nothing", () => {
    const cost = estimateCostCents([{ name: "s", provider: "bedrock", model: "fake", usage }]);
    expect(cost).toEqual({ cents: 0, estimated: false });
  });
});

describe("model ids that carry a date", () => {
  it("still resolve to a price, so the cap keeps working", () => {
    // The README tells you to set BEDROCK_MODEL_ID to an inference profile,
    // and those carry a date. bareModel stripped a trailing -vN and not the
    // date, so these resolved to no price — and an unpriced run stores NULL,
    // which sums to zero against AI_DAILY_CAP_CENTS. The budget silently
    // stopped existing for exactly the ids you are told to use.
    for (const id of [
      "anthropic.claude-opus-5",
      "us.anthropic.claude-opus-5-v1:0",
      "global.anthropic.claude-opus-5",
      "us.anthropic.claude-opus-5-20260514-v1:0",
      "anthropic.claude-sonnet-5-20260514",
    ]) {
      expect(bareModel(id)).toMatch(/^claude-(opus|sonnet|haiku)-/);
      expect(priceFor("bedrock", id)).not.toBeNull();
    }
  });

  it("gives up honestly on one it does not know", () => {
    expect(priceFor("bedrock", "anthropic.some-future-model")).toBeNull();
  });
});

describe("the daily cap, read from the environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes zero literally", async () => {
    // "Spend nothing today" is the obvious thing to want, and it used to be
    // read as "use the default", because Number("") is also 0 and the guard
    // against a blank variable caught both.
    const { dailyCapCents } = await import("@/lib/ai/guard");
    vi.stubEnv("AI_DAILY_CAP_CENTS", "0");
    expect(dailyCapCents()).toBe(0);
  });

  it("falls back for blank or nonsense, which is what the guard was for", async () => {
    const { dailyCapCents } = await import("@/lib/ai/guard");
    vi.stubEnv("AI_DAILY_CAP_CENTS", "");
    expect(dailyCapCents()).toBe(1500);
    vi.stubEnv("AI_DAILY_CAP_CENTS", "  ");
    expect(dailyCapCents()).toBe(1500);
    vi.stubEnv("AI_DAILY_CAP_CENTS", "lots");
    expect(dailyCapCents()).toBe(1500);
    vi.stubEnv("AI_DAILY_CAP_CENTS", "-5");
    expect(dailyCapCents()).toBe(1500);
  });

  it("uses a real number when it gets one", async () => {
    const { dailyCapCents } = await import("@/lib/ai/guard");
    vi.stubEnv("AI_DAILY_CAP_CENTS", "250");
    expect(dailyCapCents()).toBe(250);
  });
});

describe("a cap of zero", () => {
  it("says model calls are off rather than that the budget is spent", () => {
    // Zero is how you switch model calls off for the day, and the refusal it
    // produced was the one message in the app that was simply untrue: nothing
    // had been spent, and it was not going to reset into anything at midnight.
    vi.stubEnv("AI_DAILY_CAP_CENTS", "0");
    vi.stubEnv("AI_FAKE", "");
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(() => startRun({ role: "import", accountId: null, userId: "user-1" })).toThrow(/switched off/i);
    expect(() => startRun({ role: "import", accountId: null, userId: "user-1" })).not.toThrow(/is spent/i);
  });

  it("does not paint the spend tile as though the budget were nearly gone", () => {
    // `0 >= 0 * 0.8` is true, so the tile was permanently accent-toned and the
    // line read "$0.00 of $0.00".
    expect(spendIsTight({ cents: 0, capCents: 0, unpriced: 0 })).toBe(false);
    expect(spendSub({ cents: 0, capCents: 0, unpriced: 0 })).toBe("model calls are off");
    // And the ordinary cases still behave.
    expect(spendIsTight({ cents: 1200, capCents: 1500, unpriced: 0 })).toBe(true);
    expect(spendIsTight({ cents: 100, capCents: 1500, unpriced: 0 })).toBe(false);
    expect(spendIsTight({ cents: 0, capCents: 1500, unpriced: 1 })).toBe(true);
    expect(spendSub({ cents: 0, capCents: 1500, unpriced: 2 })).toBe("of $15.00 · 2 unpriced");
  });
});
