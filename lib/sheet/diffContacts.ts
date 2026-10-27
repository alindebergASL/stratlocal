// Pure: people read from a spreadsheet + what the account already holds ->
// proposal drafts. Nothing here touches the database.
//
// The sibling of diffSheet.ts, applying the same rules to people that that
// file applies to deals, for the reason its header gives: these are the same
// records arriving in a different envelope, and a rule that held for one and
// not the other would be a difference nobody could predict from the screen.
//
//   - an archived match is offered back rather than duplicated, and
//     `archived_at` is added to the payload only when it is actually archived,
//     so an ordinary update's bytes stay stable for the rejected-draft dedupe;
//   - only fields that differ reach the payload, and a blank cell is not a
//     difference.
//
// What is different is the key. A deal is matched on a CRM id or not at all; a
// person has no id in any export, so `matchContact` is the rule — email, then
// the name — and it is shared with the report import so the two cannot drift.
//
// One thing deliberately not shared: a person the report names is created as
// `vendor`, because that block of a report *is* the seller team. A spreadsheet
// is far more likely to be the customer's people, so a create here defaults to
// `customer` and the Side column is how you say otherwise.
import type { ContactRow } from "../db";
import type { ProposalDraft, SourceRef } from "../proposals/schema";
import type { AccountState } from "../import/diffExtraction";
import type { SheetContact } from "./readContacts";
import type { RowProblem } from "./readDeals";
import { matchContact } from "../matchContact";

const FIELDS = ["name", "email", "title", "org", "role", "notes"] as const;

function archived(row: { archived_at?: string | null }): boolean {
  return row.archived_at != null;
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return (a ?? null) === (b ?? null);
}

/**
 * Unlike diffSheet, this reports rows as well as drafts.
 *
 * The reader can only dedupe on what the file says — an address, or a name.
 * A person is matched against the database, so two rows carrying different
 * keys can still turn out to be one person: one matching by name, the next by
 * an address the first row did not have. That produced two update proposals on
 * the same record, and accepting both made the second a conflict, because its
 * `before_json` was captured before the first one landed.
 *
 * Deals cannot do this, which is why diffSheet needs no such channel: their
 * dedupe key is their match key, so the reader sees every collision itself.
 * Only the diff can see this one, so only the diff can report it — and it
 * reports it the way an unreadable cell is reported, by row number with a
 * reason (DECISIONS #27), rather than by quietly proposing the second one.
 */
export function diffContacts(
  rows: SheetContact[],
  state: AccountState,
  source: { documentId: string },
): { drafts: ProposalDraft[]; skipped: RowProblem[] } {
  const drafts: ProposalDraft[] = [];
  const skipped: RowProblem[] = [];
  const ref = (quote: string): SourceRef => ({ kind: "document", id: source.documentId, quote });
  // Which row already claimed each person on file, and the explicit address
  // that row carried, so the second one can say which row it collided with —
  // and so two rows that each hold a *different* address are not folded into
  // one person.
  const claimed = new Map<string, { row: number; email: string | null }>();

  for (const r of rows) {
    const match = matchContact<ContactRow>(state.contacts, r);
    let existing = match?.row;
    // Captured separately because `existing` becomes mutable below (a distinct
    // address drops the match to a create); the update path always has a
    // defined match, and this keeps that fact local instead of re-deriving it.
    const matchedBy = match?.by;
    const rowEmail = r.email?.trim().toLowerCase() || null;

    if (existing) {
      const prev = claimed.get(existing.id);
      if (prev !== undefined) {
        // Two rows reached the same person on file. Usually that is one human
        // spelled two ways across two columns, which the diff refuses as a
        // collision. But two rows that each carry a *different* explicit
        // address are two identities, not one — and that only happens against
        // an email-less record, because an address already on file matches one
        // row by email and disqualifies the other by name. Folding the second
        // address into the first row's proposal makes a distinct person vanish,
        // so create them separately instead of refusing the row.
        const distinctAddresses = !!prev.email && !!rowEmail && prev.email !== rowEmail;
        if (!distinctAddresses) {
          skipped.push({
            row: r.row,
            why: `this is the same person as row ${prev.row} (${existing.name}), reached by a different column. Put them on one row and import again.`,
          });
          continue;
        }
        // A distinct explicit address is a distinct person, even though the
        // email-less record name-matched it. Drop the match so this row falls
        // through to a create of its own contact.
        existing = undefined;
      } else {
        claimed.set(existing.id, { row: r.row, email: rowEmail });
      }
    }

    if (!existing) {
      const payload: Record<string, unknown> = { name: r.name, org: r.org ?? "customer" };
      for (const f of FIELDS) {
        if (f === "name" || f === "org") continue;
        const v = r[f];
        if (v !== undefined && v !== null) payload[f] = v;
      }
      drafts.push({
        entity_type: "contact",
        op: "create",
        payload,
        rationale: `Row ${r.row} of the spreadsheet${r.email ? "" : " — no email address, so a later file that spells the name differently adds them again"}`,
        source_ref: ref(r.name),
      });
      continue;
    }

    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const v = r[f];
      // undefined is "the column was blank or unmapped", which is not evidence
      // the field changed. There is no way for a cell to say "clear this", on
      // purpose: a file carrying only names and emails would otherwise wipe
      // every title and note someone typed.
      if (v === undefined || v === null) continue;
      if (!same(v, existing[f])) patch[f] = v;
    }
    // Proposing a person's name back at them is only meaningful when the name
    // is not what found them. Matched on the address, a different spelling is
    // real news — the spreadsheet is telling you they have changed their name.
    // Matched on the name itself, it is a card that says nothing.
    //
    // This used to ask whether the row carried an address, as a stand-in for
    // how it matched, and the two are not the same question: a row whose
    // address is new to us falls through to the name and then proposed the
    // capitalisation difference that found it in the first place.
    if (matchedBy === "name") delete patch.name;
    if (archived(existing)) patch.archived_at = null;
    if (Object.keys(patch).length === 0) continue;
    const changed = Object.keys(patch).filter((k) => k !== "archived_at");
    drafts.push({
      entity_type: "contact",
      op: "update",
      entity_id: existing.id,
      payload: patch,
      rationale: archived(existing)
        ? `Archived, but row ${r.row} of the spreadsheet still lists them${changed.length > 0 ? `, with different ${changed.join(", ")}` : ""}`
        : `Row ${r.row} shows different ${changed.join(", ")}`,
      source_ref: ref(r.name),
    });
  }

  return { drafts, skipped };
}
