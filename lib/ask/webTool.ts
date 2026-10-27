// Ask's one way to the web (DECISIONS #101). Ask itself stays on Bedrock and
// never searches. This tool starts an ordinary research run — the direct-API
// call that only ever receives the account's public identity — with the
// person's own question as its focus, once it has passed the outbound guard.
// The model chooses only which account; it never writes what is searched.
//
// The run's findings come back to Ask wrapped as untrusted, citable as
// unreviewed web findings, and are also the account's draft research note,
// waiting in the Inbox to be kept or dropped. After it, nothing more may be
// proposed this turn: a web finding becomes a change only once a person has
// kept it (#3, #4).
import { z } from "zod";
import { getAccount } from "../queries/accounts";
import { getRun } from "../ai/guard";
import { wrapUntrusted } from "../ai/prompts";
import { guardWebQuestion, OutboundRefused } from "../ai/outboundGuard";
import { listNotes } from "../research/notes";
import { startResearchRun } from "../research/run";
import type { ToolContext, ToolResult } from "./tools";

export const WebResearch = z.object({ account_id: z.string().min(1).describe("The account whose public identity the search is about.") });
export const WEB_DESCRIPTION =
  "Look this question up on the public web for one account, when the records on file cannot answer it (recent news, announcements, leadership, budgets, programmes). The search sends only the account's public name and website and the person's own question. It takes a minute or two. Findings come back as unreviewed web findings: cite them as kind \"web\", say they are unreviewed, and do not propose changes from them.";

export class WebToolError extends Error {}

const WAIT_MS = 4 * 60_000;

export async function webResearch(raw: unknown, ctx: ToolContext & { question: string }, opts: { pollMs?: number } = {}): Promise<ToolResult> {
  const { account_id } = WebResearch.parse(raw ?? {});
  if (ctx.webUsed) throw new WebToolError("One web lookup per question; this question has had it.");
  const account = getAccount(account_id);
  if (!account || account.archived_at || account.kind !== "customer") throw new WebToolError("That is not a current customer account.");
  if (listNotes(account_id, "draft").length > 0) throw new WebToolError("A research note is already waiting for review on this account. Keep or drop it first (Inbox → Research to keep).");
  let question: string;
  try {
    question = guardWebQuestion(ctx.question, account_id);
  } catch (e) {
    if (e instanceof OutboundRefused) throw new WebToolError(`Not searched: ${e.message}`);
    throw e;
  }
  ctx.webUsed = true;
  const runId = startResearchRun({ accountId: account_id, userId: ctx.userId, focus: question, depth: "standard" });
  const until = Date.now() + WAIT_MS;
  let run = getRun(runId);
  while (run && run.status === "running" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 1000));
    run = getRun(runId);
  }
  if (!run || run.status !== "done") throw new WebToolError(run?.status === "running" ? "The web lookup is still going; it will be in the Inbox when done." : "The web lookup did not finish.");
  const note = listNotes(account_id, "draft").find((n) => n.doc.ai_run_id === runId);
  if (!note || note.meta.findings.length === 0) return { content: "The web lookup found nothing that could be checked against its sources.", step: `Looked on the web about ${account.name}: nothing checkable` };
  const lines = note.meta.findings.map((f, i) => {
    ctx.cites.add({ kind: "web", id: `${note.doc.id}#${i}`, accountId: account_id, label: f.text.length > 90 ? `${f.text.slice(0, 87)}…` : f.text });
    return JSON.stringify({ kind: "web", id: `${note.doc.id}#${i}`, finding: f.text, date: f.date, source: f.url });
  });
  return {
    content: `${wrapUntrusted("web_research", lines.join("\n"), { account: account.name })}\nThese are unreviewed. They are also waiting in the Inbox for a person to keep or drop.`,
    step: `Looked on the web about ${account.name}: ${note.meta.findings.length} finding${note.meta.findings.length === 1 ? "" : "s"}`,
  };
}
