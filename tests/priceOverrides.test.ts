// The price override has to name the model the app will actually ask about.
//
// `envOverride` in lib/ai/models.ts derives its variable name from the *full*
// model id — `us.anthropic.claude-opus-4-6-v1` becomes
// `AI_PRICE_US_ANTHROPIC_CLAUDE_OPUS_4_6_V1_INPUT`. So the name changes every
// time the model id does, and a rate written under the old name is not wrong,
// it is inert: no error, no warning, and a cost line that keeps saying
// "estimated" while somebody believes they have configured the real rate.
//
// tests/bedrockRuntime.test.ts already fails when the model changes, and
// tests/deployWiring.test.ts already checks that every variable .env.example
// declares is forwarded by Compose. Neither connects the two: both would stay
// green with the price variables named after a model nothing runs. This closes
// that, in both directions — the documented names are derived from the
// configured ids, and the override is proven to actually move the number.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { priceFor, ROLES } from "@/lib/ai/models";

const envKey = (model: string) => `AI_PRICE_${model.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
const SUFFIXES = ["INPUT", "OUTPUT", "CACHE_READ", "CACHE_WRITE"] as const;

const files = {
  ".env.example": readFileSync(".env.example", "utf8"),
  "deploy/.env.example": readFileSync("deploy/.env.example", "utf8"),
  "deploy/compose.yml": readFileSync("deploy/compose.yml", "utf8"),
};

afterEach(() => vi.unstubAllEnvs());

describe("the price override names the model that actually runs", () => {
  // Both providers: the Bedrock model carries every call with customer data,
  // the direct one carries research, and each is priced under its own name.
  const models = [ROLES.import.model, ROLES.research.model];

  it("is documented under the derived name in every file that mentions rates", () => {
    for (const model of models) {
      for (const suffix of SUFFIXES) {
        const key = `${envKey(model)}_${suffix}`;
        expect(files["deploy/.env.example"], `deploy/.env.example should declare ${key} for ${model}`).toContain(`${key}=`);
        expect(files["deploy/compose.yml"], `compose should forward ${key} for ${model}`).toContain(`${key}: \${${key}:-}`);
      }
      // The developer-facing file documents the pattern rather than declaring
      // every variable, so it only has to name the model's own key once.
      expect(files[".env.example"], `.env.example should show the override name for ${model}`).toContain(`${envKey(model)}_INPUT`);
    }
  });

  it("names no rate for a model nothing runs", () => {
    // The failure this exists for: the model id moves and the old variables
    // stay behind, declared and forwarded and read by nothing.
    const declared = [...files["deploy/.env.example"].matchAll(/^(AI_PRICE_[A-Z0-9_]+?)_(?:INPUT|OUTPUT|CACHE_READ|CACHE_WRITE)=$/gm)].map((m) => m[1]!);
    const live = new Set(models.map(envKey));
    // Web search and fetch are billed per request, not per model, so they are
    // named for the tool rather than derived from a model id.
    const perRequest = /^AI_PRICE_WEB_(SEARCH|FETCH)$/;
    for (const key of new Set(declared)) {
      if (perRequest.test(key)) continue;
      expect(live.has(key), `${key} is declared but no configured model derives it — a rate set here would be read by nothing`).toBe(true);
    }
  });

  it("actually moves the number, which is the only thing that proves the name", () => {
    // Deriving the name in the test the same way the code derives it would
    // pass even if both were wrong together. So this sets the variable and
    // reads the price back out.
    const model = ROLES.import.model;
    const before = priceFor("bedrock", model);
    expect(before, `${model} should have a price at all`).not.toBeNull();
    expect(before!.estimated, "a list-price fallback is an estimate until a real rate is set").toBe(true);

    vi.stubEnv(`${envKey(model)}_INPUT`, "3.75");
    vi.stubEnv(`${envKey(model)}_OUTPUT`, "18.5");
    const after = priceFor("bedrock", model);
    expect(after!.price.input_per_mtok).toBe(3.75);
    expect(after!.price.output_per_mtok).toBe(18.5);
    // And it stops calling itself an estimate, which is what the screen reads.
    expect(after!.estimated).toBe(false);
  });

  it("keeps a configured model priced, so the daily cap can still measure the day", () => {
    // An unpriced model stores NULL, NULL sums to zero, and the cap silently
    // stops existing. Whatever the ids are, they resolve to a price.
    for (const [role, spec] of Object.entries(ROLES)) {
      expect(priceFor(spec.provider, spec.model), `${role} (${spec.provider} ${spec.model}) has no price`).not.toBeNull();
    }
  });
});
