// The provider check, and the run it records.
//
// This file exists because the recording half was unreachable. checkProviders
// returns early under AI_FAKE=1, every test and every browser flow runs under
// AI_FAKE=1, and the only path that reaches the write is a real provider call
// — which has never been made. So it shipped with an INSERT that omitted
// `provider`, a NOT NULL column, and would have thrown
// "NOT NULL constraint failed: ai_runs.provider" the first time it worked:
// the first press of the button, after the first deploy, which is the exact
// moment it was built for.
//
// The seam is `ask`, so the far side of the call can be stood up here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDbForTests, type AiRunRow } from "@/lib/db";
import { checkProviders, type Ask } from "@/lib/ai/smoke";
import { finishRun, startRun, todaySpend } from "@/lib/ai/guard";
import { ROLES } from "@/lib/ai/models";

const USER = "user-1";

// A reply shaped like both SDKs return.
// Ask's check is told to call a tool, and does.
const answers: Ask = async (provider, model, tools) => ({
  model: provider === "bedrock" ? `${model}-v1:0` : model,
  content: tools ? [{ type: "tool_use", name: "final_answer" }] : [{ type: "text", text: "OK" }],
  usage: { input_tokens: 14, output_tokens: 3 },
});

const refuses: Ask = async () => {
  throw Object.assign(new Error("The security token included in the request is invalid"), { name: "UnrecognizedClientException" });
};

function runs(): AiRunRow[] {
  return db().prepare(`SELECT * FROM ai_runs ORDER BY started_at, id`).all() as AiRunRow[];
}

beforeEach(() => {
  resetDbForTests();
  // Both providers configured, and fake mode off — which is the only state in
  // which any of this code runs.
  vi.stubEnv("AI_FAKE", "");
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-not-a-real-key");
  return () => vi.unstubAllEnvs();
});

describe("asking each provider whether it answers", () => {
  it("records one run per provider, not one for both", async () => {
    const checks = await checkProviders(USER, answers);
    expect(checks.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);

    const rows = runs();
    expect(rows).toHaveLength(3);
    // The column is singular, so the row has to be. Writing one row for both
    // was the other half of the original mistake: a cost that cannot be
    // attributed and a provider that cannot be named.
    expect(rows.map((r) => r.provider).sort()).toEqual(["bedrock", "bedrock", "direct"]);
    for (const r of rows) {
      expect(r.provider).toBeTruthy();
      expect(r.kind).toBe("provider_check");
      expect(r.status).toBe("done");
      expect(r.account_id).toBeNull();
      expect(r.created_by).toBe(USER);
      expect(r.finished_at).not.toBeNull();
    }
  });

  it("reports the model the provider served, not the one we asked for", async () => {
    // An inference profile prefix or a dated id resolves to something else,
    // and that difference is exactly what the price table then fails to match.
    const checks = await checkProviders(USER, answers);
    expect(checks[0]?.servedModel).toMatch(/-v1:0$/);
    expect(checks[0]?.servedModel).not.toBe(checks[0]?.model);
  });

  it("counts against the day's spend like every other call", async () => {
    // "Nearly free" is how a budget stops being one. Two calls of seventeen
    // tokens are a rounding error; a diagnostic nobody counts is not.
    expect(todaySpend().runs).toBe(0);
    await checkProviders(USER, answers);
    expect(todaySpend().runs).toBe(3);
  });

  it("records a failed provider as a failed run, with what it said", async () => {
    const checks = await checkProviders(USER, refuses);
    expect(checks.map((c) => c.status)).toEqual(["failed", "failed", "failed"]);
    expect(checks[0]?.message).toContain("UnrecognizedClientException");

    const rows = runs();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe("failed");
      expect(r.provider).toBeTruthy();
      expect(r.error).toContain("UnrecognizedClientException");
    }
  });

  it("writes nothing when nobody is asking", async () => {
    // The CLI script runs outside the app, often against a different database,
    // so a run row with no user attached would be a lie about who spent it.
    const checks = await checkProviders(undefined, answers);
    expect(checks.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
    expect(runs()).toHaveLength(0);
  });
});

describe("when there is nothing to ask", () => {
  it("says so rather than calling, under fake mode", async () => {
    vi.stubEnv("AI_FAKE", "1");
    const called = vi.fn();
    const checks = await checkProviders(USER, async (...args) => {
      called();
      return answers(...args);
    });
    expect(called).not.toHaveBeenCalled();
    expect(checks.every((c) => c.status === "skipped")).toBe(true);
    expect(checks[0]?.message).toMatch(/AI_FAKE/);
    expect(runs()).toHaveLength(0);
  });

  it("names the missing credential rather than failing on the call", async () => {
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_DEFAULT_REGION", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const checks = await checkProviders(USER, answers);
    expect(checks.map((c) => c.status)).toEqual(["skipped", "skipped", "skipped"]);
    expect(checks[0]?.message).toMatch(/AWS_REGION/);
    expect(checks[1]?.message).toMatch(/ANTHROPIC_API_KEY/);
    expect(runs()).toHaveLength(0);
  });

  it("stands down when the day's budget is gone, and says which", async () => {
    // A diagnostic that can spend past the cap is not a diagnostic. Going
    // through startRun is what makes this true rather than remembered.
    //
    // Zero is a real cap now. It used to fall back to the $15 default, because
    // the parse could not tell a deliberate 0 from an empty variable — so the
    // obvious way to say "spend nothing today" quietly spent fifteen dollars.
    vi.stubEnv("AI_DAILY_CAP_CENTS", "0");
    const checks = await checkProviders(USER, answers);
    expect(checks.every((c) => c.status === "skipped")).toBe(true);
    expect(checks[0]?.message).toMatch(/budget/i);
    expect(runs()).toHaveLength(0);
  });
});

describe("a call that was made and billed", () => {
  // The failure this guards is invisible from every screen and costs real
  // money: finishRun was an unconditional UPDATE, and the success path went on
  // building its result *after* calling it. `askProvider` cast the response
  // rather than parsing it, so a body the code did not expect threw a few
  // lines later, the catch called finishRun a second time with no stages, and
  // estimateCostCents([]) is {cents: 0} — its loop never runs — so the row
  // landed as a failure that cost nothing. The money was spent. todaySpend()
  // under-counted it permanently, and it did not even register as unpriced,
  // because 0 is not NULL.
  const malformed: Ask = async () =>
    // A real shape a provider can return: an error envelope rather than a
    // message. Not nonsense — the point is that it is plausible.
    ({ error: { type: "overloaded_error", message: "Overloaded" } }) as never;

  const wrongContent: Ask = async (provider, model) =>
    // The specific thing that used to throw: content is not an array, so
    // .map() on it is a TypeError three lines past the recording.
    ({ model, content: "OK", usage: { input_tokens: 14, output_tokens: 3 } }) as never;

  it.each([
    ["an error envelope", malformed],
    ["content that is not a list", wrongContent],
  ])("is never recorded as a free failure when the response is %s", async (_label, ask) => {
    const checks = await checkProviders(USER, ask);
    // It failed, and it says so — the response really was not usable.
    expect(checks.map((c) => c.status)).toEqual(["failed", "failed", "failed"]);
    for (const c of checks) expect(c.message).toBeTruthy();

    // And each run is recorded exactly once, as failed, with no cost invented
    // for it. What must never happen is a row that says `done` with a real
    // cost and is then overwritten to `failed` at zero.
    const rows = runs();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe("failed");
      expect(r.finished_at).toBeTruthy();
    }
  });

  it("keeps the cost of a success even if finishing is attempted twice", () => {
    // Directly, because the ordering fix above means checkProviders can no
    // longer reach a double-finish — and the guard has to hold for every other
    // caller too, not just the one that found it.
    const run = startRun({ role: "import", accountId: null, userId: USER, kind: "provider_check" });
    const stages = [
      { name: "provider check", provider: "bedrock" as const, model: ROLES.import.model, usage: { input_tokens: 14, output_tokens: 3 } },
    ];
    expect(finishRun(run.id, { stages })).toBe(true);
    const done = runs()[0]!;
    expect(done.status).toBe("done");

    // The second call does nothing and reports that it did nothing.
    expect(finishRun(run.id, { stages: [], error: "TypeError: res.content.map is not a function" })).toBe(false);
    const after = runs()[0]!;
    expect(after.status).toBe("done");
    expect(after.cost_cents).toBe(done.cost_cents);
    expect(after.error).toBeNull();
  });

  it("reports what a check cost even with no run row to read it from", async () => {
    // `npm run smoke:providers` passes no actor, so no row is written — and
    // reading the cost back off the row coupled "do not record" to "do not
    // know", so the script printed "cost=unknown" for every successful check
    // against its own promise to show what a trivial call costs.
    const checks = await checkProviders(undefined, answers);
    expect(checks.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
    expect(runs()).toHaveLength(0);
    for (const c of checks) expect(typeof c.costCents === "number" || c.costCents === null).toBe(true);
    // Bedrock has no published rates this app can read, so its price is
    // genuinely unknown and null is the honest answer there. The direct API
    // is priced, and that one must produce a number.
    expect(checks[1]?.costCents).toBeTypeOf("number");
  });
});

describe("Ask's check", () => {
  it("fails when the model answers without calling the tool it was told to", async () => {
    const noTool: Ask = async (provider, model) => ({ model, content: [{ type: "text", text: "OK" }], usage: { input_tokens: 1, output_tokens: 1 } });
    const checks = await checkProviders(USER, noTool);
    expect(checks.find((c) => c.label.includes("Ask"))).toMatchObject({ status: "failed", message: expect.stringMatching(/without calling the tool/) });
  });

  it("says which tool it called", async () => {
    const checks = await checkProviders(USER, answers);
    expect(checks.find((c) => c.label.includes("Ask"))?.reply).toBe("called final_answer");
  });
});
