// Cells + a confirmed mapping -> deals, and a list of what could not be read.
//
// Pure, and the place every "what does this cell mean" decision lives. Two
// rules run through all of it.
//
// A cell that is empty is not evidence of anything. The report import already
// works this way (`the report not stating it is not evidence it changed`) and a
// spreadsheet is the same: a blank Competitor column means the export did not
// carry competitors, not that every deal has none. Blank stays undefined and
// never reaches a payload, so it can never clear a field someone typed.
//
// A cell that is present and unreadable stops the row, and says so. The
// alternative — write what could be read and drop the rest — is the shape of
// every silent-loss bug this app has had: the import reports success, the
// review cards look right, and a value is gone with nothing on any screen to
// say it ever existed.
import { readMoney, FieldError } from "../money";
import { isRealDay } from "../clock";
import { STATUS_WORDS, type SheetMapping } from "./columns";
import { FIELD_MAX } from "../proposals/schema";
import type { DealStatus } from "../db";

export type SheetDeal = {
  /** 1-based, counting the header as row 1, so it matches what the spreadsheet shows. */
  row: number;
  deal_id: string | null;
  name: string;
  stage?: number | null;
  stage_label?: string | null;
  close_date?: string | null;
  tcv_usd?: number | null;
  status?: DealStatus;
  owner?: string | null;
  next_step?: string | null;
  competitor?: string | null;
  partner?: string | null;
  architecture?: string | null;
  notes?: string | null;
};

export type RowProblem = { row: number; why: string };

export type ReadResult = { deals: SheetDeal[]; skipped: RowProblem[] };

// A CRM export writes dates in whatever the exporting user's locale was, and
// the ambiguous ones are the dangerous ones: 03/04/2026 is two different
// quarters depending on who pressed export. So only unambiguous forms are
// read, and anything else stops its row rather than picking a reading.
//
// ISO first because it is what this app stores; then the two written forms
// that name their month, which no locale reorders.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function readDate(raw: string): string {
  const s = raw.trim();
  // 2030-01-01, and the same with a time on the end, which several exports add.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d.*)?$/.exec(s);
  if (iso) return check(Number(iso[1]), Number(iso[2]), Number(iso[3]), s);
  // 11 Dec 2026 / 11-Dec-2026 / Dec 11, 2026
  const dmy = /^(\d{1,2})[ \-/]([A-Za-z]{3,})[ \-/](\d{4})$/.exec(s);
  if (dmy) return check(Number(dmy[3]), monthOf(dmy[2]!, s), Number(dmy[1]), s);
  const mdy = /^([A-Za-z]{3,})[ \-/](\d{1,2}),?[ \-/]?(\d{4})$/.exec(s);
  if (mdy) return check(Number(mdy[3]), monthOf(mdy[1]!, s), Number(mdy[2]), s);
  throw new FieldError(
    `could not read “${s}” as a date. Use 2030-01-01 or 11 Dec 2026 — a numeric date like 03/04/2026 is a different quarter depending on who exported it, so it is refused rather than guessed.`,
  );
}

function monthOf(word: string, whole: string): number {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  if (i === -1) throw new FieldError(`could not read “${whole}” as a date: “${word}” is not a month.`);
  return i + 1;
}

function check(y: number, m: number, d: number, whole: string): string {
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // `isRealDay` is the shared rule — it catches 2026-02-31, which Date happily
  // rolls into March. The import route needs the same check on the report date
  // it is handed, and a second copy of it is a second copy to drift.
  if (!isRealDay(iso)) throw new FieldError(`“${whole}” is not a real date.`);
  return iso;
}

// A cell the patch schema would refuse has to stop its own row here.
//
// createProposalBatch parses every draft inside one transaction with no
// per-draft try, so a single over-long cell three hundred rows into an export
// throws a ZodError that rolls the entire import back — nothing written, and a
// message naming a Zod path rather than a row. The reader already refuses a
// date it cannot read and a stage outside 1-6 and says which row; these are
// the fields whose only bound lived in DealPatch, so they were the ones that
// took the batch down with them.
//
// Nothing is trimmed to fit (DECISIONS #15). The row stops and says what it
// found, because a next step silently cut at 4000 characters is exactly the
// kind of loss this import is built not to do.
function capped(raw: string, max: number, label: string): string {
  if (raw.length > max) {
    throw new FieldError(`${label} is ${raw.length} characters and the most this field holds is ${max}. Shorten it in the spreadsheet and import again.`);
  }
  return raw;
}

/**
 * A dollar cell, read to the bounds the patch schemas actually take.
 *
 * Exported because the install-base reader needs the same three refusals and
 * had none of them: `readMoney` alone happily returns -1 and 1e21, both of
 * which reach `InstallBasePatch.value_usd` — a non-negative safe integer, the
 * same shape as `DealPatch.tcv_usd` — and throw a ZodError from inside
 * createProposalBatch's one transaction, which loses every other row of the
 * file. A second copy of these three lines is a second copy to drift, and this
 * one would drift in the direction of a whole import silently not happening.
 *
 * `subject` is only the noun in the negative-amount sentence, so each reader
 * says what it is reading rather than calling an install-base line a deal.
 */
export function readAmount(raw: string, subject = "a deal"): number {
  const n = readMoney(raw, "value");
  if (n === null) throw new FieldError(`could not read “${raw.trim()}” as an amount.`);
  // Both of these reach a payload from readMoney, and the patch takes neither:
  // the amount is a non-negative safe integer.
  if (n < 0) throw new FieldError(`the value “${raw.trim()}” is negative, and ${subject} cannot be worth less than nothing.`);
  if (!Number.isSafeInteger(n)) throw new FieldError(`the value “${raw.trim()}” is too large to be an amount.`);
  return n;
}

function readStage(raw: string): number {
  // "3", "Stage 3", "3 - Tech Validation" — the number is what matters and the
  // label has its own column.
  const m = /(\d+)/.exec(raw);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new FieldError(`could not read “${raw.trim()}” as a stage between 1 and 6.`);
  return n;
}

function readStatus(raw: string): DealStatus {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const found = STATUS_WORDS[key];
  if (!found) throw new FieldError(`could not read “${raw.trim()}” as open, won or lost.`);
  return found;
}

export function readDeals(body: string[][], mapping: SheetMapping): ReadResult {
  const deals: SheetDeal[] = [];
  const skipped: RowProblem[] = [];
  const at = (cells: string[], field: keyof SheetMapping): string => {
    const i = mapping[field];
    if (i === null || i === undefined) return "";
    return (cells[i] ?? "").trim();
  };
  // A CRM export can list the same opportunity twice — a joined query, or two
  // line items rolled up. Two drafts for one id would be two proposals editing
  // the same row, and accepting both is a conflict the second one loses.
  const seenIds = new Set<string>();

  body.forEach((cells, index) => {
    const row = index + 2; // header is row 1
    try {
      const name = at(cells, "name");
      if (name === "") {
        skipped.push({ row, why: "no name" });
        return;
      }
      capped(name, FIELD_MAX.short, "the name");
      const dealId = at(cells, "deal_id");
      if (dealId !== "") {
        capped(dealId, FIELD_MAX.dealId, "the CRM id");
        if (seenIds.has(dealId)) {
          skipped.push({ row, why: `the CRM id ${dealId} is on an earlier row too` });
          return;
        }
        seenIds.add(dealId);
      }
      const deal: SheetDeal = { row, deal_id: dealId === "" ? null : dealId, name };
      const cell = (field: keyof SheetMapping, max: number, label: string) => {
        const v = at(cells, field);
        return v === "" ? undefined : capped(v, max, label);
      };
      deal.stage_label = cell("stage_label", FIELD_MAX.short, "the stage name");
      deal.owner = cell("owner", FIELD_MAX.short, "the owner");
      deal.competitor = cell("competitor", FIELD_MAX.short, "the competitor");
      deal.partner = cell("partner", FIELD_MAX.short, "the partner");
      deal.next_step = cell("next_step", FIELD_MAX.text, "the next step");
      deal.architecture = cell("architecture", FIELD_MAX.text, "the architecture");
      deal.notes = cell("notes", FIELD_MAX.text, "the notes");

      const stage = at(cells, "stage");
      if (stage !== "") deal.stage = readStage(stage);
      const close = at(cells, "close_date");
      if (close !== "") deal.close_date = readDate(close);
      const tcv = at(cells, "tcv_usd");
      if (tcv !== "") deal.tcv_usd = readAmount(tcv);
      const status = at(cells, "status");
      if (status !== "") deal.status = readStatus(status);

      deals.push(deal);
    } catch (e) {
      // Only a FieldError is a cell this reader refused. Anything else is a
      // bug here and should not be written down as the spreadsheet's fault.
      if (!(e instanceof FieldError)) throw e;
      skipped.push({ row, why: e.message });
    }
  });

  return { deals, skipped };
}
