// One snapshot's worth of rows + what is already filed under that date ->
// proposal drafts.
//
// Shared, because two things now propose install-base rows: the account plan
// report (lib/import/diffExtraction.ts) and a spreadsheet
// (lib/sheet/diffInstallBase.ts). Written twice, they would drift — and the
// symptom of drift here is not a wrong number on a screen, it is
// `UNIQUE (account_id, product_family, as_of)` thrown from inside the accept,
// which is where this rule came from in the first place.
//
// The rule itself is the one every importer in this app follows: what differs
// is an update, what is missing is a create, and a family the file does not
// mention is left alone — a report or a sheet can be partial, and absence is
// not evidence. It is also what makes re-filing a corrected source the natural
// way to fix a snapshot.
import type { InstallBaseRow } from "./db";
import type { ProposalDraft, SourceRef } from "./proposals/schema";

/** A line of an install base, from whatever read it. */
export type InstallBaseLine = {
  product_family: string;
  value_usd?: number | null;
  share_pct?: number | null;
  role_note?: string | null;
};

const FIELDS = ["value_usd", "share_pct", "role_note"] as const;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return (a ?? null) === (b ?? null);
}

export function diffInstallBaseLines(
  lines: InstallBaseLine[],
  /** Rows already filed under `asOf`, archived ones included: matching a hidden
   *  row is what stops a create that cannot be applied. */
  existingAtAsOf: InstallBaseRow[],
  source: { documentId: string; asOf: string; describe: (line: InstallBaseLine) => string },
): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const byFamily = new Map(existingAtAsOf.map((r) => [norm(r.product_family), r]));
  for (const line of lines) {
    const ref = (): SourceRef => ({ kind: "document", id: source.documentId, quote: line.product_family });
    const existing = byFamily.get(norm(line.product_family));
    if (!existing) {
      drafts.push({
        entity_type: "install_base",
        op: "create",
        payload: {
          product_family: line.product_family,
          value_usd: line.value_usd ?? null,
          share_pct: line.share_pct ?? null,
          role_note: line.role_note ?? null,
          as_of: source.asOf,
          document_id: source.documentId,
        },
        rationale: source.describe(line),
        source_ref: ref(),
      });
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const v = line[f];
      if (v === null || v === undefined) continue;
      if (!same(v, existing[f])) patch[f] = v;
    }
    if (Object.keys(patch).length === 0) continue;
    drafts.push({
      entity_type: "install_base",
      op: "update",
      entity_id: existing.id,
      payload: patch,
      rationale: `${source.asOf} shows a different ${Object.keys(patch).join(", ")} for ${existing.product_family}`,
      source_ref: ref(),
    });
  }
  return drafts;
}
