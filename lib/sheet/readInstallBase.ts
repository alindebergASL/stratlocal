// Cells + a confirmed mapping -> install-base lines, and what could not be read.
//
// The third sibling of readDeals.ts and readContacts.ts, and deliberately the
// same two rules:
//
//   - a blank cell is not evidence of anything, so it stays undefined and can
//     never clear a figure someone typed;
//   - a cell that is present and unreadable stops its row by number and says
//     why, rather than being dropped from it (DECISIONS #27).
//
// What is different is the date. A deal row carries its own close date and a
// person carries none; an install-base line belongs to a *snapshot*, and the
// snapshot's date is one answer for the whole file, typed by the person
// importing it. That is DECISIONS #19, and it is why the date is not a column
// here: a file whose rows each claimed their own as_of would be several
// snapshots wearing one upload, and the trend is read off exactly that date.
import { FieldError, readPercent } from "../money";
import { type SheetMapping } from "./columns";
import { FIELD_MAX } from "../proposals/schema";
import { readAmount, type RowProblem } from "./readDeals";

export type SheetInstallBase = {
  /** 1-based, counting the header as row 1, so it matches what the spreadsheet shows. */
  row: number;
  product_family: string;
  value_usd?: number | null;
  share_pct?: number | null;
  role_note?: string | null;
};

export type ReadInstallBaseResult = { lines: SheetInstallBase[]; skipped: RowProblem[] };

function capped(raw: string, max: number, label: string): string {
  if (raw.length > max) {
    throw new FieldError(`${label} is ${raw.length} characters and the most this field holds is ${max}. Shorten it in the spreadsheet and import again.`);
  }
  return raw;
}

export function readInstallBase(body: string[][], mapping: SheetMapping): ReadInstallBaseResult {
  const lines: SheetInstallBase[] = [];
  const skipped: RowProblem[] = [];
  const at = (cells: string[], field: keyof SheetMapping): string => {
    const i = mapping[field];
    if (i === null || i === undefined) return "";
    return (cells[i] ?? "").trim();
  };
  // One family twice in one file is two creates for one row of the snapshot,
  // and the second violates UNIQUE (account_id, product_family, as_of) at
  // accept time — the same failure the repeated-CRM-id check exists to stop,
  // and the one this whole area was fixed for last round.
  const seen = new Set<string>();

  body.forEach((cells, index) => {
    const row = index + 2; // header is row 1
    try {
      const family = at(cells, "product_family");
      if (family === "") {
        skipped.push({ row, why: "no product family" });
        return;
      }
      capped(family, FIELD_MAX.short, "the product family");
      const key = family.toLowerCase();
      if (seen.has(key)) {
        skipped.push({ row, why: `${family} is on an earlier row too, and a snapshot holds one line per family` });
        return;
      }

      const line: SheetInstallBase = { row, product_family: family };
      const value = at(cells, "value_usd");
      // The same three refusals readDeals applies to a deal's TCV, shared
      // rather than described: a negative or unsafe figure is one
      // InstallBasePatch will not take, and a ZodError thrown out of
      // createProposalBatch's single transaction loses every valid row in the
      // file rather than this cell (DECISIONS #27).
      if (value !== "") line.value_usd = readAmount(value, "an install-base line");
      const share = at(cells, "share_pct");
      if (share !== "") line.share_pct = readPercent(share);
      const note = at(cells, "role_note");
      if (note !== "") line.role_note = capped(note, FIELD_MAX.text, "the note");

      // Claimed only once the row is actually readable. A family reserved by a
      // row that then stopped on its value cell would make the file's next
      // honest line for that family read as the duplicate — two skips, and the
      // figure never reaches review at all.
      seen.add(key);
      lines.push(line);
    } catch (e) {
      // Only a FieldError is a cell this reader refused. Anything else is a
      // bug here and should not be written down as the spreadsheet's fault.
      if (!(e instanceof FieldError)) throw e;
      skipped.push({ row, why: e.message });
    }
  });

  return { lines, skipped };
}
