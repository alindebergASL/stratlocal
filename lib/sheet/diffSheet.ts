// Pure: rows read from a spreadsheet + what the account already holds ->
// proposal drafts. Nothing here touches the database.
//
// Deliberately the same rules `lib/import/diffExtraction.ts` applies to the
// deals in an HTML report, because they are the same deals arriving in a
// different envelope, and a rule that held for one and not the other would be
// a difference nobody could predict from the screen:
//
//   - a merged-away id is followed to the row it was merged into, so an export
//     that still lists the loser updates the survivor rather than proposing to
//     un-archive the duplicate;
//   - an archived match is offered back rather than duplicated, and
//     `archived_at` is added to the payload only when it is actually archived,
//     so an ordinary update's bytes stay stable for the rejected-draft dedupe;
//   - only fields that differ reach the payload, and a blank cell is not a
//     difference;
//   - a deal filed under another account is surfaced as a note, never moved.
//
// What is different is the id. A report's deals always carry a CRM id; a
// spreadsheet's need not, and a row with no id can only ever be a create — it
// has nothing to match on, and matching on the name would make re-importing
// the same export produce updates on the strength of a string.
import type { DealRow } from "../db";
import type { ProposalDraft, SourceRef } from "../proposals/schema";
import type { AccountState } from "../import/diffExtraction";
import type { SheetDeal } from "./readDeals";
import { isLocalDealId } from "../ids";
import { sameName } from "../format";

const FIELDS = ["name", "stage", "stage_label", "close_date", "tcv_usd", "status", "owner", "next_step", "competitor", "partner", "architecture", "notes"] as const;

function archived(row: { archived_at?: string | null }): boolean {
  return row.archived_at != null;
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return (a ?? null) === (b ?? null);
}

export function diffSheet(rows: SheetDeal[], state: AccountState, source: { documentId: string }): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const ref = (quote: string): SourceRef => ({ kind: "document", id: source.documentId, quote });

  const byId = new Map(state.deals.map((d) => [d.deal_id, d]));
  const keeperOf = (id: string): DealRow | undefined => {
    const seen = new Set<string>();
    let row = byId.get(id);
    while (row?.merged_into && !seen.has(row.merged_into)) {
      seen.add(row.merged_into);
      const next = byId.get(row.merged_into);
      if (!next) break;
      row = next;
    }
    return row;
  };

  for (const r of rows) {
    const existing = r.deal_id ? keeperOf(r.deal_id) : undefined;

    if (!existing) {
      const payload: Record<string, unknown> = {};
      if (r.deal_id) payload.deal_id = r.deal_id;
      for (const f of FIELDS) {
        const v = r[f];
        if (v !== undefined && v !== null) payload[f] = v;
      }
      // The duplicate this app used to guarantee, said on the card because
      // Accept all is one press. Same four conditions the report import uses:
      // creates only, live local-id deals only, exactly one match, and an
      // exact normalised name — a guess here puts the wrong pair in front of
      // someone about to archive one of them.
      const lookalikes = state.deals.filter(
        (row) => !archived(row) && !row.merged_into && isLocalDealId(row.deal_id) && sameName(row.name, r.name),
      );
      let hint = "";
      if (r.deal_id && lookalikes.length === 1) {
        hint = ` — this looks like the CRM id for “${lookalikes[0]!.name}”, which you added without one; merge them after accepting`;
      } else if (!r.deal_id) {
        // A row with no CRM id has nothing to match on, so it is always a
        // create — including on a second import of the same file. Matching it
        // by name instead would let a rename in the CRM overwrite an unrelated
        // deal, which is why the id path is the only one that updates.
        //
        // The consequence is a duplicate, so it is said on the card rather
        // than discovered afterwards: reject it and the rejected-draft dedupe
        // keeps every later import of the same file quiet.
        const byName = state.deals.filter((row) => !archived(row) && !row.merged_into && sameName(row.name, r.name));
        hint =
          byName.length > 0
            ? " — it has no CRM id, so there is nothing to match it on, and a deal of this name is already here. Accepting adds a second row."
            : " — it has no CRM id, so importing this file again would add it a second time. Put the id in the spreadsheet, or merge the rows afterwards.";
      }
      drafts.push({
        entity_type: "deal",
        op: "create",
        payload,
        rationale: `Row ${r.row} of the spreadsheet${hint}`,
        source_ref: ref(r.name),
      });
      continue;
    }

    if (existing.account_id !== state.account.id) {
      drafts.push({
        entity_type: "deal",
        op: "update",
        entity_id: existing.deal_id,
        payload: { notes: `A spreadsheet imported into ${state.account.name} lists this deal, but it is filed under another account.` },
        rationale: "That CRM id is on a deal under a different account",
        source_ref: ref(r.name),
      });
      continue;
    }

    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const v = r[f];
      // undefined is "the column was blank or unmapped", which is not evidence
      // the field changed. There is no way for a cell to say "clear this" and
      // that is on purpose: a spreadsheet full of empty cells would otherwise
      // wipe every field a person typed.
      if (v === undefined || v === null) continue;
      if (!same(v, existing[f])) patch[f] = v;
    }
    if (archived(existing)) patch.archived_at = null;
    if (Object.keys(patch).length === 0) continue;
    const changed = Object.keys(patch).filter((k) => k !== "archived_at");
    drafts.push({
      entity_type: "deal",
      op: "update",
      entity_id: existing.deal_id,
      payload: patch,
      rationale: archived(existing)
        ? `Archived, but row ${r.row} of the spreadsheet still lists it${changed.length > 0 ? `, with different ${changed.join(", ")}` : ""}`
        : `Row ${r.row} shows different ${changed.join(", ")}`,
      source_ref: ref(r.name),
    });
  }

  return drafts;
}
