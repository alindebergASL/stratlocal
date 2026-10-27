// Does each provider answer, with the model we think it is using?
//
// This lived only in scripts/smoke-providers.mts, which runs through tsx — a
// devDependency that is not in the deployment image. So the first command the
// runbook gave you after deploying could not run on the thing you had just
// deployed. It lives here now, and both the script and a route call it.
//
// It is not only a first-day check. A Bedrock model id stops being available,
// an API key is rotated, the instance metadata hop limit gets reset by a
// rebuild — and every one of those reads, from a screen, as "the button is
// broken". This says which half.
import { z } from "zod";
import { explainProviderError, getClient, providerProblem } from "./client";
import { fakeEnabled } from "./fake";
import { ROLES, type Provider, type Role } from "./models";
import { BudgetError, finishRun, getRun, startRun } from "./guard";
import { estimateCostCents, type StageUsage } from "./cost";

export type ProviderCheck = {
  label: string;
  provider: Provider;
  model: string;
  status: "ok" | "skipped" | "failed";
  /** What it said back, when it said anything. */
  reply?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** The model id the provider reports, which is not always the one we asked for. */
  servedModel?: string;
  costCents?: number | null;
  estimated?: boolean;
  ms?: number;
  /** Why it was skipped, or how it failed. */
  message?: string;
};

// One line in, one word out. Small enough that the cost is a rounding error
// and large enough to prove the whole path — credentials, region, model
// access, and the response shape.
const PROMPT = "Reply with the single word OK.";
const MAX_TOKENS = 64;

const TARGETS: Array<{ label: string; role: Role; tools?: true }> = [
  { label: "Bedrock — everything carrying customer data", role: "import" },
  { label: "Anthropic API — web research only", role: "research" },
  // Ask is the one caller that sends tools. This sends every tool it has, as
  // it sends them, and has the model call one: proof that the provider takes
  // the schemas and the tool calls, before anyone asks a real question.
  { label: "Bedrock — Ask, streamed, with its tools", role: "ask", tools: true },
];

// What a provider gives back, narrowed to the parts this cares about. Both
// SDKs return a superset.
//
// Parsed rather than cast. This used to be `as unknown as Answer`, which reads
// as a narrowing and is really an assertion that the body has a shape nobody
// checked — so a surprising response threw three lines later, in the middle of
// building the result, after the run had already been recorded as a success
// with its real cost. See finishRun. Everything here is optional because the
// point is to fail at the seam with a sentence about the provider, not to
// impose a schema on an SDK that is free to add fields.
// All three are required, with no defaults, and that is the load-bearing part:
// both SDKs return all three on any successful message, so a body missing one
// is not an answer. Defaulting them would quietly turn an error envelope —
// {error: {type: "overloaded_error", ...}}, which is a real thing a provider
// returns — into a successful check reporting an empty reply.
const Answer = z
  .object({
    model: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().nullish() }).loose()),
    usage: z.looseObject({}),
  })
  .loose();

type Answer = { model: string; content: Array<{ type: string; text?: string | null }>; usage: StageUsage["usage"] };

// The call, injectable.
//
// This function's whole job happens on the far side of a real provider call,
// which means AI_FAKE=1 returns before reaching it — and AI_FAKE is what every
// test and every browser flow runs under. So the recording below was
// unreachable by construction, and shipped with a missing NOT NULL column that
// threw the first time it ever ran, which would have been the first press
// after the first deploy. This seam is how that becomes testable.
export type Ask = (provider: Provider, model: string, tools?: boolean) => Promise<Answer>;

const askProvider: Ask = async (provider, model, tools) => {
  if (!tools) {
    return (await getClient(provider).messages.create({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: PROMPT }],
    })) as unknown as Answer;
  }
  // Streamed, as Ask streams: on Bedrock that is its own permission
  // (InvokeModelWithResponseStream), and this is where its absence shows.
  const { askTools } = await import("../ask/run");
  const stream = getClient(provider).messages.stream({
    model,
    max_tokens: 256,
    tools: askTools() as Parameters<ReturnType<typeof getClient>["messages"]["create"]>[0]["tools"],
    // Opus 5.5 rejects forced tool/any choice. Match Ask's automatic mode;
    // the response below must still prove that final_answer was called.
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: 'Call final_answer with the text "OK" and no citations.' }],
  });
  return (await stream.finalMessage()) as unknown as Answer;
};

export async function checkProviders(actorUserId?: string | null, ask: Ask = askProvider): Promise<ProviderCheck[]> {
  const out: ProviderCheck[] = [];

  for (const t of TARGETS) {
    const spec = ROLES[t.role];
    const base = { label: t.label, provider: spec.provider, model: spec.model };

    // AI_FAKE makes providerProblem() return null, because fake mode exists so
    // every button works without credentials. That is right for the runs it
    // fakes and wrong here: this one exists to answer "does the real provider
    // answer", so under fake mode it would make a real call with no
    // credentials and report a failure that says nothing about the provider.
    if (fakeEnabled()) {
      out.push({ ...base, status: "skipped", message: "AI_FAKE=1, so no real call was made" });
      continue;
    }
    const problem = providerProblem(spec.provider);
    if (problem) {
      out.push({ ...base, status: "skipped", message: problem });
      continue;
    }

    // One run row per provider, through the same function every other model
    // call in this app goes through. The previous version wrote its own INSERT
    // and omitted `provider`, which is NOT NULL — the second hand-written
    // INSERT in a codebase is how that happens, so there is only one again.
    // It also means the cap applies: a check is cheap, but a diagnostic that
    // can spend past a budget is not one.
    let runId: string | null = null;
    if (actorUserId !== undefined) {
      try {
        runId = startRun({
          role: t.role,
          accountId: null,
          userId: actorUserId,
          kind: "provider_check",
          inputSummary: `provider check: ${spec.provider}`,
        }).id;
      } catch (e) {
        // A refused run is a real answer about whether you can use this
        // provider right now, so it is reported rather than swallowed.
        if (e instanceof BudgetError) {
          out.push({ ...base, status: "skipped", message: e.message });
          continue;
        }
        throw e;
      }
    }

    const started = Date.now();
    try {
      // Everything that can throw about the *response* happens before the run
      // is finished. It used to happen after, inside the same try, so a body
      // the code did not expect turned a call that was made and billed into a
      // recorded failure costing nothing.
      const parsed = Answer.safeParse(await ask(spec.provider, spec.model, t.tools));
      if (!parsed.success) throw new Error(`the provider answered with a shape this does not recognise: ${parsed.error.message.slice(0, 300)}`);
      const res = parsed.data as Answer;
      const called = res.content.find((b) => b.type === "tool_use") as { name?: unknown } | undefined;
      if (t.tools && called?.name !== "final_answer") throw new Error("the provider answered without calling the tool it was told to call: final_answer");
      const reply = called
        ? `called ${String(called.name)}`
        : res.content
            .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
            .join("")
            .trim();
      const stages: StageUsage[] = [{ name: "provider check", provider: spec.provider, model: spec.model, usage: res.usage }];

      if (runId) finishRun(runId, { stages });
      // The cost is read back off the row rather than computed twice, so the
      // number on the screen is the number counted against the cap — and
      // computed directly when there is no row, which is the CLI's case.
      // Coupling those two was how `npm run smoke:providers` came to print
      // "cost=unknown" for every successful check, against its own promise to
      // show what a trivial call costs.
      const row = runId ? getRun(runId) : null;
      const direct = row ? null : estimateCostCents(stages);
      out.push({
        ...base,
        status: "ok",
        servedModel: res.model,
        reply,
        inputTokens: res.usage.input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
        costCents: row ? row.cost_cents : (direct?.cents ?? null),
        estimated: row ? readEstimated(row.usage_json) : (direct?.estimated ?? false),
        ms: Date.now() - started,
      });
    } catch (e) {
      // Prefixed with what the failure actually means where this recognises
      // it: an AccessDenied that is really a model ARN for the wrong region,
      // a credentials timeout that is really the IMDSv2 hop limit. This
      // button is the first thing pressed after a deploy and the sentence it
      // shows is the whole of the diagnosis.
      const message = explainProviderError(e);
      if (runId) finishRun(runId, { stages: [], error: message.slice(0, 2000) });
      out.push({ ...base, status: "failed", ms: Date.now() - started, message });
    }
  }

  return out;
}

function readEstimated(usageJson: string | null | undefined): boolean {
  if (!usageJson) return false;
  try {
    return (JSON.parse(usageJson) as { cost_estimated?: boolean | null }).cost_estimated === true;
  } catch {
    return false;
  }
}
