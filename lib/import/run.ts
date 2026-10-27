// Upload -> document row -> background extraction -> proposal batch.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, DOCS_DIR, type DocumentRow } from "../db";
import { newId } from "../ids";
import { todayISO } from "../clock";
import { startRun, runDetached, BudgetError } from "../ai/guard";
import { restoreDocument } from "../documents";
import { createProposalBatch } from "../proposals/apply";
import { getAccount, installBaseAt, listContacts, listDeals, listPlays } from "../queries/accounts";
import { documentFormat, documentText, DocumentFileError, MIME } from "../documents/text";
import { jsonExtraction } from "./jsonReport";
import { extractAgentReport } from "./extract";
import { diffExtraction } from "./diffExtraction";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class UploadError extends Error {}

/** A document a customer gave us (a plan, a budget, an RFP, notes): read, kept, cited, never sent to web research. */
export const CUSTOMER_DOC = "customer_doc";

type StoreInput = { accountId: string; filename: string; bytes: Buffer; userId: string };

/**
 * The account report, in whatever form it was saved: HTML, PDF, Word,
 * Markdown, plain text or JSON. Stored with its own extension and type, and
 * read to text here so the run and the original agree on what was read.
 */
export async function storeReportDocument(input: StoreInput): Promise<DocumentRow> {
  return storeDocument(input, "agent_report", null);
}

/** A customer document, kept with the account as context. No run follows. */
export async function storeCustomerDocument(input: StoreInput): Promise<DocumentRow> {
  return storeDocument(input, "other", { type: CUSTOMER_DOC });
}

async function storeDocument(input: StoreInput, kind: "agent_report" | "other", meta: { type: string } | null): Promise<DocumentRow> {
  if (input.bytes.length === 0) throw new UploadError("The file is empty");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new UploadError("The file is larger than 5 MB");
  const format = documentFormat(input.filename, input.bytes);
  if (!format) throw new UploadError("Upload HTML, PDF, Word (.docx), Markdown, plain text or JSON");
  let text: string;
  try {
    text = await documentText(input.filename, input.bytes, MAX_UPLOAD_BYTES);
  } catch (e) {
    if (e instanceof DocumentFileError) throw new UploadError(e.message.replace(/\.$/, ""));
    throw new UploadError("That file could not be read");
  }
  if (!text.trim()) throw new UploadError("No text could be read from that file (a scanned PDF has none to read)");

  // The dedupe matches archived documents too. Uploading the same bytes again
  // is a person saying they want this report, so an archived match comes back
  // rather than being reused invisibly or duplicated. Matched within the same
  // purpose: a report and a customer document are different things to keep.
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = db()
    .prepare(`SELECT * FROM documents WHERE account_id = ? AND sha256 = ? AND kind = ? AND COALESCE(json_extract(CASE WHEN json_valid(meta_json) THEN meta_json END, '$.type'), '') = ? ORDER BY created_at DESC LIMIT 1`)
    .get(input.accountId, sha256, kind, meta?.type ?? "") as DocumentRow | undefined;
  if (existing) return existing.archived_at ? restoreDocument(existing.id, input.userId) : existing;

  const id = newId();
  const ext = path.extname(input.filename).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10) || (format === "markdown" ? ".md" : `.${format === "text" ? "txt" : format}`);
  const storagePath = path.join(DOCS_DIR, `${id}${ext}`);
  fs.writeFileSync(storagePath, input.bytes);
  db()
    .prepare(
      `INSERT INTO documents (id, account_id, kind, filename, mime, byte_size, sha256, storage_path, content_text, meta_json, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
    )
    .run(id, input.accountId, kind, path.basename(input.filename).slice(0, 200), MIME[format], input.bytes.length, sha256, storagePath, text, meta ? JSON.stringify(meta) : null, input.userId, Date.now());
  return db().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow;
}

export type ImportRunResult = { batchId: string; proposals: number; dropped: string[]; attempts: number };

// Starts the extraction and returns the run id immediately.
// `asOf` is the date the report describes, not the date it was uploaded. It
// used to be todayISO() unconditionally, so backfilling last quarter's export
// filed it under today and the trend read as a change that never happened —
// and two reports on the same afternoon meant the second one's install base
// was skipped entirely, because a snapshot for that date already existed.
// Unset still means today, which is right for the usual case.
export function startImportRun(doc: DocumentRow, userId: string, asOf?: string | null): string {
  const run = startRun({ role: "import", accountId: doc.account_id, userId, inputSummary: `document ${doc.id} (${doc.byte_size} bytes)` });
  runDetached(run.id, async (stages): Promise<ImportRunResult> => {
    const account = getAccount(doc.account_id);
    if (!account) throw new Error("account no longer exists");
    // A JSON export that states its records is read as written; anything
    // else, JSON included, is read by the model.
    const direct = doc.mime === "application/json" ? jsonExtraction(doc.content_text ?? "", account.name) : null;
    const { extraction, attempts, dropped } = direct ? { ...direct, attempts: 0 } : await extractAgentReport(doc.content_text ?? "", doc.filename, stages);
    // Archived rows are included on purpose; see AccountState in diffExtraction.
    const state = {
      account,
      deals: listDeals(account.id, { includeArchived: true }),
      contacts: listContacts(account.id, { includeArchived: true }),
      plays: listPlays(account.id, { includeArchived: true }),
      installBaseAtAsOf: installBaseAt(account.id, asOf || todayISO()),
    };
    const drafts = diffExtraction(extraction, state, { documentId: doc.id, asOf: asOf || todayISO() });
    const batch = createProposalBatch(account.id, { kind: "import", id: doc.id, aiRunId: run.id }, drafts);
    return { batchId: batch.batchId, proposals: batch.ids.length, dropped, attempts };
  });
  return run.id;
}

export { BudgetError };
