// SYNTHETIC ONLY: in-memory SQLite and a mocked streaming provider; no network.
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as client from "@/lib/ai/client";
import { db } from "@/lib/db";
import { getRun } from "@/lib/ai/guard";
import { startAsk } from "@/lib/ask/run";
import { createThread, listMessages } from "@/lib/ask/threads";
import { createReport, getReport } from "@/lib/ask/report";
import { CitableSet, runReadTool, type ToolContext, type ReadToolName } from "@/lib/ask/tools";
import { AskReadState } from "@/lib/ask/writeContext";
import { computeCharts, type ChartSpec } from "@/lib/ask/charts";
import { applyEntityChange } from "@/lib/proposals/apply";
import { seedAccount, USER } from "./helpers";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const now = () => new Date();
function context(accountId: string | null = null): ToolContext {
  const thread = createThread({ accountId, question: "Synthetic chart scope", userId: USER, saved: true });
  const ctx: ToolContext = { accountId, threadId: thread.id, userId: USER, now: now(), cites: new CitableSet(), runId: null, batches: [] };
  ctx.readState = new AskReadState(ctx);
  return ctx;
}
function fixtures() {
  const a = seedAccount();
  const b = seedAccount({ name: "Synthetic Other Lab", dealId: "SYN-CHART-B" });
  db().prepare("UPDATE deals SET tcv_usd = 9000 WHERE deal_id = ?").run(b.dealId);
  return { a, b };
}
function report(ctx: ToolContext, accountId: string | undefined, chart: ChartSpec) {
  const out = createReport({ title: "Synthetic scope", account_id: accountId, sections: [{ heading: "Pipeline", body: "Synthetic chart.", chart }], citations: [] }, ctx);
  return getReport(out.docId)!;
}
const sum = (chart: ReturnType<typeof computeCharts>[number]) => chart.rows.reduce((n, r) => n + r.value, 0);

it("does not persist unread B's pipeline inside an A report", () => {
  const { a, b } = fixtures(); const ctx = context(a.accountId);
  runReadTool("account", { account_id: a.accountId }, ctx);
  expect(report(ctx, a.accountId, { kind: "stage_mix", account_id: b.accountId }).report.sections[0]!.chart).toBeUndefined();
});
it("an A report's omitted chart scope defaults to A, not the portfolio", () => {
  const { a } = fixtures(); const ctx = context();
  runReadTool("account", { account_id: a.accountId }, ctx);
  const stored = report(ctx, a.accountId, { kind: "pipeline_by_quarter" });
  expect(stored.doc.account_id).toBe(a.accountId);
  expect(sum(stored.report.sections[0]!.chart!)).toBe(1000);
});
it("a report account is a boundary even when B was also read", () => {
  const { a, b } = fixtures(); const ctx = context();
  for (const id of [a.accountId, b.accountId]) runReadTool("account", { account_id: id }, ctx);
  expect(report(ctx, a.accountId, { kind: "account_comparison", account_id: b.accountId }).report.sections[0]!.chart).toBeUndefined();
});
it.each(["", " ", "SYN-MISSING"])("invalid explicit chart id %j never becomes a portfolio query", (id) => {
  fixtures(); const ctx = context(); runReadTool("pipeline", {}, ctx);
  expect(report(ctx, undefined, { kind: "stage_mix", account_id: id }).report.sections[0]!.chart).toBeUndefined();
  expect(computeCharts([{ kind: "stage_mix", account_id: id }], ctx)).toEqual([]);
});
it.each(["", " ", "SYN-MISSING"])("invalid explicit report id %j cannot widen chart scope", (id) => {
  fixtures(); const ctx = context(); runReadTool("pipeline", {}, ctx);
  expect(() => report(ctx, id, { kind: "stage_mix" })).toThrow();
});
it("an account citation from search is not evidence for its entire pipeline", () => {
  const { a } = fixtures(); const ctx = context(); runReadTool("search", { query: "Synthetic Orchard", kind: "account" }, ctx);
  expect(ctx.cites.get("account", a.accountId)).toBeDefined();
  expect(computeCharts([{ kind: "stage_mix", account_id: a.accountId }], ctx)).toEqual([]);
});
it("a narrow account read cannot authorize an omitted portfolio chart", () => {
  const { a } = fixtures(); const ctx = context(); runReadTool("account", { account_id: a.accountId }, ctx);
  expect(report(ctx, undefined, { kind: "account_comparison" }).report.sections[0]!.chart).toBeUndefined();
});
it.each([{ stage: 3 }, { quarter: "FY27 Q3" }, { owner: "Synthetic Owner" }, { status: "won" }])("filtered pipeline %j cannot authorize an unfiltered chart", (filter) => {
  fixtures(); const ctx = context(); runReadTool("pipeline", filter, ctx);
  expect(computeCharts([{ kind: "stage_mix" }], ctx)).toEqual([]);
});
it("an exact aggregate pipeline read authorizes the whole portfolio beyond the 25 shown deals", () => {
  const { a } = fixtures();
  for (let i = 0; i < 28; i++) applyEntityChange({ accountId: a.accountId, entityType: "deal", op: "create", payload: { deal_id: `SYN-EXTRA-${i}`, name: `Synthetic extra ${i}`, stage: 3, tcv_usd: 1 }, actorUserId: USER });
  const ctx = context(); const read = JSON.parse(runReadTool("pipeline", {}, ctx).content);
  expect(read.more).toBeGreaterThan(0); expect(ctx.cites.size).toBe(25);
  expect(sum(report(ctx, undefined, { kind: "account_comparison" }).report.sections[0]!.chart!)).toBe(10028);
});
it("account reads and complete account aggregate lists retain pipeline charts", () => {
  const { a } = fixtures(); const ctx = context(a.accountId); runReadTool("account", { account_id: a.accountId }, ctx);
  expect(sum(computeCharts([{ kind: "stage_mix" }], ctx)[0]!)).toBe(1000);
  const portfolio = context(); runReadTool("accounts", {}, portfolio);
  expect(sum(computeCharts([{ kind: "account_comparison" }], portfolio)[0]!)).toBe(10000);
});
it("owner-filtered account aggregates cannot widen to all accounts", () => {
  const { a } = fixtures(); db().prepare("UPDATE accounts SET owner_user_id = ? WHERE id = ?").run(USER, a.accountId);
  const ctx = context(); runReadTool("accounts", { owner: "mine" }, ctx);
  expect(sum(computeCharts([{ kind: "stage_mix", whose: "mine" }], ctx)[0]!)).toBe(1000);
  expect(computeCharts([{ kind: "stage_mix" }], ctx)).toEqual([]);
});
it("movement needs its own exact window and scope, not a pipeline read", () => {
  const { a } = fixtures(); const ctx = context(); runReadTool("pipeline", {}, ctx);
  expect(computeCharts([{ kind: "movement" }], ctx)).toEqual([]);
  runReadTool("what_moved", { days: 7, account_id: a.accountId }, ctx);
  expect(computeCharts([{ kind: "movement", account_id: a.accountId }], ctx)).toHaveLength(1);
  expect(computeCharts([{ kind: "movement", days: 30, account_id: a.accountId }, { kind: "movement" }], ctx)).toEqual([]);
});
it("pipeline changes after a read do not get silently pulled into the chart, even after rereading", () => {
  const { b } = fixtures(); const ctx = context(); runReadTool("pipeline", {}, ctx);
  db().prepare("UPDATE deals SET tcv_usd = 88888 WHERE deal_id = ?").run(b.dealId);
  runReadTool("pipeline", {}, ctx);
  expect(computeCharts([{ kind: "stage_mix" }], ctx)).toEqual([]);
});
it("moving a hidden aggregate member away and back invalidates its chart evidence", () => {
  const { a, b } = fixtures();
  for (let i = 0; i < 26; i++) applyEntityChange({ accountId: a.accountId, entityType: "deal", op: "create", payload: { deal_id: `SYN-LARGE-${i}`, name: `Synthetic ${i}`, stage: 3, tcv_usd: 20000 }, actorUserId: USER });
  const ctx = context(); runReadTool("pipeline", {}, ctx); expect(ctx.cites.get("deal", b.dealId)).toBeUndefined();
  for (const [from, to] of [[b.accountId, a.accountId], [a.accountId, b.accountId]]) {
    db().prepare("UPDATE deals SET account_id = ? WHERE deal_id = ?").run(to, b.dealId);
    db().prepare("INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at) VALUES (?, ?, 'deal', ?, 'account_id', ?, ?, ?, ?)").run(randomUUID(), to, b.dealId, JSON.stringify(from), JSON.stringify(to), USER, Date.now());
  }
  expect(computeCharts([{ kind: "stage_mix" }], ctx)).toEqual([]);
});
it.each(["archive", "merge", "move", "new"])("%s after reading invalidates chart scope", (change) => {
  const { a, b } = fixtures(); const ctx = context(a.accountId); runReadTool("account", { account_id: a.accountId }, ctx);
  if (change === "archive") db().prepare("UPDATE accounts SET archived_at = 1 WHERE id = ?").run(a.accountId);
  if (change === "merge") db().prepare("UPDATE accounts SET merged_into = ? WHERE id = ?").run(b.accountId, a.accountId);
  if (change === "move") db().prepare("UPDATE deals SET account_id = ? WHERE deal_id = ?").run(a.accountId, b.dealId);
  if (change === "new") applyEntityChange({ accountId: a.accountId, entityType: "deal", op: "create", payload: { deal_id: "SYN-NEW", name: "Synthetic new", tcv_usd: 1 }, actorUserId: USER });
  expect(computeCharts([{ kind: "stage_mix" }], ctx)).toEqual([]);
});
it("evidence from a previous turn does not authorize the next turn", () => {
  const { a } = fixtures(); const prior = context(a.accountId); runReadTool("account", { account_id: a.accountId }, prior);
  const next = { ...prior, cites: new CitableSet(), readState: new AskReadState(prior) };
  expect(computeCharts([{ kind: "stage_mix" }], next)).toEqual([]);
});

it("a capped accounts list does not prove a portfolio or an unshown account", () => {
  const { a } = fixtures();
  for (let i = 0; i < 60; i++) applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: `Synthetic capped ${i}` }, actorUserId: USER });
  const ctx = context(); const read = JSON.parse(runReadTool("accounts", {}, ctx).content);
  expect(read.more).toBeGreaterThan(0);
  const hidden = (db().prepare("SELECT id FROM accounts WHERE kind = 'customer'").all() as Array<{ id: string }>).find((r) => !ctx.cites.get("account", r.id))!;
  expect(computeCharts([{ kind: "account_comparison" }, { kind: "stage_mix", account_id: hidden.id }], ctx)).toEqual([]);
  expect(sum(computeCharts([{ kind: "stage_mix", account_id: a.accountId }], ctx)[0]!)).toBe(1000);
});
it("an exact movement query covers its capped rows without inventing citations", () => {
  const { a } = fixtures();
  for (let i = 0; i < 28; i++) applyEntityChange({ accountId: a.accountId, entityType: "deal", op: "create", payload: { deal_id: `SYN-MOVE-${i}`, name: `Synthetic movement ${i}`, stage: 3, tcv_usd: 1 }, actorUserId: USER });
  const ctx = context(); const read = JSON.parse(runReadTool("what_moved", { days: 7 }, ctx).content);
  expect(read.more_moves).toBeGreaterThan(0);
  expect(sum(computeCharts([{ kind: "movement", days: 7 }], ctx)[0]!)).toBe(30);
  expect(ctx.cites.size).toBe(25);
});
it.each(["pipeline", "what_moved"] as const)("%s with an explicit empty id does not grant portfolio evidence", (name) => {
  fixtures(); const ctx = context(); runReadTool(name, { account_id: "" }, ctx);
  expect(computeCharts([{ kind: name === "pipeline" ? "stage_mix" : "movement" }], ctx)).toEqual([]);
});
it("an empty exact query can draw an empty chart without a record citation", () => {
  const ctx = context(); runReadTool("pipeline", {}, ctx);
  expect(ctx.cites.size).toBe(0);
  expect(computeCharts([{ kind: "stage_mix" }], ctx)).toMatchObject([{ rows: [], note: "No open deals." }]);
});
it("an owner change after an aggregate read cannot silently change whose chart it is", () => {
  const { a } = fixtures(); db().prepare("UPDATE accounts SET owner_user_id = ? WHERE id = ?").run(USER, a.accountId);
  const ctx = context(); runReadTool("accounts", { owner: "mine" }, ctx);
  db().prepare("UPDATE accounts SET owner_user_id = NULL WHERE id = ?").run(a.accountId);
  expect(computeCharts([{ kind: "stage_mix", whose: "mine" }], ctx)).toEqual([]);
});
it("a movement change after its query cannot silently enter a report", () => {
  const { a } = fixtures(); const ctx = context(); runReadTool("what_moved", {}, ctx);
  applyEntityChange({ accountId: a.accountId, entityType: "deal", op: "create", payload: { deal_id: "SYN-NEW-MOVE", name: "Synthetic new movement", stage: 3 }, actorUserId: USER });
  expect(report(ctx, undefined, { kind: "movement" }).report.sections[0]!.chart).toBeUndefined();
});
it("a deliberately portfolio report remains possible from an account conversation after a portfolio read", () => {
  const { a } = fixtures(); const ctx = context(a.accountId); runReadTool("pipeline", {}, ctx);
  const stored = report(ctx, undefined, { kind: "account_comparison" });
  expect(stored.report.accountName).toBeNull();
  expect(sum(stored.report.sections[0]!.chart!)).toBe(10000);
});

async function answerCharts(accountId: string | null, reads: Array<{ name: ReadToolName; input: unknown }>, charts: ChartSpec[], mutate?: () => void) {
  vi.stubEnv("AI_FAKE", ""); vi.stubEnv("AWS_REGION", "us-west-2");
  let round = 0;
  const stream = vi.fn(() => ({ on: vi.fn(), finalMessage: async () => {
    const read = reads[round++]; if (!read) mutate?.();
    return { content: [{ type: "tool_use", id: `synthetic-${round}`, ...(read ?? { name: "final_answer", input: { text: "Synthetic chart.", citations: [], charts } }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "tool_use" };
  } }));
  vi.spyOn(client, "getClient").mockReturnValue({ messages: { stream } } as unknown as ReturnType<typeof client.getClient>);
  const run = startAsk({ userId: USER, accountId, question: "Compare synthetic pipeline" });
  await vi.waitFor(() => expect(getRun(run.runId)?.status).toBe("done"));
  return listMessages(run.threadId)[1]!.charts;
}
it("the production answer callsite drops unread explicit B and defaults omitted scope to its account", async () => {
  const { a, b } = fixtures();
  const charts = await answerCharts(a.accountId, [{ name: "account", input: { account_id: a.accountId } }], [{ kind: "stage_mix", account_id: b.accountId }, { kind: "stage_mix" }]);
  expect(charts).toHaveLength(1); expect(sum(charts[0]!)).toBe(1000);
});
it("the production answer callsite keeps an intentional portfolio query", async () => {
  fixtures(); const charts = await answerCharts(null, [{ name: "pipeline", input: {} }], [{ kind: "account_comparison" }]);
  expect(sum(charts[0]!)).toBe(10000);
});
it("an answer may explicitly discuss a different account after reading that exact scope", async () => {
  const { a, b } = fixtures();
  const charts = await answerCharts(a.accountId, [{ name: "account", input: { account_id: b.accountId } }], [{ kind: "stage_mix", account_id: b.accountId }]);
  expect(sum(charts[0]!)).toBe(9000);
});
it("the production answer callsite rejects a thread moved while the provider is away", async () => {
  const { a, b } = fixtures();
  const charts = await answerCharts(a.accountId, [{ name: "account", input: { account_id: a.accountId } }], [{ kind: "stage_mix" }], () => {
    db().prepare("UPDATE ask_threads SET account_id = ?").run(b.accountId);
  });
  expect(charts).toEqual([]);
});
it("the production answer callsite rejects stale chart data", async () => {
  const { a } = fixtures();
  expect(await answerCharts(a.accountId, [{ name: "account", input: { account_id: a.accountId } }], [{ kind: "stage_mix" }], () => { db().prepare("UPDATE deals SET tcv_usd = 2 WHERE deal_id = ?").run(a.dealId); })).toEqual([]);
});
