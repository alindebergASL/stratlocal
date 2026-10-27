// Which model each surface uses, on which provider, and what it costs.
//
// Two providers: "bedrock" (Amazon Bedrock in our AWS account; every call that
// carries customer data) and "direct" (the Anthropic API; only the web
// research call, which sends public inputs). Repointing a surface is a
// one-line change here.

export type Provider = "bedrock" | "direct";

export type Role = "import" | "meeting_extract" | "meeting_invite" | "meeting_recap" | "brief" | "plan_draft" | "plan_check" | "handoff_draft" | "research" | "research_extract" | "ask" | "mail_extract" | "summary";

export type RoleSpec = { provider: Provider; model: string };

// Native structured output is verified separately from a plain provider ping.
const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-5-5";
const DIRECT_MODEL = process.env.DIRECT_MODEL_ID || "claude-opus-5-5";

export const ROLES: Record<Role, RoleSpec> = {
  import: { provider: "bedrock", model: BEDROCK_MODEL },
  meeting_extract: { provider: "bedrock", model: BEDROCK_MODEL },
  // A pasted invite carries customer names and addresses, so it goes where
  // every other call carrying customer data goes (DECISIONS #3). Research is
  // the single exception and it stays the single exception.
  meeting_invite: { provider: "bedrock", model: BEDROCK_MODEL },
  // The recap email is drafted from the notes and the attendees' names: the
  // same customer data, so the same provider.
  meeting_recap: { provider: "bedrock", model: BEDROCK_MODEL },
  brief: { provider: "bedrock", model: BEDROCK_MODEL },
  plan_draft: { provider: "bedrock", model: BEDROCK_MODEL },
  // Reads the account thesis against meeting notes: account data, so Bedrock.
  plan_check: { provider: "bedrock", model: BEDROCK_MODEL },
  // A handoff's covering text, from the account's records: Bedrock.
  handoff_draft: { provider: "bedrock", model: BEDROCK_MODEL },
  research: { provider: "direct", model: DIRECT_MODEL },
  // Interpreting public research can include private playbook/account context.
  // Only the public web-gathering stage uses the direct research role.
  research_extract: { provider: "bedrock", model: BEDROCK_MODEL },
  // Ask reads account data through its tools, so it is Bedrock like every
  // other call that carries it (DECISIONS #3); it never searches the web itself; its one web tool starts an ordinary research run (DECISIONS #101).
  ask: { provider: "bedrock", model: BEDROCK_MODEL },
  // Reads customer email: customer data, so Bedrock (DECISIONS #102).
  mail_extract: { provider: "bedrock", model: BEDROCK_MODEL },
  // Written summaries of Today and of an account: customer data, so Bedrock (DECISIONS #106).
  summary: { provider: "bedrock", model: BEDROCK_MODEL },
};

export type ModelPrice = {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
};

function price(input: number, output: number): ModelPrice {
  return {
    input_per_mtok: input,
    output_per_mtok: output,
    cache_read_per_mtok: Number((input * 0.1).toFixed(4)),
    cache_write_per_mtok: Number((input * 1.25).toFixed(4)),
  };
}

// Anthropic list prices per million tokens (USD), by bare model id.
const LIST_PRICES: Record<string, ModelPrice> = {
  // Opus 5.5 cache reads are 5%, not the older models' 10% input rate.
  // https://platform.claude.com/docs/en/about-claude/pricing
  "claude-opus-5-5": { ...price(4, 20), cache_read_per_mtok: 0.20 },
  "claude-opus-5": price(5, 25),
  "claude-opus-4-6": price(5, 25),
  "claude-opus-4-8": price(5, 25),
  "claude-sonnet-5": price(2, 10),
  "claude-haiku-4-5": price(1, 5),
};

// Bedrock is billed by AWS at its own rates. Until a rate is entered here (or
// via AI_PRICE_<MODEL>_INPUT / _OUTPUT env overrides), the list price for the
// same base model is used and the cost is flagged as an estimate.
const BEDROCK_PRICES: Record<string, ModelPrice> = {};

export function bareModel(model: string): string {
  // "anthropic.claude-opus-5" and "us.anthropic.claude-opus-5-v1:0" both -> "claude-opus-5"
  const m = /claude-[a-z0-9-]+?(?:-v\d+(?::\d+)?)?$/.exec(model);
  if (!m) return model;
  return (
    m[0]
      .replace(/-v\d+(?::\d+)?$/, "")
      // And the date some inference-profile ids carry, which the version
      // stripping above missed: us.anthropic.claude-sonnet-5-20260514-v1:0.
      // Without this every such id fell through to no price at all, and an
      // unpriced run stores NULL — which then sums to zero against the daily
      // cap, so the budget silently stopped existing. The README tells you to
      // use exactly these ids.
      .replace(/-\d{8}$/, "")
  );
}

function envOverride(model: string): Partial<ModelPrice> {
  const k = model.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
  const num = (s: string | undefined) => (s !== undefined && s !== "" ? Number(s) : undefined);
  return {
    input_per_mtok: num(process.env[`AI_PRICE_${k}_INPUT`]),
    output_per_mtok: num(process.env[`AI_PRICE_${k}_OUTPUT`]),
    cache_read_per_mtok: num(process.env[`AI_PRICE_${k}_CACHE_READ`]),
    cache_write_per_mtok: num(process.env[`AI_PRICE_${k}_CACHE_WRITE`]),
  };
}

export type PriceLookup = { price: ModelPrice; estimated: boolean } | null;

export function priceFor(provider: Provider, model: string): PriceLookup {
  const ovr = envOverride(model);
  let base: ModelPrice | undefined;
  let estimated = false;
  if (provider === "bedrock") {
    base = BEDROCK_PRICES[model] ?? BEDROCK_PRICES[bareModel(model)];
    if (!base) {
      base = LIST_PRICES[bareModel(model)];
      // The published regional premium is 10%. Keep this a labelled estimate
      // until exact deployed Bedrock rates are supplied; do not undercount
      // the US profile by silently using global first-party prices.
      if (base && model === "us.anthropic.claude-opus-5-5") {
        base = {
          input_per_mtok: 4.4,
          output_per_mtok: 22,
          cache_read_per_mtok: 0.22,
          cache_write_per_mtok: 5.5,
        };
      }
      estimated = true;
    }
  } else {
    base = LIST_PRICES[model] ?? LIST_PRICES[bareModel(model)];
  }
  if (!base) return null;
  const hasOverride = Object.values(ovr).some((v) => v !== undefined);
  return {
    price: {
      input_per_mtok: ovr.input_per_mtok ?? base.input_per_mtok,
      output_per_mtok: ovr.output_per_mtok ?? base.output_per_mtok,
      cache_read_per_mtok: ovr.cache_read_per_mtok ?? base.cache_read_per_mtok,
      cache_write_per_mtok: ovr.cache_write_per_mtok ?? base.cache_write_per_mtok,
    },
    estimated: estimated && !hasOverride,
  };
}
