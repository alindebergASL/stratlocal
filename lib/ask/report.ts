// A report Ask writes: saved, printable, and shareable by link.
//
// Stored as a document of kind 'other' (documents.kind is a CHECK constraint,
// and 'other' is already listed in an account's Documents), with the report
// itself in meta_json, parsed and never cast. A report on no one account is
// filed under the Own work account, because a document always has one.
//
// What is stored is a snapshot: the sections as written and each source's
// name as it was. The logged-in page resolves sources to the records as they
// are now; a shared link shows the names only and links nowhere.
import { z } from "zod";
import { db, type DocumentRow } from "../db";
import { newId } from "../ids";
import { ApplyError } from "../proposals/apply";
import { getAccount } from "../queries/accounts";
import { findUserById } from "../auth";
import { checkAnswer } from "./check";
import { ChartData, ChartSpec, computeCharts } from "./charts";
import type { ToolContext, ToolResult } from "./tools";
import { assertAskWriteContext } from "./writeContext";

export const ReportSection = z.object({
  heading: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000).describe("The section in the same plain markdown as an answer, with [n] markers."),
  chart: ChartSpec.optional().describe("A chart to draw under this section. Name the kind and scope only: the numbers are computed by the app."),
});

// As stored: the chart is the computed snapshot, not the request.
const StoredSection = ReportSection.omit({ chart: true }).extend({ chart: ChartData.optional() });

export const AskReport = z.object({
  type: z.literal("ask_report"),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(1200).nullable(),
  sections: z.array(StoredSection).min(1).max(12),
  citations: z.array(z.object({ n: z.number().int().positive(), kind: z.string(), id: z.string(), accountId: z.string().nullable(), label: z.string() })).max(200),
  accountName: z.string().nullable(),
  threadId: z.string().nullable(),
  generatedBy: z.string(),
  generatedAt: z.string(),
});
export type AskReport = z.infer<typeof AskReport>;

export const CreateReport = z.object({
  title: z.string().min(1).max(200),
  account_id: z.string().min(1).optional().describe("When the report is about one account: its id as a tool returned it. Leave out for a report across accounts."),
  summary: z.string().max(1200).optional().describe("Two or three sentences a reader takes away if they read nothing else."),
  sections: z.array(ReportSection).min(1).max(12),
  citations: z
    .array(z.object({ n: z.number().int().positive(), kind: z.string(), id: z.string() }))
    .max(200)
    .describe("Every [n] used in the sections, with the kind and id of the record exactly as a tool returned it."),
});

export const REPORT_DESCRIPTION =
  "Write a report that is saved, can be printed or saved as PDF, and shared by link. Use it only when asked for a report, a write-up, a one-pager or something to send. Built only from what tools returned this turn, with [n] markers cited like an answer. Then answer briefly, saying the report is ready.";

/** The documents an Ask report is stored as, in SQL. */
export const IS_REPORT = `kind = 'other' AND json_valid(meta_json) AND json_extract(meta_json, '$.type') = 'ask_report'`;

export type StoredReport = { doc: DocumentRow; report: AskReport };

export function parseReport(doc: DocumentRow | null | undefined): StoredReport | null {
  if (!doc || doc.kind !== "other" || !doc.meta_json) return null;
  try {
    const parsed = AskReport.safeParse(JSON.parse(doc.meta_json));
    return parsed.success ? { doc, report: parsed.data } : null;
  } catch {
    return null;
  }
}

export function getReport(docId: string): StoredReport | null {
  return parseReport(db().prepare(`SELECT * FROM documents WHERE id = ? AND archived_at IS NULL`).get(docId) as DocumentRow | undefined);
}

export function listReports(opts: { accountId?: string; limit?: number } = {}): StoredReport[] {
  const where = opts.accountId ? "AND account_id = ?" : "";
  return (
    db()
      .prepare(`SELECT * FROM documents WHERE ${IS_REPORT} AND archived_at IS NULL ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...(opts.accountId ? [opts.accountId] : []), opts.limit ?? 100) as DocumentRow[]
  )
    .map(parseReport)
    .filter((r): r is StoredReport => r !== null);
}

function ownWorkAccountId(): string {
  const row = db().prepare(`SELECT id FROM accounts WHERE kind = 'own_work' LIMIT 1`).get() as { id: string } | undefined;
  if (!row) throw new ApplyError("There is nowhere to file a report on no one account.", "not_found");
  return row.id;
}

export function storeReport(input: { accountId: string | null; userId: string; report: Omit<AskReport, "type" | "generatedBy" | "generatedAt" | "accountName">; now?: Date }): StoredReport {
  const account = input.accountId ? getAccount(input.accountId) : null;
  const report: AskReport = AskReport.parse({
    type: "ask_report",
    ...input.report,
    accountName: account?.name ?? null,
    generatedBy: findUserById(input.userId)?.display_name ?? "someone",
    generatedAt: (input.now ?? new Date()).toISOString(),
  });
  const id = newId();
  const meta = JSON.stringify(report);
  db()
    .prepare(
      `INSERT INTO documents (id, account_id, kind, filename, mime, byte_size, meta_json, status, created_by, created_at)
       VALUES (?, ?, 'other', ?, 'text/markdown', ?, ?, 'accepted', ?, ?)`,
    )
    .run(id, account?.id ?? ownWorkAccountId(), report.title, Buffer.byteLength(meta), meta, input.userId, (input.now ?? new Date()).getTime());
  return getReport(id)!;
}

/** The create_report tool: checked like an answer, then stored. One per question. */
export function createReport(raw: unknown, ctx: ToolContext): ToolResult & { docId: string } {
  return db().transaction(() => fileReport(raw, ctx)).immediate();
}

function fileReport(raw: unknown, ctx: ToolContext): ToolResult & { docId: string } {
  const input = CreateReport.parse(raw);
  if (ctx.reportDocId) throw new ApplyError("A report was already written for this question. Answer now.", "validation");
  if (input.account_id && ![...ctx.cites.map.values()].some((c) => c.accountId === input.account_id)) {
    throw new ApplyError("That account was not returned by a tool this turn. Look it up first, or leave account_id out.", "validation");
  }
  if (ctx.template) {
    const want = ctx.template.sections;
    const got = input.sections.map((s) => s.heading.trim());
    if (got.length !== want.length || got.some((h, i) => h.toLowerCase() !== want[i]!.toLowerCase())) {
      throw new ApplyError(`This report follows the template "${ctx.template.name}": use exactly these section headings, in order: ${want.join(" / ")}.`, "validation");
    }
  }
  const text = [input.summary ?? "", ...input.sections.map((s) => `${s.heading}\n${s.body}`)].join("\n\n");
  assertAskWriteContext(ctx, input.account_id ?? null);
  const problems = checkAnswer({ text, citations: input.citations }, ctx.cites);
  if (problems.length) throw new ApplyError(`Fix these and call create_report again:\n${problems.slice(0, 20).join("\n")}`, "validation");
  const citations = input.citations.map((c) => {
    const seen = ctx.cites.get(c.kind, c.id)!;
    return { n: c.n, kind: c.kind, id: c.id, accountId: seen.accountId, label: seen.label };
  });
  const stored = storeReport({
    accountId: input.account_id ?? null,
    userId: ctx.userId,
    report: {
      title: input.title,
      summary: input.summary ?? null,
      sections: input.sections.map(({ chart, ...s }) => {
        const [drawn] = chart ? computeCharts([chart], ctx, { accountId: input.account_id ?? null }) : [];
        return drawn ? { ...s, chart: drawn } : s;
      }),
      citations,
      threadId: ctx.threadId,
    },
  });
  ctx.reportDocId = stored.doc.id;
  return {
    docId: stored.doc.id,
    step: `Wrote the report “${stored.report.title}”`,
    content: JSON.stringify({ report_id: stored.doc.id, note: "Saved. It opens from the answer; tell them it is ready, in a sentence or two." }),
  };
}
