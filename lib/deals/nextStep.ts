// Whether an open deal is asking for a next step: one rule, used by every
// place that flags "no next step" (DECISIONS #88). A deal can be waived until
// a date, or as informational while it stands; either way it is listed as
// acknowledged rather than hidden, and the waiver ends when the deal moves.
export type WaivableDeal = { status: string; next_step?: string | null; next_step_waived?: string | null; next_step_waived_until?: string | null };

export function waiverActive(d: WaivableDeal, today: string): boolean {
  if (d.next_step_waived === "info") return true;
  return d.next_step_waived === "until" && !!d.next_step_waived_until && d.next_step_waived_until >= today;
}

export function needsNextStep(d: WaivableDeal, today: string): boolean {
  return d.status === "open" && !d.next_step?.trim() && !waiverActive(d, today);
}

/**
 * Open, no next step, and nothing waived: a SQL condition with one `?` for
 * today. Every column is COALESCEd, since a NULL inside NOT (...) would make
 * the whole condition NULL and hide every deal.
 */
export function needsNextStepSql(alias: string): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}status = 'open' AND (${a}next_step IS NULL OR TRIM(${a}next_step) = '') AND NOT (COALESCE(${a}next_step_waived, '') = 'info' OR (COALESCE(${a}next_step_waived, '') = 'until' AND COALESCE(${a}next_step_waived_until, '') >= ?)))`;
}

/** Fields whose change ends a waiver: the deal moved, so it is worth asking again. */
export const WAIVER_ENDS_ON = ["stage", "close_date", "status", "next_step"] as const;
