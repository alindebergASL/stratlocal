// Ask: a question, an agent that looks things up, an answer with sources.
//
// The model calls read-only tools (lib/ask/tools.ts) as many times as it
// needs, then answers through `final_answer` with numbered citations. Every
// citation must be a record a tool returned in this turn — checked here, in
// code, with one chance to repair; what still cannot be checked is dropped and
// the answer says so. It runs on Bedrock like every call that carries account
// data, under the same budget and run record as everything else, and it never
// writes a record (DECISIONS #1, #3, #52).
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "../db";
import { getClient } from "../ai/client";
import type { StageUsage } from "../ai/cost";
import { fakeEnabled } from "../ai/fake";
import { BudgetError, runDetached, startRun } from "../ai/guard";
import { ROLES } from "../ai/models";
import { UNTRUSTED_RULES } from "../ai/prompts";
import { AiRefusal } from "../ai/runStructured";
import { currentFiscalQuarter } from "../fiscal";
import { todayISO } from "../clock";
import { getAccount } from "../queries/accounts";
import { directionForPrompt, withDirection } from "../teamDirection";
import { addMessage, createThread, getThread, listMessages, type AskCitation } from "./threads";
import { ApplyError } from "../proposals/apply";
import { checkAnswer } from "./check";
import { readPartialText } from "./draft";
import type { AssistantId } from "../assistants/registry";
import { ChartSpec, computeCharts } from "./charts";
import { getTemplate, templatePrompt, type AskTemplate } from "./templates";
import { resolveFocus, type AskFocus } from "./focus";
import { CreateReport, createReport, REPORT_DESCRIPTION } from "./report";
export { checkAnswer };
import { ProposeChanges, PROPOSE_DESCRIPTION, proposeChanges } from "./propose";
import { CitableSet, isReadTool, runReadTool, toolDefinitions, type ReadToolName, type ToolContext } from "./tools";
import { AskReadState } from "./writeContext";
import { WEB_DESCRIPTION, WebResearch, WebToolError, webResearch } from "./webTool";
import { DRAFT_EMAIL_DESCRIPTION, DraftEmail, draftEmail } from "./draftEmail";

// A question's allowance: tool rounds, and tokens across the whole turn.
export const MAX_ROUNDS = 10;
export const MAX_TURN_TOKENS = 600_000;
const HISTORY = 10;

const CITE_KINDS = ["account", "deal", "play", "contact", "meeting", "action_item", "research", "document", "web"] as const;
export const FinalAnswer = z.object({
  text: z.string().min(1).max(20_000).describe("The answer, in plain sentences with simple markdown (headings, lists, bold, tables). Put [n] after each claim that rests on a record."),
  citations: z
    .array(z.object({ n: z.number().int().min(1), kind: z.enum(CITE_KINDS), id: z.string().min(1) }))
    .max(80)
    .describe("One entry per [n] marker: the kind and id of the record it rests on, exactly as a tool returned it."),
  follow_ups: z
    .array(z.string().min(3).max(140))
    .max(3)
    .optional()
    .describe("Two or three short questions worth asking next, in the seller's words, that the records you saw could answer."),
  charts: z
    .array(ChartSpec)
    .max(2)
    .optional()
    .describe("Up to two charts to draw under the answer when a picture helps (comparing quarters, stages, accounts, or what moved). Name the kind and scope only: the app computes the numbers."),
});

/** Suggested questions, kept to one short line each. */
export function cleanFollowUps(raw: string[] | undefined): string[] {
  return [...new Set((raw ?? []).map((q) => q.replace(/\s+/g, " ").trim().slice(0, 140)).filter((q) => q.length >= 3))].slice(0, 3);
}
export type FinalAnswer = z.infer<typeof FinalAnswer>;

const SYSTEM = `You answer questions from two sellers about their own accounts, pipeline, people, meetings, follow-ups and research, using the tools you are given. You are their analyst: direct, specific, numbers first, no filler.

How to work:
- Look things up before answering. Use as many tool calls as the question needs, and no more. Prefer one broad call (pipeline, what_moved, accounts) over many narrow ones.
- Answer only from what the tools returned in this conversation turn. If the records do not say, say that plainly — never guess, never use outside knowledge about these companies.
- When the person asks for something public the records cannot answer (recent news, announcements, leadership, budgets, programmes), you may call web_research once for that account. What it finds is unreviewed: cite it as kind "web", say it is from the web and not yet reviewed, and propose nothing from it.
- Every claim that rests on a record carries a marker [n], and final_answer lists each n with the kind and id of that record exactly as a tool returned it. Do not cite a record you were not shown.
- Money in US dollars, rounded sensibly ($1.2M, $350K). Dates as written in the records. Fiscal quarters as "FY27 Q2".
- When comparing quarters, stages, accounts or what moved, add a chart (final_answer charts, or a report section's chart). Name the kind and scope; never put numbers in a chart request — the app computes them.
- Read the chart's scope this turn: account or an unfiltered pipeline for open-pipeline charts; what_moved with the same account and days for movement. A complete accounts list also supports pipeline charts for that owner scope. Search hits or filtered deal lists alone do not cover an entire pipeline. Account report charts stay on the report's account; omitted answer chart accounts default to this conversation's account.
- Keep it short: lead with the answer, then the few supporting points. Use a short table when comparing more than three deals or accounts.
- Write in plain markdown: short paragraphs, "-" lists, **bold**, "|" tables, "##" headings when the answer has parts. No links, no HTML, no images — sources are the [n] markers.
- When asked to change, add or update something, file it with propose_changes — one call per account, only records you were shown — and say in the answer what you proposed and that it waits on the account's review page. Never say a change was made.
- When asked to write, draft or send an email to someone on an account, read the account, then call draft_email once, addressed only to contacts you read. You never send: say a draft is waiting in the Inbox under To send.
- When asked for a report, a write-up or something to send, look up what it needs, then call create_report once — sections with headings, [n] markers cited like an answer — and answer in a sentence or two that it is ready.
- In final_answer, add two or three follow_ups: short next questions the seller is likely to ask, that the records could answer.
- Finish by calling final_answer. Never answer in plain text outside it.

${UNTRUSTED_RULES}`;

function systemPrompt(accountId: string | null, now: Date, focus: AskFocus | null = null, template: AskTemplate | null = null): string {
  const q = currentFiscalQuarter(now);
  const account = accountId ? getAccount(accountId) : null;
  const about = resolveFocus(focus, accountId);
  const scope = about
    ? `\n\n${about.prompt}`
    : account
      ? `\n\nThis conversation was started on the account "${account.name}" (account_id ${account.id}). Questions are about it unless they say otherwise; read it with the account tool first.`
      : "";
  const report = template ? `\n\n${templatePrompt(template)}` : "";
  return withDirection(`${SYSTEM}\n\nToday is ${todayISO(now)}; the current fiscal quarter is ${q.label}.${scope}${report}`, directionForPrompt());
}

export type AskResult = { threadId: string; messageId: string | null; steps: string[]; dropped: number };

/** Keep the citations that check out, drop the rest and their markers. */
function settle(answer: FinalAnswer, cites: CitableSet): { text: string; citations: AskCitation[]; dropped: number } {
  const good = answer.citations.filter((c) => cites.get(c.kind, c.id));
  const goodN = new Set(good.map((c) => c.n));
  const dropped = answer.citations.length - good.length;
  let text = answer.text.replace(/\[(\d{1,3})\]/g, (m, n) => (goodN.has(Number(n)) ? m : ""));
  if (dropped) text += `\n\n_${dropped} source${dropped === 1 ? "" : "s"} could not be checked against the records and ${dropped === 1 ? "was" : "were"} removed._`;
  const citations = good.map((c) => {
    const known = cites.get(c.kind, c.id)!;
    return { n: c.n, kind: c.kind, id: c.id, accountId: known.accountId, label: known.label };
  });
  return { text, citations, dropped };
}

/** Steps so far, and the answer while it is being written. */
type Progress = (steps: string[], draft?: string | null) => void;

// How often the answer-in-progress is written to the run for the page to read.
const DRAFT_EVERY_MS = 400;

/** Every tool Ask is given, exactly as sent — also what Check providers sends (lib/ai/smoke.ts). */
export function askTools() {
  return toolDefinitions([
    { name: "web_research", description: WEB_DESCRIPTION, schema: WebResearch },
    { name: "draft_email", description: DRAFT_EMAIL_DESCRIPTION, schema: DraftEmail },
    { name: "propose_changes", description: PROPOSE_DESCRIPTION, schema: ProposeChanges },
    { name: "create_report", description: REPORT_DESCRIPTION, schema: CreateReport },
    { name: "final_answer", description: "Give your answer, with its citations. Call this exactly once, last.", schema: FinalAnswer },
  ]);
}

/** A focus informs the prompt before any tool runs. Keep its first ownership
 * observation authoritative through every continuation and final write. */
function assertFocusedContext(ctx: ToolContext): void {
  if (ctx.focus) {
    if (!ctx.readState) throw new ApplyError("Ask context is unavailable. Start a new question.", "conflict");
    ctx.readState.assertWritable(ctx, ctx.accountId);
  }
}

/** One turn of the loop, against the real model. */
async function loop(opts: { question: string; history: Anthropic.MessageParam[]; ctx: ToolContext; stages: StageUsage[]; progress: Progress }): Promise<{ answer: FinalAnswer; steps: string[] }> {
  const spec = ROLES.ask;
  const client = getClient(spec.provider);
  const tools = askTools();
  const messages: Anthropic.MessageParam[] = [...opts.history, { role: "user", content: opts.question }];
  const steps: string[] = [];
  let repaired = false;
  let tokens = 0;

  for (let round = 0; round < MAX_ROUNDS + 2; round++) {
    assertFocusedContext(opts.ctx);
    // Streamed, so the answer can be shown while it is written: the
    // final_answer call's input arrives as JSON in pieces, and its text is
    // read out of the unfinished JSON (lib/ask/draft.ts).
    const stream = client.messages.stream({
      model: spec.model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: systemPrompt(opts.ctx.accountId, opts.ctx.now, opts.ctx.focus ?? null, opts.ctx.template ?? null), cache_control: { type: "ephemeral" } }],
      tools: tools as Anthropic.Tool[],
      messages,
    });
    let answering: number | null = null;
    let partial = "";
    let lastDraft = 0;
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use" && event.content_block.name === "final_answer") {
        answering = event.index;
        partial = "";
      } else if (event.type === "content_block_delta" && event.index === answering && event.delta.type === "input_json_delta") {
        partial += event.delta.partial_json;
        const now = Date.now();
        if (now - lastDraft >= DRAFT_EVERY_MS) {
          lastDraft = now;
          const draft = readPartialText(partial);
          if (draft) opts.progress(steps, draft);
        }
      }
    });
    const response = await stream.finalMessage();
    opts.stages.push({ name: round === 0 ? "ask" : `ask_${round}`, provider: spec.provider, model: spec.model, usage: response.usage, stop_reason: response.stop_reason });
    tokens += (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    assertFocusedContext(opts.ctx);
    if (response.stop_reason === "refusal") throw new AiRefusal(response.stop_details?.category ?? null);

    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });
    if (calls.length === 0) {
      messages.push({ role: "user", content: "Give your answer by calling final_answer." });
      continue;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name === "final_answer") {
        const parsed = FinalAnswer.safeParse(call.input);
        if (!parsed.success) {
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Not a valid answer: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
          continue;
        }
        const problems = checkAnswer(parsed.data, opts.ctx.cites);
        if (problems.length === 0 || repaired) return { answer: parsed.data, steps };
        repaired = true;
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Fix these and call final_answer again:\n${problems.slice(0, 20).join("\n")}` });
        continue;
      }
      if (call.name === "web_research") {
        try {
          const out = await webResearch(call.input, { ...opts.ctx, question: opts.question } as ToolContext & { question: string });
          opts.ctx.webUsed = true;
          steps.push(out.step);
          results.push({ type: "tool_result", tool_use_id: call.id, content: out.content });
        } catch (e) {
          if (e instanceof WebToolError || e instanceof z.ZodError) {
            if (e instanceof WebToolError && !e.message.startsWith("Not searched") && !e.message.startsWith("One web")) opts.ctx.webUsed = true;
            results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: e.message });
          } else throw e;
        }
        opts.progress(steps);
        continue;
      }
      // Nothing from the web becomes a proposed change before a person keeps it.
      if (call.name === "propose_changes" && opts.ctx.webUsed) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Nothing was proposed: this question looked at the web, and web findings become changes only after a person keeps them." });
        continue;
      }
      if (call.name === "propose_changes" || call.name === "create_report" || call.name === "draft_email") {
        try {
          const out = call.name === "propose_changes" ? proposeChanges(call.input, opts.ctx) : call.name === "draft_email" ? draftEmail(call.input, opts.ctx) : createReport(call.input, opts.ctx);
          steps.push(out.step);
          results.push({ type: "tool_result", tool_use_id: call.id, content: out.content });
        } catch (e) {
          const why = e instanceof ApplyError ? e.message : e instanceof z.ZodError ? `Bad input: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` : null;
          if (why === null) throw e;
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `${call.name === "propose_changes" ? "Nothing was proposed." : call.name === "draft_email" ? "Nothing was drafted." : "No report was saved."} ${why}` });
        }
        continue;
      }
      if (!isReadTool(call.name)) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `There is no tool called ${call.name}.` });
        continue;
      }
      try {
        const out = runReadTool(call.name as ReadToolName, call.input, opts.ctx);
        steps.push(out.step);
        results.push({ type: "tool_result", tool_use_id: call.id, content: out.content });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof z.ZodError ? `Bad input: ${e.issues.map((i) => i.message).join("; ")}` : "That lookup failed." });
      }
    }
    opts.progress(steps);
    // One user message: the results, and — at the end of the allowance — the
    // instruction to answer with what there is.
    const out: Array<Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam> = [...results];
    if (tokens > MAX_TURN_TOKENS || round >= MAX_ROUNDS) {
      out.push({ type: "text", text: "That is the end of this question's allowance. Answer now with what you have, by calling final_answer, and say what you could not look at." });
    }
    messages.push({ role: "user", content: out });
    if (tokens > MAX_TURN_TOKENS * 1.2) throw new Error("This question used up its allowance before it was answered. Ask something narrower.");
  }
  throw new Error("The answer did not arrive within this question's allowance. Ask something narrower.");
}

/**
 * Under AI_FAKE: the same tools, the same checks, a scripted model. It reads
 * the account (or searches the question's first long word, then the account
 * list) and answers citing the first record it was shown.
 */
async function fakeLoop(opts: { question: string; ctx: ToolContext; stages: StageUsage[]; progress: Progress }): Promise<{ answer: FinalAnswer; steps: string[] }> {
  const steps: string[] = [];
  const run = (name: ReadToolName, input: unknown) => {
    steps.push(runReadTool(name, input, opts.ctx).step);
    opts.progress(steps);
  };
  if (opts.ctx.accountId) {
    run("account", { account_id: opts.ctx.accountId });
    // A playbook template, or a question about the playbook, reads it too.
    if (opts.ctx.template?.id.startsWith("playbook_") || /\bplaybook\b/i.test(opts.question)) run("playbook", { account_id: opts.ctx.accountId });
  } else {
    const word = opts.question.split(/\W+/).find((w) => w.length >= 4);
    if (word) run("search", { query: word });
    if (opts.ctx.cites.size === 0) run("accounts", {});
  }
  opts.stages.push({ name: "ask_fake", provider: ROLES.ask.provider, model: "fake", usage: { input_tokens: 0, output_tokens: 0 } });
  // "Look up …" or "search the web …" on an account: the web tool, as the
  // real model would call it.
  if (opts.ctx.accountId && /^\s*(look up|search the web)\b/i.test(opts.question)) {
    try {
      const out = await webResearch({ account_id: opts.ctx.accountId }, { ...opts.ctx, question: opts.question } as ToolContext & { question: string }, { pollMs: 100 });
      steps.push(out.step);
    } catch (e) {
      if (!(e instanceof WebToolError)) throw e;
      steps.push(e.message);
    }
    opts.ctx.webUsed = true;
    opts.progress(steps);
  }
  // "Add a follow-up …" on an account: one proposed follow-up, as the real
  // model would file it.
  if (opts.ctx.accountId && !opts.ctx.webUsed && /\b(add|create|remind|propose)\b/i.test(opts.question)) {
    const out = proposeChanges(
      { account_id: opts.ctx.accountId, changes: [{ record: "action_item", op: "create", fields: { text: opts.question.slice(0, 200) }, why: "Asked for in Ask." }] },
      opts.ctx,
    );
    steps.push(out.step);
    opts.progress(steps);
  }
  // "Email …" on an account: a draft to the first contact read with an
  // address, as the real model would file it.
  if (opts.ctx.accountId && !opts.ctx.webUsed && /^\s*(email|write to|draft an email)\b/i.test(opts.question)) {
    const contact = [...opts.ctx.cites.map.values()].find((c) => c.kind === "contact" && c.accountId === opts.ctx.accountId && db().prepare(`SELECT 1 FROM contacts WHERE id = ? AND email IS NOT NULL AND email != ''`).get(c.id));
    if (contact) {
      const out = draftEmail({ account_id: opts.ctx.accountId, to_contact_ids: [contact.id], subject: "Next steps", body: `Hi ${contact.label.split(/\s+/)[0]},\n\nFollowing up on our conversation: here are the next steps as we understand them.\n\nBest` }, opts.ctx);
      steps.push(out.step);
      opts.progress(steps);
    }
  }
  const focused = opts.ctx.focus && opts.ctx.focus.kind !== "page" ? opts.ctx.cites.get(opts.ctx.focus.kind, opts.ctx.focus.id) : undefined;
  const web = [...opts.ctx.cites.map.values()].find((c) => c.kind === "web");
  const first = web ?? focused ?? [...opts.ctx.cites.map.values()][0];
  // "… a report …", or a template: a report citing what it read, with the
  // template's headings when there is one.
  if (first && (opts.ctx.template || /\breport\b/i.test(opts.question))) {
    const headings = opts.ctx.template?.sections ?? ["Where it stands"];
    // Replay must earn movement evidence just like a real model; the account
    // summary above covers pipeline numbers, not changes over a time window.
    if (opts.ctx.template?.id === "weekly_pipeline") run("what_moved", { account_id: opts.ctx.accountId ?? undefined });
    const out = createReport(
      {
        title: opts.ctx.template ? opts.ctx.template.name : `Report: ${opts.question.slice(0, 80)}`,
        account_id: opts.ctx.accountId ?? undefined,
        summary: `What is on file, as of today [1].`,
        sections: headings.map((heading, i) => ({
          heading,
          body: `- ${first.label} [1]`,
          // A chart under the second section, as a model asked for numbers would.
          ...(i === 1 ? { chart: { kind: opts.ctx.template?.id === "weekly_pipeline" ? ("movement" as const) : ("pipeline_by_quarter" as const), account_id: opts.ctx.accountId ?? undefined } } : {}),
        })),
        citations: [{ n: 1, kind: first.kind, id: first.id }],
      },
      opts.ctx,
    );
    steps.push(out.step);
    opts.progress(steps);
  }
  const answer: FinalAnswer = first
    ? {
        text: `Here is what is on file: ${first.label} [1].`,
        citations: [{ n: 1, kind: first.kind, id: first.id }],
        follow_ups: ["What moved on it this month?", "Who should we talk to next?"],
        ...(/\b(chart|quarter|stage|compare)\b/i.test(opts.question) ? { charts: [{ kind: "pipeline_by_quarter" as const, account_id: opts.ctx.accountId ?? undefined }] } : {}),
      }
    : { text: "Nothing on file answers that yet.", citations: [] };
  // The answer in three pieces, as a stream would bring it, when a browser
  // flow wants to see the draft (AI_FAKE_DRAFT_MS); at once otherwise.
  const pause = Number(process.env.AI_FAKE_DRAFT_MS ?? 0);
  if (pause > 0) {
    for (const end of [0.33, 0.66]) {
      opts.progress(steps, answer.text.slice(0, Math.ceil(answer.text.length * end)));
      await new Promise((r) => setTimeout(r, pause));
    }
  }
  return { answer, steps };
}

function history(threadId: string): Anthropic.MessageParam[] {
  return listMessages(threadId)
    .slice(-HISTORY)
    .map((m) => ({ role: m.role, content: m.text }));
}

// Progress for the page while the run works: the steps so far, in the run's
// own record, which the page already polls.
function checkpoint(runId: string, threadId: string, steps: string[], draft?: string | null) {
  db()
    .prepare(`UPDATE ai_runs SET result_json = ? WHERE id = ? AND status = 'running'`)
    .run(JSON.stringify({ threadId, messageId: null, steps, dropped: 0, ...(draft ? { draft } : {}) }), runId);
}

/**
 * Ask a question: on an existing thread, or a new one (on an account or not).
 * Returns at once with the run; the answer lands on the thread when it is done.
 */
export function startAsk(input: {
  userId: string;
  question: string;
  threadId?: string | null;
  accountId?: string | null;
  save?: boolean;
  focus?: AskFocus | null;
  templateId?: string | null;
  /** An assistant asking on someone's behalf: its own budget pays (lib/ai/guard.ts). */
  assistant?: AssistantId | null;
  /** Called once the answer is kept, with what it wrote. */
  onDone?: (done: { threadId: string; messageId: string; reportDocId: string | null }) => void;
}): { threadId: string; runId: string } {
  const template = input.templateId ? getTemplate(input.templateId, input.accountId ?? null) : null;
  if (input.templateId && !template) throw new BudgetError("That template no longer exists.");
  if (template?.scope === "account" && !input.accountId && !input.threadId) throw new BudgetError(`"${template.name}" is written about one account: start it from the account.`);
  const question = input.question.trim();
  if (question.length < 2) throw new BudgetError("Ask a question.");
  if (question.length > 4000) throw new BudgetError("Keep a question under 4,000 characters.");
  // A record's focus puts the conversation on that record's account.
  const about = input.threadId ? null : resolveFocus(input.focus ?? null, input.accountId ?? undefined);
  if (!input.threadId && input.focus && !about) throw new BudgetError("That focus is unavailable or moved. Start a new question from the record.");
  const thread = input.threadId
    ? getThread(input.threadId)
    : createThread({ accountId: about?.accountId ?? input.accountId ?? null, question, saved: input.save !== false, userId: input.userId, focus: about?.focus ?? null });
  if (!thread) throw new BudgetError("That conversation no longer exists.");
  const focus = resolveFocus(thread.focus, thread.accountId);
  if (thread.focus && !focus) throw new BudgetError("That conversation's focus is unavailable or moved. Start a new question from the record.");
  const busy = db()
    .prepare(`SELECT 1 FROM ai_runs WHERE kind = 'ask' AND status = 'running' AND json_valid(input_summary) AND json_extract(input_summary, '$.threadId') = ? LIMIT 1`)
    .get(thread.id);
  if (busy) throw new BudgetError("This conversation is still working on the last question.");

  const past = history(thread.id);
  addMessage({ threadId: thread.id, role: "user", text: question, userId: input.userId });
  const run = startRun({
    role: "ask",
    accountId: null,
    userId: input.userId,
    assistant: input.assistant ?? null,
    inputSummary: JSON.stringify({ threadId: thread.id, accountId: thread.accountId }),
  });
  runDetached(run.id, async (stages): Promise<AskResult> => {
    const ctx: ToolContext = { userId: input.userId, now: new Date(), cites: new CitableSet(), threadId: thread.id, accountId: thread.accountId, runId: run.id, batches: [], focus: thread.focus, template };
    // Establish thread ownership before the first provider await, not at filing.
    ctx.readState = new AskReadState(ctx);
    // The focused record already informs the system prompt, even before a tool
    // reads it. Its first ownership observation must precede the provider await.
    if (focus && focus.focus.kind !== "page") {
      ctx.readState.remember({ kind: focus.focus.kind, id: focus.focus.id, accountId: focus.recordAccountId!, label: focus.label });
    }
    const progress: Progress = (steps, draft) => checkpoint(run.id, thread.id, steps, draft);
    const { answer, steps } = fakeEnabled() ? await fakeLoop({ question, ctx, stages, progress }) : await loop({ question, history: past, ctx, stages, progress });
    const settled = settle(answer, ctx.cites);
    const message = db().transaction(() => {
      assertFocusedContext(ctx);
      return addMessage({ threadId: thread.id, role: "assistant", text: settled.text, citations: settled.citations, steps, followUps: cleanFollowUps(answer.follow_ups), charts: computeCharts(answer.charts, ctx), proposals: ctx.batches, reportDocId: ctx.reportDocId ?? null, runId: run.id, userId: null });
    }).immediate();
    try {
      input.onDone?.({ threadId: thread.id, messageId: message.id, reportDocId: ctx.reportDocId ?? null });
    } catch (e) {
      // What the caller does next is its own business: the answer is kept.
      console.error("[ask] onDone", e);
    }
    return { threadId: thread.id, messageId: message.id, steps, dropped: settled.dropped };
  });
  return { threadId: thread.id, runId: run.id };
}
