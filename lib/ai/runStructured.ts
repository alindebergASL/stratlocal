// One structured call: system prompt, one user message, a Zod schema for the
// answer, and an optional semantic check. When the answer fails to parse or
// the check reports findings, the findings go back to the model as a follow-up
// turn and it tries again, up to maxAttempts.
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getClient } from "./client";
import type { StageUsage } from "./cost";
import { fakeAnswer, fakeEnabled } from "./fake";
import { ROLES, type Role } from "./models";

export type Finding = { path: string; message: string };

export class AiRefusal extends Error {
  constructor(public category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}.`);
    this.name = "AiRefusal";
  }
}

export class AiRejected extends Error {
  constructor(public findings: Finding[]) {
    super(`The model's answer did not pass checks after retries: ${findings.map((f) => `${f.path}: ${f.message}`).join("; ")}`);
    this.name = "AiRejected";
  }
}

export type RunStructuredOptions<S extends z.ZodType> = {
  role: Role;
  stageName: string;
  system: string;
  user: string;
  schema: S;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  maxAttempts?: number;
  // Opt-in output escalation; ordinary consumers retain their existing limit.
  maxRetryTokens?: number;
  // Return findings for a parsed answer; empty means accepted.
  check?: (parsed: z.infer<S>) => Finding[];
  // Handed to the canned answer under AI_FAKE so a test double can echo real
  // ids and real quotes back; ignored on a real call.
  fakeContext?: unknown;
  stages: StageUsage[];
};

export type RunStructuredResult<T> = { data: T; attempts: number };

function findingsMessage(findings: Finding[]): string {
  const lines = findings.slice(0, 20).map((f) => `- ${f.path ? f.path + ": " : ""}${f.message}`);
  return `Your previous answer had these problems. Produce a corrected answer that fixes every one of them and keeps everything else unchanged:\n${lines.join("\n")}`;
}

export async function runStructured<S extends z.ZodType>(opts: RunStructuredOptions<S>): Promise<RunStructuredResult<z.infer<S>>> {
  const spec = ROLES[opts.role];
  if (fakeEnabled()) {
    const data = opts.schema.parse(fakeAnswer(opts.role, opts.fakeContext)) as z.infer<S>;
    const findings = opts.check ? opts.check(data) : [];
    if (findings.length > 0) throw new AiRejected(findings);
    opts.stages.push({ name: `${opts.stageName}_fake`, provider: spec.provider, model: "fake", usage: { input_tokens: 0, output_tokens: 0 } });
    return { data, attempts: 1 };
  }
  const client = getClient(spec.provider);
  const maxAttempts = Math.max(1, Math.min(3, opts.maxAttempts ?? 3));
  let maxTokens = opts.maxTokens ?? 16000;
  const retryCeiling = Math.max(maxTokens, Math.min(32000, opts.maxRetryTokens ?? maxTokens));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
  let lastFindings: Finding[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await client.messages.create({
      model: spec.model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium", format: zodOutputFormat(opts.schema) },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages,
    });
    opts.stages.push({
      name: attempt === 1 ? opts.stageName : `${opts.stageName}_retry_${attempt - 1}`,
      provider: spec.provider,
      model: spec.model,
      usage: response.usage,
      stop_reason: response.stop_reason,
    });

    if (response.stop_reason === "refusal") {
      throw new AiRefusal(response.stop_details?.category ?? null);
    }

    // Record usage before inspecting output: SDK parse() throws before the
    // caller can account for a malformed (but billed) answer.
    if (response.stop_reason === "max_tokens") {
      lastFindings = [{ path: "", message: "The answer was incomplete (stop_reason=max_tokens). Return the complete JSON object." }];
      maxTokens = Math.min(retryCeiling, maxTokens * 2);
    } else {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      let candidate: unknown;
      let validJson = true;
      try { candidate = JSON.parse(text); }
      catch { validJson = false; }
      if (!validJson) {
        lastFindings = [{ path: "", message: `The answer was not valid JSON (stop_reason=${response.stop_reason}). Return a complete JSON object.` }];
      } else {
        const parsed = opts.schema.safeParse(candidate);
        if (!parsed.success) {
          lastFindings = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
        } else {
          lastFindings = opts.check ? opts.check(parsed.data) : [];
          if (lastFindings.length === 0) return { data: parsed.data, attempts: attempt };
        }
      }
    }

    // Feed the findings back and try again with the model's own answer in
    // the transcript so it can repair rather than restart.
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: findingsMessage(lastFindings) });
  }
  throw new AiRejected(lastFindings);
}
