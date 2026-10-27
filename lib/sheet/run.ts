// Upload -> document row -> a mapping a person confirms -> proposal batch.
//
// The same shape as lib/import/run.ts with the model taken out. There is no
// `ai_runs` row, no polling and no cost, because nothing here calls a model: a
// spreadsheet already has a header row, and the only judgement needed is what
// the file is a list of and which column is which — both a person's to make
// (lib/sheet/columns.ts).
//
// The file is stored between the two steps rather than uploaded twice. That
// matches how an imported report is kept (DECISIONS #8 — nothing is deleted),
// gives every proposal a document to cite as its source, and means confirming
// the mapping cannot be made to apply a different file than the one previewed.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, DOCS_DIR, type DocumentRow } from "../db";
import { newId } from "../ids";
import { restoreDocument } from "../documents";
import { createProposalBatch } from "../proposals/apply";
import { getAccount, installBaseAt, latestInstallBase, listContacts, listDeals, listPlays } from "../queries/accounts";
import { CsvError, looksLikeCsv, parseCsv, splitHeader } from "./csv";
import { guessKind, guessMapping, mappingProblems, type SheetKind, type SheetMapping } from "./columns";
import { readDeals, type RowProblem } from "./readDeals";
import { readContacts } from "./readContacts";
import { diffSheet } from "./diffSheet";
import { diffContacts } from "./diffContacts";
import { readInstallBase } from "./readInstallBase";
import { diffInstallBase, partialSnapshotWarning } from "./diffInstallBase";
import { isRealDay, todayISO } from "../clock";

// Smaller than the 5 MB report cap: a CSV is text, and 2 MB of it is roughly
// twenty thousand deals, well past the MAX_ROWS the parser will read anyway.
export const MAX_SHEET_BYTES = 2 * 1024 * 1024;

export class SheetError extends Error {}

export function storeSheetDocument(input: { accountId: string; filename: string; bytes: Buffer; userId: string }): DocumentRow {
  if (input.bytes.length === 0) throw new SheetError("The file is empty.");
  if (input.bytes.length > MAX_SHEET_BYTES) throw new SheetError("The file is larger than 2 MB.");
  if (!looksLikeCsv(input.bytes)) {
    throw new SheetError("That is not a CSV. An .xlsx or .xls has to be saved as CSV first — in Excel, File → Save As → CSV UTF-8.");
  }
  const text = input.bytes.toString("utf8");
  // Parsed before it is stored, so a file that cannot be read is refused at
  // the upload rather than becoming a document nobody can do anything with.
  parseCsv(text);

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = db()
    .prepare(`SELECT * FROM documents WHERE account_id = ? AND sha256 = ? ORDER BY created_at DESC LIMIT 1`)
    .get(input.accountId, sha256) as DocumentRow | undefined;
  if (existing) return existing.archived_at ? restoreDocument(existing.id, input.userId) : existing;

  const id = newId();
  const storagePath = path.join(DOCS_DIR, `${id}.csv`);
  fs.writeFileSync(storagePath, input.bytes);
  // kind='other' rather than a kind of its own: documents.kind is a CHECK
  // constraint, SQLite cannot alter one without rebuilding the table, and
  // 'other' is already listed beside reports in the account's Documents
  // section. The filename ends in .csv and the mime says so, which is what a
  // person reads anyway.
  db()
    .prepare(
      `INSERT INTO documents (id, account_id, kind, filename, mime, byte_size, sha256, storage_path, content_text, status, created_by, created_at)
       VALUES (?, ?, 'other', ?, 'text/csv', ?, ?, ?, ?, 'accepted', ?, ?)`,
    )
    .run(id, input.accountId, path.basename(input.filename).slice(0, 200), input.bytes.length, sha256, storagePath, text, input.userId, Date.now());
  return db().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow;
}

export type SheetPreview = {
  documentId: string;
  filename: string;
  headers: string[];
  /** Total data rows in the file, which is not the number of preview rows below. */
  rows: number;
  /** The first few rows, so a person can see what they are mapping. */
  sample: string[][];
  /** What the file looks like a list of. A guess, shown as a control. */
  kind: SheetKind;
  mapping: SheetMapping;
  problems: string[];
};

const SAMPLE_ROWS = 5;

/**
 * What the screen shows before anything is proposed.
 *
 * `kind` is guessed here and confirmed there, the same way the mapping is: a
 * people file read as deals would propose a pipeline named after colleagues,
 * and a deals file read as people would propose a person per opportunity. Both
 * look plausible one review card at a time, which is the failure this whole
 * screen is shaped around.
 */
export function previewSheet(doc: DocumentRow, kind?: SheetKind): SheetPreview {
  const { headers, body } = splitHeader(parseCsv(doc.content_text ?? ""));
  const k = kind ?? guessKind(headers);
  const mapping = guessMapping(headers, k);
  return {
    documentId: doc.id,
    filename: doc.filename,
    headers,
    rows: body.length,
    sample: body.slice(0, SAMPLE_ROWS),
    kind: k,
    mapping,
    problems: mappingProblems(mapping, headers, k),
  };
}

export type SheetApplyResult = {
  batchId: string;
  proposals: number;
  skipped: RowProblem[];
  rows: number;
  kind: SheetKind;
  /** Said before the review screen, not discovered on it. See partialSnapshotWarning. */
  warning?: string;
};

/**
 * Re-reads the stored file under the kind and mapping the person confirmed,
 * and proposes the difference.
 *
 * `kind` has no default on purpose. The route refuses a request that does not
 * carry one, and a default here would say the opposite in the same breath —
 * one layer insisting the answer is a decision while the other quietly picks
 * deals for anybody who forgets to pass it.
 */
export function applySheet(doc: DocumentRow, mapping: SheetMapping, kind: SheetKind, asOf?: string | null): SheetApplyResult {
  const account = getAccount(doc.account_id);
  if (!account) throw new SheetError("That account no longer exists.");
  const { headers, body } = splitHeader(parseCsv(doc.content_text ?? ""));
  // Checked again here rather than trusting the screen: the mapping arrives
  // from a form, and a column index out of range would read undefined cells
  // into every row without saying anything.
  const problems = mappingProblems(mapping, headers, kind);
  if (problems.length > 0) throw new SheetError(problems.join(" "));

  // Archived rows on purpose, for the reason AccountState records: matching a
  // hidden row is what stops an archived deal being proposed as a create that
  // then fails on its primary key at accept time, and an archived person from
  // being quietly duplicated.
  // A snapshot's date is one answer for the whole file, typed by the person
  // importing it (DECISIONS #19) — the shape the report import has had since
  // Phase 8. Validated here with the same rule that route uses, because a value
  // that is not a real day orders the snapshots forever.
  let snapshotDate = "";
  if (kind === "install_base") {
    snapshotDate = (asOf ?? "").trim();
    if (!isRealDay(snapshotDate)) throw new SheetError("Choose the date this snapshot describes.");
    if (snapshotDate > todayISO()) throw new SheetError("A snapshot cannot be dated in the future.");
  }

  const state = {
    account,
    deals: listDeals(account.id, { includeArchived: true }),
    contacts: listContacts(account.id, { includeArchived: true }),
    plays: listPlays(account.id, { includeArchived: true }),
    // Only the install-base kind proposes these rows, and only then is there
    // anything to match against.
    installBaseAtAsOf: kind === "install_base" ? installBaseAt(account.id, snapshotDate) : [],
  };

  let warning: string | undefined;
  const read =
    kind === "install_base"
      ? (() => {
          const { lines, skipped } = readInstallBase(body, mapping);
          const latest = latestInstallBase(account.id);
          warning =
            partialSnapshotWarning({
              families: lines.length,
              asOfIsNew: state.installBaseAtAsOf.length === 0,
              latestAsOf: latest.asOf,
              latestFamilies: latest.rows.length,
              asOf: snapshotDate,
            }) ?? undefined;
          return { drafts: diffInstallBase(lines, state.installBaseAtAsOf, { documentId: doc.id, asOf: snapshotDate }), skipped };
        })()
      : kind === "contact"
      ? (() => {
          const { contacts, skipped } = readContacts(body, mapping);
          // People are the one kind where the diff can refuse a row too: only
          // it can see that two rows with different keys are one person on
          // file. Both lists are rows the person has to be told about, so they
          // are merged and put back in file order.
          const { drafts, skipped: collided } = diffContacts(contacts, state, { documentId: doc.id });
          return { drafts, skipped: [...skipped, ...collided].sort((a, b) => a.row - b.row) };
        })()
      : (() => {
          const { deals, skipped } = readDeals(body, mapping);
          return { drafts: diffSheet(deals, state, { documentId: doc.id }), skipped };
        })();

  const batch = createProposalBatch(account.id, { kind: "import", id: doc.id, aiRunId: null }, read.drafts);
  return { batchId: batch.batchId, proposals: batch.ids.length, skipped: read.skipped, rows: body.length, kind, warning };
}

export { CsvError };
