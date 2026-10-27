// Pure: extraction + what the account already holds -> proposal drafts.
// Nothing here touches the database, so it is easy to test exhaustively.
import type { AccountRow, ContactRow, DealRow, InstallBaseRow, PlayRow } from "../db";
import type { ProposalDraft, SourceRef } from "../proposals/schema";
import type { AgentReportExtraction } from "./extractSchema";
import { isLocalDealId } from "../ids";
import { sameName } from "../format";
import { matchContact } from "../matchContact";
import { diffInstallBaseLines } from "../installBaseDiff";
import { playKeeperOf } from "../playKeeper";

// deals, contacts and plays here INCLUDE archived rows. Matching against a
// hidden row is the whole point: a deal id is a primary key, so proposing a
// create for an archived deal would fail at accept time, and for a contact or
// a play it would quietly duplicate the record instead. When a match turns out
// to be archived the draft restores it, and says so.
export type AccountState = {
  account: AccountRow;
  deals: DealRow[];
  contacts: ContactRow[];
  plays: PlayRow[];
  /** The install-base rows already filed under the date being imported —
   *  archived ones included, for the reason above. Not "the latest snapshot":
   *  asking which snapshot was newest, rather than whether this date already
   *  had one, is what let a backfill produce a create that could not be
   *  applied. */
  installBaseAtAsOf: InstallBaseRow[];
};

function archived(row: { archived_at?: string | null }): boolean {
  return row.archived_at != null;
}

const DEAL_FIELDS = ["name", "stage", "stage_label", "close_date", "fiscal_quarter", "tcv_usd", "competitor", "partner", "owner", "architecture"] as const;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return (a ?? null) === (b ?? null);
}

export function diffExtraction(x: AgentReportExtraction, state: AccountState, source: { documentId: string; asOf: string }): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const ref = (quote?: string | null): SourceRef => ({ kind: "document", id: source.documentId, quote: quote ?? null });

  // Account metadata: propose only fields that are empty or differ.
  const acct: Record<string, unknown> = {};
  const meta: Array<[keyof typeof x.account, keyof AccountRow]> = [
    ["crm_id", "crm_id"],
    ["legal_entity", "legal_entity"],
    ["region", "region"],
    ["segment", "segment"],
    ["hq", "hq"],
  ];
  for (const [from, to] of meta) {
    const v = x.account[from];
    if (v && !same(v, state.account[to])) acct[to] = v;
  }
  if (Object.keys(acct).length > 0) {
    drafts.push({ entity_type: "account", op: "update", entity_id: state.account.id, payload: acct, rationale: "Header metadata from the imported report", source_ref: ref() });
  }

  // Team members: email, then the name. The rule itself lives in
  // lib/matchContact.ts, because a spreadsheet of people has to match the same
  // way and a matching rule written out twice is one that drifts.
  for (const m of x.team) {
    const found = matchContact<ContactRow>(state.contacts, m)?.row;
    if (found) {
      const patch: Record<string, unknown> = {};
      if (m.email && !found.email) patch.email = m.email;
      if (m.role && !found.role) patch.role = m.role;
      if (m.title && !found.title) patch.title = m.title;
      if (archived(found)) patch.archived_at = null;
      if (Object.keys(patch).length > 0) {
        drafts.push({
          entity_type: "contact",
          op: "update",
          entity_id: found.id,
          payload: patch,
          rationale: archived(found) ? `${found.name} is archived but still named on the report` : `Fills in details for ${found.name}`,
          source_ref: ref(m.name),
        });
      }
      continue;
    }
    drafts.push({
      entity_type: "contact",
      op: "create",
      payload: { name: m.name, email: m.email, role: m.role, title: m.title, org: "vendor" },
      rationale: "Named on the report as part of the seller team",
      source_ref: ref(m.name),
    });
  }

  // Deals by id.
  //
  // A merged-away deal is followed to the row it was merged into. Without
  // this, the report still lists the id that ended up on the tombstone, the
  // match lands on an archived row, and the draft below proposes clearing
  // `archived_at` — so one Accept all brings the duplicate back, on every
  // import, forever.
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
  for (const d of x.deals) {
    const existing = keeperOf(d.deal_id);
    if (!existing) {
      const payload: Record<string, unknown> = { deal_id: d.deal_id };
      for (const f of DEAL_FIELDS) if (d[f] !== null && d[f] !== undefined) payload[f] = d[f];
      // The duplicate this app used to guarantee: someone added the deal
      // before the CRM had an id for it, and the report has now arrived with
      // the real one. Say so on the card, because Accept all is one press and
      // two rows for one opportunity is what follows.
      const lookalikes = state.deals.filter(
        (row) => !archived(row) && !row.merged_into && isLocalDealId(row.deal_id) && sameName(row.name, d.name),
      );
      // Exactly one, or nothing: "merge them after accepting" is unactionable
      // when you do not know which, and ambiguity is worse than silence.
      const hint =
        lookalikes.length === 1
          ? ` — this looks like the CRM id for “${lookalikes[0]!.name}”, which you added without one; merge them after accepting`
          : "";
      drafts.push({
        entity_type: "deal",
        op: "create",
        payload,
        rationale: `New opportunity row in the report${hint}`,
        source_ref: ref(d.deal_id),
      });
      continue;
    }
    if (existing.account_id !== state.account.id) {
      // Never silently move a deal between accounts; surface it as a note-only update the human can reject.
      drafts.push({
        entity_type: "deal",
        op: "update",
        entity_id: d.deal_id,
        payload: { notes: `Report for ${state.account.name} lists this deal, but it is filed under another account.` },
        rationale: "Deal id appears under a different account",
        source_ref: ref(d.deal_id),
      });
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const f of DEAL_FIELDS) {
      const v = d[f];
      if (v === null || v === undefined) continue; // the report not stating it is not evidence it changed
      if (!same(v, existing[f])) patch[f] = v;
    }
    // `existing` may be the survivor of a merge, so the draft is keyed to its
    // id rather than to the one the report happened to use.
    const targetId = existing.deal_id;
    // Only when it is actually archived: adding the key unconditionally would
    // change every update's payload bytes and weaken the rejected-draft dedupe.
    if (archived(existing)) patch.archived_at = null;
    if (Object.keys(patch).length > 0) {
      const changed = Object.keys(patch).filter((k) => k !== "archived_at");
      drafts.push({
        entity_type: "deal",
        op: "update",
        entity_id: targetId,
        payload: patch,
        rationale: archived(existing)
          ? `Archived, but the report still lists it${changed.length > 0 ? `, with different ${changed.join(", ")}` : ""}`
          : `Report shows different ${changed.join(", ")}`,
        source_ref: ref(d.deal_id),
      });
    }
  }

  // Install base. The rule lives in lib/installBaseDiff.ts, because a
  // spreadsheet proposes these rows too now and a rule written out twice is
  // one that drifts — and drift here surfaces as UNIQUE thrown from inside an
  // accept rather than as anything anybody could read.
  drafts.push(
    ...diffInstallBaseLines(x.install_base, state.installBaseAtAsOf, {
      documentId: source.documentId,
      asOf: source.asOf,
      describe: () => `Install base snapshot as of ${source.asOf}`,
    }),
  );

  // Plays by title (case-insensitive). An existing play is never rewritten by
  // an import; an archived one the report still describes is offered back.
  //
  // The map keeps whichever row it saw last, so when a merged pair shares a
  // title it may hold either one — which is why the match is followed to the
  // survivor rather than trusted (lib/playKeeper.ts).
  const playByTitle = new Map(state.plays.map((p) => [norm(p.title), p]));
  // A play the report links to a merged-away id should link to the survivor.
  const dealAlias = new Map<string, string>();
  for (const row of state.deals) {
    const keeper = keeperOf(row.deal_id);
    if (keeper) dealAlias.set(row.deal_id, keeper.deal_id);
  }
  for (const d of x.deals) if (!dealAlias.has(d.deal_id)) dealAlias.set(d.deal_id, d.deal_id);
  const knownDealIds = new Set(dealAlias.values());
  for (const p of x.plays) {
    const matched = playByTitle.get(norm(p.title));
    const existingPlay = playKeeperOf(state.plays, matched);
    // Matched a tombstone whose survivor is not in this list: propose nothing
    // rather than create a third row for the same play.
    if (matched && !existingPlay) continue;
    if (existingPlay) {
      if (archived(existingPlay)) {
        drafts.push({
          entity_type: "play",
          op: "update",
          entity_id: existingPlay.id,
          payload: { archived_at: null },
          rationale: "Archived, but the report still describes this play",
          source_ref: ref(p.title),
        });
      }
      continue;
    }
    drafts.push({
      entity_type: "play",
      op: "create",
      payload: {
        title: p.title,
        thesis: p.thesis,
        status: "proposed",
        next_step: p.next_step,
        // Linked deals that are being created in this same batch will exist
        // once those proposals are accepted first; the review screen orders
        // creates before plays for that reason.
        deal_ids: [...new Set(p.deal_ids.map((id) => dealAlias.get(id) ?? id).filter((id) => knownDealIds.has(id)))],
      },
      rationale: "Play described in the report",
      source_ref: ref(p.title),
    });
  }

  return drafts;
}
