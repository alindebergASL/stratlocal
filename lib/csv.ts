// Writing a CSV that a spreadsheet opens correctly and cannot be hurt by.
//
// Three things this gets wrong by default, all of them deliberate here.
//
// 1. Raw values, never the display helpers. fmtMoney puts a comma inside a
//    money cell, fmtDay writes "Fri 20 Sep", and both render an em-dash for
//    null. A spreadsheet wants 1000, 2030-01-01, and an empty cell.
// 2. A cell beginning =, +, -, @, tab or carriage return is a formula to Excel
//    and Sheets. `notes` and `next_step` are free text, partly written by a
//    model from an uploaded document, and this file is meant to be handed to
//    another account team. See `escapeCell`.
// 3. A UTF-8 byte order mark, or Excel reads the file as the local codepage
//    and mangles every name with an accent in it.

export const CSV_BOM = "﻿";

export type CsvValue = string | number | null | undefined;

// The characters that make a spreadsheet treat a cell as a formula rather than
// as text. A leading apostrophe is the conventional defusing: Excel and Sheets
// both read it as "this is text", and both hide it in the cell.
//
// This is not paranoia about our own data. The route below exports `notes` and
// `next_step`, which meeting extraction writes from pasted notes and the
// import writes from an uploaded report — so the shortest path from a customer
// document to a formula executing on a colleague's machine runs straight
// through this function.
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  // A number is never a formula, and prefixing one makes a spreadsheet read it
  // as text — so a negative amount would quietly stop being part of the column
  // it is summed in. The guard is for text, which is where the risk is.
  if (typeof value === "number") return String(value);
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  // Quote when the value contains anything that would otherwise end the field
  // or the row. A quote inside a quoted field is doubled — RFC 4180.
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  // CRLF, because that is what RFC 4180 says and what Excel is least likely to
  // have an opinion about.
  const lines = [headers.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))];
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

// A filename a browser will accept and a person can find again.
//
// Sanitised the same way the documents route sanitises an uploaded filename,
// because this one is built from an account name that a person typed.
export function csvFilename(parts: Array<string | null | undefined>): string {
  const stem = parts
    .filter(Boolean)
    .join("-")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${stem || "export"}.csv`;
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // Same reasoning as the documents route: this is a download, and nothing
      // should be tempted to render it in our origin.
      "x-content-type-options": "nosniff",
      // Customer names. Not something to sit in a shared cache.
      "cache-control": "no-store",
    },
  });
}
