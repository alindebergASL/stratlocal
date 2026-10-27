// Pure: a plan draft plus what the account already holds -> proposal drafts.
// Nothing here touches the database, so it is easy to test exhaustively.
import type { AccountRow, PlayRow } from "../db";
import { parseJsonArray } from "../format";
import type { ProposalDraft, SourceRef } from "../proposals/schema";
import type { PlanDraft } from "./schema";
import { playKeeperOf } from "../playKeeper";

// plays INCLUDES archived rows, for the reason diffExtraction gives: matching
// on a hidden row is the whole point. A play whose title matches an archived
// one must update and restore it, not quietly create a second play with the
// same name.
export type PlanState = {
  account: AccountRow;
  plays: PlayRow[];
  liveDealIds: Set<string>;
  liveContactIds: Set<string>;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function diffPlanDraft(draft: PlanDraft, state: PlanState): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const byTitle = new Map(state.plays.map((p) => [norm(p.title), p]));

  if (!sameText(draft.thesis, state.account.thesis)) {
    drafts.push({
      entity_type: "account",
      op: "update",
      entity_id: state.account.id,
      payload: { thesis: draft.thesis },
      rationale: state.account.thesis ? "A different read on how this account is won" : "No thesis on file yet",
      source_ref: {
        kind: "ai",
        id: null,
        quote: null,
        origin: "ai_generated",
        refs: draft.plays.flatMap((p) => p.source_refs),
      },
    });
  }

  for (const p of draft.plays) {
    // Linked ids are filtered to records that exist: assertLinkedIds throws
    // at accept time for an unknown one, which would fail the proposal rather
    // than just dropping the link.
    const dealIds = p.linked_deal_ids.filter((id) => state.liveDealIds.has(id));
    const contactIds = p.linked_contact_ids.filter((id) => state.liveContactIds.has(id));
    const ref: SourceRef = {
      kind: p.source_refs[0]?.kind === "email" ? "mail" : (p.source_refs[0]?.kind ?? "ai"),
      id: p.source_refs[0]?.id ?? null,
      quote: null,
      origin: "ai_generated",
      refs: p.source_refs,
    };

    // The title match is followed to the play that survived a merge, for the
    // reason lib/playKeeper.ts records: a merged-away play is archived, so
    // without this the branch below would propose restoring the tombstone and
    // the duplicate would come back on every draft.
    const matched = byTitle.get(norm(p.title));
    const existing = playKeeperOf(state.plays, matched);
    if (matched && !existing) continue;
    if (!existing) {
      drafts.push({
        entity_type: "play",
        op: "create",
        payload: {
          title: p.title,
          thesis: p.thesis,
          status: "proposed",
          owner: p.owner_suggestion,
          next_step: p.next_step,
          deal_ids: dealIds,
          contact_ids: contactIds,
        },
        rationale: "New play from the drafted plan",
        source_ref: ref,
      });
      continue;
    }

    // An update touches the argument and the links only. Status and owner
    // belong to whoever set them: a draft that could move a play someone made
    // active back to proposed, or mark one dropped, would be archiving by
    // another name.
    const patch: Record<string, unknown> = {};
    if (!sameText(p.thesis, existing.thesis)) patch.thesis = p.thesis;
    if (p.next_step !== null && !sameText(p.next_step, existing.next_step)) patch.next_step = p.next_step;
    if (dealIds.length > 0 && !sameIds(dealIds, parseJsonArray(existing.deal_ids_json))) patch.deal_ids = dealIds;
    if (contactIds.length > 0 && !sameIds(contactIds, parseJsonArray(existing.contact_ids_json))) patch.contact_ids = contactIds;
    // Only when it is actually archived: adding the key unconditionally would
    // change every update's payload bytes and weaken the rejected-draft
    // dedupe in createProposalBatch.
    const isArchived = existing.archived_at != null;
    if (isArchived) patch.archived_at = null;
    if (Object.keys(patch).length === 0) continue;

    const changed = Object.keys(patch).filter((k) => k !== "archived_at");
    drafts.push({
      entity_type: "play",
      op: "update",
      entity_id: existing.id,
      payload: patch,
      rationale: isArchived
        ? `Archived, but the drafted plan still calls for this play${changed.length > 0 ? `, with a different ${changed.join(", ")}` : ""}`
        : `A different ${changed.join(", ")} for this play`,
      source_ref: ref,
    });
  }

  return drafts;
}
