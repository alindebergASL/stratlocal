// The account's qualification scorecard read back from its fields, the gaps
// that steer discovery, and the plain-text block for the CRM's own fields.
import { MEDDPICC, MEDDPICC_LABELS, type Meddpicc } from "./schema";
import { QualificationValue, qualificationField, type QualificationStatus } from "./qualificationFields";
import type { AccountRow } from "../db";

export type ScoreRow = { element: Meddpicc; label: string; field: string; status: QualificationStatus; evidence: string };

export function scorecard(account: AccountRow): ScoreRow[] {
  return MEDDPICC.map((element) => {
    const field = qualificationField(element);
    const raw = (account as Record<string, unknown>)[`${field}_json`];
    let value: QualificationValue | null = null;
    if (typeof raw === "string") {
      try {
        value = QualificationValue.parse(JSON.parse(raw));
      } catch {
        value = null;
      }
    }
    return { element, label: MEDDPICC_LABELS[element], field, status: value?.status ?? "unknown", evidence: value?.evidence ?? "" };
  });
}

/**
 * The elements not yet confirmed: what discovery should still find out. None
 * before anything is on the scorecard, when every element is a gap and so
 * none of them says anything.
 */
export function qualificationGaps(rows: ScoreRow[]): Meddpicc[] {
  if (rows.every((r) => r.status === "unknown")) return [];
  return rows.filter((r) => r.status !== "confirmed").map((r) => r.element);
}

const STATUS_WORD: Record<QualificationStatus, string> = { unknown: "Unknown", partial: "Partial", confirmed: "Confirmed" };

/**
 * One line per element, label first, in the order a CRM's qualification
 * fields are usually laid out, so each pastes into its own field.
 */
export function scorecardForCrm(accountName: string, rows: ScoreRow[], asOf: string): string {
  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  return [
    `MEDDPICC: ${accountName} (${asOf}) · ${confirmed} of ${rows.length} confirmed`,
    "",
    ...rows.map((r) => `${r.label}: [${STATUS_WORD[r.status]}] ${r.evidence || "—"}`),
  ].join("\n");
}
