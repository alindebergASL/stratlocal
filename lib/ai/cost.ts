import { priceFor, type Provider } from "./models";

export type StageUsage = {
  name: string;
  provider: Provider;
  model: string;
  stop_reason?: string | null;
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    // Web search and page fetch are billed per request, not per token. A
    // research run's charge is mostly invisible without this.
    server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
  };
};

export type AggregateUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
};

export type CostEstimate = { cents: number; estimated: boolean } | null;

const warned = new Set<string>();

// Null when any stage's model has no known price: never a wrong number.
export function estimateCostCents(stages: StageUsage[]): CostEstimate {
  let total = 0;
  let estimated = false;
  for (const s of stages) {
    if (s.model === "fake") continue;
    const p = priceFor(s.provider, s.model);
    if (!p) {
      const key = `${s.provider}:${s.model}`;
      if (!warned.has(key)) {
        console.warn(`[cost] no price for ${key}; cost will be null`);
        warned.add(key);
      }
      return null;
    }
    estimated = estimated || p.estimated;
    const u = s.usage;
    const dollars =
      ((u.input_tokens ?? 0) * p.price.input_per_mtok +
        (u.output_tokens ?? 0) * p.price.output_per_mtok +
        (u.cache_read_input_tokens ?? 0) * p.price.cache_read_per_mtok +
        (u.cache_creation_input_tokens ?? 0) * p.price.cache_write_per_mtok) /
      1_000_000;
    total += dollars * 100;

    // Server-side tools are billed per request, not per token, and research is
    // the only surface that uses them. These rates are published, so they are
    // the defaults rather than something a deployment has to discover: a box
    // that configures nothing already counts them. The env variables remain
    // the way to say something different.
    //
    // One honest caveat, better written down than discovered: the docs say a
    // search that errors is not billed, but `web_search_requests` counts uses
    // and runWebResearch already counts a max_uses_exceeded block. So this can
    // over-state by the price of a failed search. That is the safe direction
    // for a cap — it bites early rather than late.
    const searches = u.server_tool_use?.web_search_requests ?? 0;
    const fetches = u.server_tool_use?.web_fetch_requests ?? 0;
    total += ((searches * toolRate("AI_PRICE_WEB_SEARCH_PER_1K_USD", WEB_SEARCH_PER_1K_USD)) / 1000) * 100;
    total += ((fetches * toolRate("AI_PRICE_WEB_FETCH_PER_1K_USD", WEB_FETCH_PER_1K_USD)) / 1000) * 100;
  }
  return { cents: Math.round(total), estimated };
}

// platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool and
// .../web-fetch-tool, "Usage and pricing": search is $10 per 1,000 searches
// on top of tokens; fetch carries no additional charge at all.
//
// Zero is the reason this is code and not configuration. `estimated` means
// "we do not know this rate", and no value in a .env file can teach a
// null-means-unknown check that the true answer is nothing.
const WEB_SEARCH_PER_1K_USD = 10;
const WEB_FETCH_PER_1K_USD = 0;

/**
 * What N searches will cost, in cents, before anybody presses anything.
 *
 * Exported so the button can say what it is about to spend. Phase 6 wanted
 * this and could not have it honestly — the rate was unknown, and inventing
 * one would have been the opposite of the commitment that page is built on —
 * so the screen said "several times the cost" and a number appeared only
 * afterwards. Now the rate is published, the estimate before the press and
 * the charge counted after it are the same arithmetic reading the same
 * constant, which is the only way the two can be trusted to agree.
 */
export function searchCostCents(searches: number): number {
  return Math.round(((searches * toolRate("AI_PRICE_WEB_SEARCH_PER_1K_USD", WEB_SEARCH_PER_1K_USD)) / 1000) * 100);
}

function toolRate(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function aggregateUsage(stages: StageUsage[]): AggregateUsage {
  const t: AggregateUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    web_search_requests: 0,
    web_fetch_requests: 0,
  };
  for (const s of stages) {
    t.input_tokens += s.usage.input_tokens ?? 0;
    t.output_tokens += s.usage.output_tokens ?? 0;
    t.cache_read_input_tokens += s.usage.cache_read_input_tokens ?? 0;
    t.cache_creation_input_tokens += s.usage.cache_creation_input_tokens ?? 0;
    t.web_search_requests += s.usage.server_tool_use?.web_search_requests ?? 0;
    t.web_fetch_requests += s.usage.server_tool_use?.web_fetch_requests ?? 0;
  }
  return t;
}
