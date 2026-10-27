// Reading a CSV, as opposed to writing one.
//
// lib/csv.ts writes them; this reads them, and the two problems are not
// symmetric. Writing is a matter of quoting correctly. Reading is a matter of
// what a real CRM export contains: a quoted field with a comma in it, a quoted
// field with a newline in it (a deal's `next_step` runs to two lines often
// enough), a doubled quote inside a quoted field, CRLF line endings, a UTF-8
// byte order mark Excel puts on the front, and a trailing blank line.
//
// `text.split("\n").map((l) => l.split(","))` gets every one of those wrong,
// and gets them wrong silently: the row count still looks plausible and the
// columns are shifted from the first quoted comma onwards. That is why this is
// a state machine rather than two splits.
//
// Deliberately not a dependency. RFC 4180 is small, this is fifty lines, and
// the alternative is a package in the runtime image for one screen.

/** What the reader refuses rather than trying. */
export class CsvError extends Error {}

// Bounds, because the file arrives from outside. The byte cap is enforced by
// the route before anything is buffered; these are the shape caps, and each
// one is a number a real export stays well under.
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 200;
export const MAX_CELL_CHARS = 20_000;

/**
 * Rows of cells, header included as the first row. Empty trailing rows are
 * dropped; an empty row in the middle is kept, because in a real export it
 * usually means the rows after it belong to a second table and the person
 * needs to see that rather than have it quietly closed up.
 */
export function parseCsv(text: string): string[][] {
  // Excel writes a BOM (lib/csv.ts writes one too, deliberately). Left in, it
  // becomes part of the first header's name and nothing matches it.
  let src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // A lone \r as a line ending is old Mac and still turns up out of some
  // exports. Normalising first means the state machine only has to know \n.
  src = src.replace(/\r\n?/g, "\n");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    if (cell.length > MAX_CELL_CHARS) throw new CsvError(`A cell is longer than ${MAX_CELL_CHARS} characters, so this is probably not a spreadsheet.`);
    row.push(cell);
    cell = "";
    if (row.length > MAX_COLUMNS) throw new CsvError(`More than ${MAX_COLUMNS} columns.`);
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS) throw new CsvError(`More than ${MAX_ROWS} rows. Split the export and import it in parts.`);
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch !== '"') {
        cell += ch;
        continue;
      }
      // A doubled quote inside a quoted field is one quote. Anything else
      // ends the field.
      if (src[i + 1] === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      endCell();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    cell += ch;
  }
  // An unterminated quote means the rest of the file was swallowed into one
  // cell, which is worth saying rather than returning a one-row answer.
  if (quoted) throw new CsvError("A quoted value is never closed, so the rest of the file was read as part of it.");
  // Whatever is left after the last newline. A file ending in a newline leaves
  // an empty cell in an empty row, which is the trailing blank line, not data.
  if (cell !== "" || row.length > 0) endRow();

  while (rows.length > 0 && isBlank(rows[rows.length - 1]!)) rows.pop();
  if (rows.length === 0) throw new CsvError("The file has no rows in it.");
  return rows;
}

function isBlank(row: string[]): boolean {
  return row.every((c) => c.trim() === "");
}

/** The header row and the data rows, with every row padded to the header's width. */
export function splitHeader(rows: string[][]): { headers: string[]; body: string[][] } {
  const headers = (rows[0] ?? []).map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h === "")) {
    throw new CsvError("The first row has to be the column names, and this one is empty.");
  }
  // Short rows are padded rather than refused: an export that omits trailing
  // empty cells is common and means exactly what a row of empties means.
  const body = rows.slice(1).filter((r) => !isBlank(r)).map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { headers, body };
}

/** Does this look like text at all, as opposed to a spreadsheet's binary format? */
export function looksLikeCsv(bytes: Buffer): boolean {
  // .xlsx is a zip ("PK"), .xls is an OLE compound file. Both are the most
  // likely wrong file to choose, and both produce nonsense rather than an
  // error if read as text — so they are named rather than "not a CSV".
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return false;
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1") return false;
  // A NUL byte in the first few KB means UTF-16 or something binary.
  return !bytes.subarray(0, 8192).includes(0);
}
