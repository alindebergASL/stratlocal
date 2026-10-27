// Pure: install-base lines read from a spreadsheet + what is already filed
// under the chosen date -> proposal drafts.
//
// Thin on purpose. The rule is `diffInstallBaseLines` in lib/installBaseDiff.ts
// and it is shared with the report import, because these are the same rows
// arriving in a different envelope — and a rule written out twice here would
// drift into `UNIQUE (account_id, product_family, as_of)` thrown from inside
// an accept, which is precisely the bug that rule was written to end.
//
// What this file adds is the sentence on the card, which is the one thing that
// should differ: a person reviewing it needs to know the row came from a file
// they chose a date for, not from a report that carried one.
import type { InstallBaseRow } from "../db";
import type { ProposalDraft } from "../proposals/schema";
import type { SheetInstallBase } from "./readInstallBase";
import { diffInstallBaseLines } from "../installBaseDiff";

export function diffInstallBase(
  lines: SheetInstallBase[],
  existingAtAsOf: InstallBaseRow[],
  source: { documentId: string; asOf: string },
): ProposalDraft[] {
  const rowOf = new Map(lines.map((l) => [l.product_family, l.row]));
  return diffInstallBaseLines(lines, existingAtAsOf, {
    documentId: source.documentId,
    asOf: source.asOf,
    describe: (line) => `Row ${rowOf.get(line.product_family) ?? "?"} of the spreadsheet, filed under ${source.asOf}`,
  });
}

/**
 * What a partial file will do to the trend, said before anything is proposed.
 *
 * `installBaseTrend` renders a family that was in the previous snapshot and is
 * absent from the newest one as `gone`, with a value of zero. That is right for
 * a report that stopped listing it and a lie for a spreadsheet that only ever
 * covered part of the estate — and the difference is invisible on the review
 * cards, because every card is a perfectly ordinary create.
 *
 * Only for a date that has no snapshot yet: filing under a date already on
 * file is a diff, and a family the file does not mention is left alone.
 */
export function partialSnapshotWarning(input: {
  families: number;
  asOfIsNew: boolean;
  latestAsOf: string | null;
  latestFamilies: number;
  asOf: string;
}): string | null {
  if (!input.asOfIsNew || !input.latestAsOf || input.families >= input.latestFamilies) return null;
  const missing = input.latestFamilies - input.families;
  return `This file lists ${input.families} product famil${input.families === 1 ? "y" : "ies"} and the snapshot of ${input.latestAsOf} has ${input.latestFamilies}. Filed under ${input.asOf} as a new snapshot, the other ${missing} will read as "not in this report" and their value as a fall to zero. That is right if the estate really shrank, and wrong if this file only covers part of it.`;
}
