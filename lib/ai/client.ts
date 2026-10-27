// The provider seam. Both clients expose the same messages.* surface, so the
// callers only ever pick a Role; models.ts decides where it runs.
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { fakeEnabled } from "./fake";
import type { Provider } from "./models";

const TIMEOUT_MS = 10 * 60 * 1000;

type AnyClient = Anthropic | AnthropicBedrock;

const g = globalThis as unknown as { __aiClients?: Partial<Record<Provider, AnyClient>> };
const cache: Partial<Record<Provider, AnyClient>> = (g.__aiClients ??= {});

// A human-readable reason the provider cannot be used, or null when it can.
export function providerProblem(provider: Provider): string | null {
  if (process.env.STRATEGY_LOCAL_ONLY === "1") return "External AI is disabled in StrategyLocal. Local models are not configured yet.";
  if (fakeEnabled()) return null;
  if (provider === "direct") {
    return process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY is not set; web research is unavailable";
  }
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    return "AWS_REGION is not set; Bedrock is unavailable";
  }
  return null;
}

export function getClient(provider: Provider): AnyClient {
  const problem = providerProblem(provider);
  if (problem) throw new Error(problem);
  const existing = cache[provider];
  if (existing) return existing;
  const client: AnyClient =
    provider === "direct"
      ? new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 })
      // Runtime Invoke supports output_config.format; Mantle rejects it.
      // AWS_PROFILE and the instance role come from the default credential chain.
      : new AnthropicBedrock({
          awsRegion: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
          timeout: TIMEOUT_MS,
          maxRetries: 1,
        });
  cache[provider] = client;
  return client;
}

// Web research is the only surface that runs off Bedrock, and it needs the
// concrete Anthropic client for the server-side web tools. Asking for it by
// name rather than narrowing a union at the call site keeps the one exception
// to DECISIONS #3 visible in the code that takes it.
export function getDirectClient(): Anthropic {
  return getClient("direct") as Anthropic;
}

export type { AnyClient };

// What an AWS failure actually means.
//
// None of this has ever met real AWS, and every first-day failure reaches the
// screen today as a raw SDK message: an AccessDeniedException that is really a
// model ARN naming the wrong region, a credentials timeout that is really the
// IMDSv2 hop limit, a ValidationException that is really a bare model id where
// the region wants an inference profile. Each reads as "the button is broken".
//
// This does not swallow the original — it prefixes it, so the sentence a
// person can act on comes first and the SDK's own words are still there for
// the one who goes looking.
export function explainProviderError(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const hint = providerHint(raw);
  return hint ? `${hint}\n\n${raw}` : raw;
}

export function providerHint(raw: string): string | null {
  const text = raw.toLowerCase();
  // The container cannot reach instance metadata. On EC2 this is almost always
  // the hop limit, which defaults to 1 and is consumed by Docker's own NAT —
  // so the role exists, the policy is right, and nothing can see it.
  if (
    text.includes("credentialsprovidererror") ||
    text.includes("could not load credentials") ||
    text.includes("metadata service") ||
    (text.includes("timeout") && text.includes("169.254.169.254"))
  ) {
    return "The container could not get AWS credentials. On EC2 this is nearly always the IMDSv2 hop limit, which defaults to 1 and is used up by Docker's own network: `aws ec2 modify-instance-metadata-options --instance-id <id> --http-put-response-hop-limit 2 --http-tokens required`. See deploy/README.md.";
  }
  if (text.includes("accessdenied") || text.includes("not authorized")) {
    return "The instance role is not allowed to invoke this model. Check that the policy's model ARN names the same model id as BEDROCK_MODEL_ID and the same region as AWS_REGION — an ARN for another region fails exactly like a missing permission.";
  }
  if (text.includes("validationexception") && (text.includes("inference profile") || text.includes("on-demand"))) {
    return "This region wants an inference-profile id rather than a bare model id. Set BEDROCK_MODEL_ID to the profile form (for example `us.anthropic.claude-opus-5`).";
  }
  if (text.includes("resourcenotfound") || text.includes("model identifier is invalid")) {
    return "Bedrock does not have that model id in this region. Check the model list in the Bedrock console for AWS_REGION and set BEDROCK_MODEL_ID to one it offers.";
  }
  if (text.includes("throttling") || text.includes("too many requests")) {
    return "Bedrock is throttling this account. It is a quota, not a configuration problem — wait, or ask AWS for a higher rate on this model.";
  }
  if (text.includes("authentication_error") || text.includes("invalid x-api-key") || text.includes("401")) {
    return "The Anthropic API key was refused. Check ANTHROPIC_API_KEY — this is the only call that uses it, so nothing else on the deployment will show the problem.";
  }
  return null;
}
