import {
  db,
  type AccountRow,
  type ChangeLogRow,
  type ContactRow,
  type DealRow,
  type DocumentKind,
  type DocumentRow,
  type InstallBaseRow,
  type PlayRow,
  type ProposalRow,
} from "../db";
import { currentFiscalQuarter, keyFromLabel } from "../fiscal";
import { ownerClause, type OwnerScope } from "./owner";
import { isLocalDealId } from "../ids";
import { sameName } from "../format";
import { ownerChoices, ownerNames } from "../dealOwners";

// Archived rows are hidden from every list. The one deliberate exception is
// lib/queries/labels.ts, which still names them so a historical reference does
// not degrade to a raw id.
const LIVE = "archived_at IS NULL";

export type ListOpts = { includeArchived?: boolean };

function liveOnly(opts: ListOpts | undefined, prefix = ""): string {
  return opts?.includeArchived ? "" : ` AND ${prefix}${LIVE}`;
}

export type AccountSummary = AccountRow & {
  open_pipeline_usd: number;
  open_deals: number;
  closing_this_fq: number;
  pending_proposals: number;
  last_activity_at: number | null;
};

export function listAccountSummaries(scope?: OwnerScope): AccountSummary[] {
  const fq = currentFiscalQuarter().label;
  const owner = ownerClause(scope);
  return db()
    .prepare(
      `SELECT a.*,
         COALESCE((SELECT SUM(tcv_usd) FROM deals d WHERE d.account_id = a.id AND d.status = 'open' AND d.archived_at IS NULL), 0) AS open_pipeline_usd,
         (SELECT COUNT(*) FROM deals d WHERE d.account_id = a.id AND d.status = 'open' AND d.archived_at IS NULL) AS open_deals,
         (SELECT COUNT(*) FROM deals d WHERE d.account_id = a.id AND d.status = 'open' AND d.archived_at IS NULL AND d.fiscal_quarter = ?) AS closing_this_fq,
         (SELECT COUNT(*) FROM proposals p WHERE p.account_id = a.id AND p.status = 'pending') AS pending_proposals,
         (SELECT MAX(created_at) FROM change_log c WHERE c.account_id = a.id) AS last_activity_at
       FROM accounts a
       WHERE a.archived_at IS NULL AND a.kind = 'customer'${owner.sql}
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all(fq, ...owner.args) as AccountSummary[];
}

// Just enough to switch accounts. The header renders on every page and used
// to call listAccountSummaries(), which runs five correlated subqueries per
// account to produce figures the header does not show — and on Home and the
// pipeline it ran twice, once for the nav and once for the page.
export type AccountChoice = { id: string; name: string; region: string | null };

export function listAccountChoices(): AccountChoice[] {
  return db()
    .prepare(`SELECT id, name, region FROM accounts WHERE archived_at IS NULL AND kind = 'customer' ORDER BY name COLLATE NOCASE`)
    .all() as AccountChoice[];
}

// Archived accounts, for the restore list.
export function listArchivedAccounts(): AccountRow[] {
  return db()
    // A merged account is not waiting to be restored: it lives in the one it
    // was merged into, and comes back only by undoing that merge.
    .prepare(`SELECT * FROM accounts WHERE archived_at IS NOT NULL AND merged_into IS NULL AND kind = 'customer' ORDER BY name COLLATE NOCASE`)
    .all() as AccountRow[];
}

// Deliberately unfiltered: a direct link to an archived record must still
// resolve so it can be read and restored. The page shows an archived banner.
export function getAccount(id: string): AccountRow | null {
  return (db().prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as AccountRow | undefined) ?? null;
}

// The names of each account's people on the other side — customer and
// partner contacts, not our own team — so a follow-up owned by a bare first
// name can be told apart from one of ours (lib/promises.ts).
export function otherSideNames(accountId?: string): Map<string, string[]> {
  const rows = db()
    .prepare(`SELECT account_id, name FROM contacts WHERE archived_at IS NULL AND org <> 'vendor'${accountId ? " AND account_id = ?" : ""}`)
    .all(...(accountId ? [accountId] : [])) as Array<{ account_id: string; name: string }>;
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.account_id, [...(out.get(r.account_id) ?? []), r.name]);
  return out;
}

export function listContacts(accountId: string, opts?: ListOpts): ContactRow[] {
  return db()
    // `ORDER BY org` sorted the three values alphabetically — customer,
    // partner, vendor — which put your own colleagues dead last, after every
    // customer contact. Our team first, then the customer, then partners.
    .prepare(
      `SELECT * FROM contacts WHERE account_id = ?${liveOnly(opts)}
       ORDER BY CASE org WHEN 'vendor' THEN 0 WHEN 'customer' THEN 1 ELSE 2 END, name COLLATE NOCASE`,
    )
    .all(accountId) as ContactRow[];
}

// Live people on this account who look like the same human as `contactId`.
//
// Two signals, both high precision, because the button this feeds archives
// somebody. The same email is near certain. The same name under `sameName`
// catches the case the import actually produces: it matches an existing person
// by email and then by exact name, so a row spelled "D'Angelo" against
// "D Angelo", or one that differs only in capitalisation, becomes a second
// person. Anything fuzzier than that — a shared surname, a first initial — is
// a guess, and a guess here puts the wrong person in the picker.
//
// The merge control itself is not gated on this: a person knows that "Dana
// Whitfield" and "D. Whitfield" are the same and nothing here ever will. This
// only pre-fills it and says so.
export function likelyDuplicateContacts(accountId: string, contactId: string): ContactRow[] {
  const self = db().prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId) as ContactRow | undefined;
  if (!self || self.archived_at) return [];
  const email = (self.email ?? "").trim().toLowerCase();
  return listContacts(accountId).filter(
    (c) => c.id !== contactId && ((email !== "" && (c.email ?? "").trim().toLowerCase() === email) || sameName(c.name, self.name)),
  );
}

export function listDeals(accountId: string, opts?: ListOpts): DealRow[] {
  return db()
    .prepare(`SELECT * FROM deals WHERE account_id = ?${liveOnly(opts)} ORDER BY status, COALESCE(close_date, '9999'), tcv_usd DESC`)
    .all(accountId) as DealRow[];
}

// Unfiltered, like getAccount.
export function getDeal(dealId: string): DealRow | null {
  return (db().prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(dealId) as DealRow | undefined) ?? null;
}

export function listPlays(accountId: string, opts?: ListOpts): PlayRow[] {
  return db()
    .prepare(`SELECT * FROM plays WHERE account_id = ?${liveOnly(opts)} ORDER BY sort_order, created_at`)
    .all(accountId) as PlayRow[];
}

// The most recent snapshot only; older as_of rows stay for history.
//
// No index on `(account_id, as_of)`, and that is measured rather than assumed
// (Phase 11's rule — an unused index is a cost on every write). Against a
// fixture of 7,500 install-base rows, 500 of them on the busiest account, both
// this and the trend already SEARCH on `idx_install_base_account`; adding the
// wider index only removes a temp b-tree over those 500 rows and changes no
// timing that `npm run measure` can see. Neither plan is a table scan.
//
// `MAX(as_of)` is taken over the rows that still count, not over every row
// ever filed. Archiving the whole of the newest snapshot otherwise leaves its
// date standing above nothing at all: the page says "as of June" and lists
// none of it, instead of falling back to March.
export function latestInstallBase(accountId: string): { asOf: string | null; rows: InstallBaseRow[] } {
  const latest = db()
    .prepare(`SELECT MAX(as_of) AS as_of FROM install_base WHERE account_id = ? AND archived_at IS NULL`)
    .get(accountId) as { as_of: string | null };
  if (!latest.as_of) return { asOf: null, rows: [] };
  const rows = db()
    .prepare(`SELECT * FROM install_base WHERE account_id = ? AND as_of = ? AND archived_at IS NULL ORDER BY value_usd DESC`)
    .all(accountId, latest.as_of) as InstallBaseRow[];
  return { asOf: latest.as_of, rows };
}

/**
 * The rows already filed under one date, whatever that date's standing.
 *
 * What the import needs to answer "does a snapshot exist for this date" — a
 * different question from "is this the newest snapshot", which is what it used
 * to ask. Asking the wrong one meant re-importing a corrected report for an
 * older date sailed past the guard and died on
 * `UNIQUE (account_id, product_family, as_of)` at accept time, as a raw SQLite
 * error: the pre-insert duplicate check in apply.ts looks up the primary key,
 * which is a fresh uuid, so it never saw it coming.
 *
 * Archived rows are included, for the reason AccountState gives: matching a
 * hidden row is what stops a create that cannot be applied.
 */
export function installBaseAt(accountId: string, asOf: string): InstallBaseRow[] {
  return db().prepare(`SELECT * FROM install_base WHERE account_id = ? AND as_of = ?`).all(accountId, asOf) as InstallBaseRow[];
}

/**
 * Every snapshot, newest first, for the one page that curates them.
 *
 * The UNIQUE constraint has preserved this history since Phase 1 and the only
 * readers take the newest and the one before it — so a year of quarterly
 * reports is on file and four fifths of it has never been visible anywhere.
 * Archived rows come back too, in their own group, because the page that can
 * archive one has to be the page that can put it back.
 */
export type InstallBaseSnapshot = { asOf: string; rows: InstallBaseRow[] };

export function listInstallBaseSnapshots(accountId: string, opts?: ListOpts): InstallBaseSnapshot[] {
  const rows = db()
    .prepare(`SELECT * FROM install_base WHERE account_id = ?${liveOnly(opts)} ORDER BY as_of DESC, value_usd DESC, product_family COLLATE NOCASE`)
    .all(accountId) as InstallBaseRow[];
  const out: InstallBaseSnapshot[] = [];
  for (const r of rows) {
    if (out.at(-1)?.asOf !== r.as_of) out.push({ asOf: r.as_of, rows: [] });
    out.at(-1)!.rows.push(r);
  }
  return out;
}

/** Unfiltered, like getAccount and getDeal: a direct link to an archived row
 *  still has to resolve so it can be read and restored. */
export function getInstallBaseRow(id: string): InstallBaseRow | null {
  return (db().prepare(`SELECT * FROM install_base WHERE id = ?`).get(id) as InstallBaseRow | undefined) ?? null;
}

// The snapshot before the latest one, and what moved between them.
//
// The UNIQUE (account_id, product_family, as_of) constraint has preserved a
// history since Phase 1 that nothing has ever read: latestInstallBase takes
// MAX(as_of) and stops there. "Our share of their compute went from 34% to
// 28% since March" is the sentence the data is for, and it could not be said.
//
// A family present in the earlier snapshot and absent from the latest is
// included with a null current value: a product family disappearing from a
// report is a change worth seeing, not a row to drop.
export type InstallBaseTrend = {
  asOf: string | null;
  previousAsOf: string | null;
  rows: Array<InstallBaseRow & { previous_value_usd: number | null; previous_share_pct: number | null; gone: boolean }>;
};

export function installBaseTrend(accountId: string): InstallBaseTrend {
  const { asOf, rows } = latestInstallBase(accountId);
  if (!asOf) return { asOf: null, previousAsOf: null, rows: [] };
  const prev = db()
    .prepare(`SELECT MAX(as_of) AS as_of FROM install_base WHERE account_id = ? AND as_of < ? AND archived_at IS NULL`)
    .get(accountId, asOf) as { as_of: string | null };
  if (!prev.as_of) return { asOf, previousAsOf: null, rows: rows.map((r) => ({ ...r, previous_value_usd: null, previous_share_pct: null, gone: false })) };
  const before = db()
    .prepare(`SELECT * FROM install_base WHERE account_id = ? AND as_of = ? AND archived_at IS NULL`)
    .all(accountId, prev.as_of) as InstallBaseRow[];
  const byFamily = new Map(before.map((r) => [r.product_family, r]));
  const out = rows.map((r) => {
    const p = byFamily.get(r.product_family);
    byFamily.delete(r.product_family);
    return { ...r, previous_value_usd: p?.value_usd ?? null, previous_share_pct: p?.share_pct ?? null, gone: false };
  });
  for (const p of byFamily.values()) {
    out.push({ ...p, as_of: asOf, value_usd: 0, share_pct: null, previous_value_usd: p.value_usd, previous_share_pct: p.share_pct, gone: true });
  }
  return { asOf, previousAsOf: prev.as_of, rows: out };
}

// `kinds` narrows to uploads or to research notes: the two live in different
// sections of the account page and should not appear in each other's list.
// Search deliberately does not cover documents at all — if that changes, the
// query there needs this same archived filter.
export function listDocuments(accountId: string, opts?: ListOpts & { kinds?: DocumentKind[] }): DocumentRow[] {
  const kinds = opts?.kinds;
  const kindClause = kinds ? ` AND kind IN (${kinds.map(() => "?").join(", ")})` : "";
  return db()
    .prepare(`SELECT * FROM documents WHERE account_id = ?${kindClause}${liveOnly(opts)} ORDER BY created_at DESC, rowid DESC`)
    .all(accountId, ...(kinds ?? [])) as DocumentRow[];
}

export function listArchivedDocuments(accountId: string, kinds?: DocumentKind[]): DocumentRow[] {
  const kindClause = kinds ? ` AND kind IN (${kinds.map(() => "?").join(", ")})` : "";
  return db()
    .prepare(`SELECT * FROM documents WHERE account_id = ?${kindClause} AND archived_at IS NOT NULL ORDER BY created_at DESC, rowid DESC`)
    .all(accountId, ...(kinds ?? [])) as DocumentRow[];
}

// Unfiltered, like getAccount: an archived document must still resolve so it
// can be read and restored.
export function getDocument(id: string): DocumentRow | null {
  return (db().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined) ?? null;
}

export function listPendingProposals(accountId: string): ProposalRow[] {
  return db()
    .prepare(`SELECT * FROM proposals WHERE account_id = ? AND status = 'pending' ORDER BY created_at, entity_type`)
    .all(accountId) as ProposalRow[];
}

// A plan draft has no origin_id, so its proposals are found by origin_kind;
// Ask files under the same kind with an `ask:` id, and is not a plan draft.
// The account page's review block must be scoped to this batch: accept-all
// sweeps every pending proposal for the account unless it is given one.
export function listPlanDraftProposals(accountId: string): ProposalRow[] {
  return db()
    .prepare(`SELECT * FROM proposals WHERE account_id = ? AND origin_kind = 'plan_draft' AND (origin_id IS NULL OR origin_id NOT LIKE 'ask:%') AND status = 'pending' ORDER BY created_at`)
    .all(accountId) as ProposalRow[];
}

export function latestPlanDraftBatchId(accountId: string): string | null {
  const row = db()
    .prepare(`SELECT batch_id FROM proposals WHERE account_id = ? AND origin_kind = 'plan_draft' AND (origin_id IS NULL OR origin_id NOT LIKE 'ask:%') AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)
    .get(accountId) as { batch_id: string } | undefined;
  return row?.batch_id ?? null;
}

export function entityHistory(entityType: string, entityId: string, limit = 50): ChangeLogRow[] {
  return entityHistoryFor(entityType, [entityId], limit);
}

// History for a record and everything that was merged into it.
//
// One query rather than one per id: this orders by rowid, which is insertion
// order, and the merge's own rows are inserted after all of the older ones —
// so concatenating two rowid-ordered lists interleaves them wrongly.
export function entityHistoryFor(entityType: string, entityIds: string[], limit = 50): ChangeLogRow[] {
  if (entityIds.length === 0) return [];
  const holes = entityIds.map(() => "?").join(", ");
  return db()
    .prepare(`SELECT * FROM change_log WHERE entity_type = ? AND entity_id IN (${holes}) ORDER BY rowid DESC LIMIT ?`)
    .all(entityType, ...entityIds, limit) as ChangeLogRow[];
}

// How many rows there are, as opposed to how many were fetched.
//
// The three record pages each read 200 rows and then printed
// "{history.length} changes", which past the cap is a count of the cap.
// DECISIONS #20: a count always comes from the whole set.
export function entityHistoryCount(entityType: string, entityIds: string[]): number {
  if (entityIds.length === 0) return 0;
  const holes = entityIds.map(() => "?").join(", ");
  return (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM change_log WHERE entity_type = ? AND entity_id IN (${holes})`)
      .get(entityType, ...entityIds) as { n: number }
  ).n;
}

// Every row that was merged into this one, transitively: A into B, B into C,
// and C answers for all three. The visited set and the depth cap are not
// decoration — a cycle from bad data would hang a page render, and this runs
// on a page, not in a job.
//
// One walk rather than one per table. Deals had it first; plays and meetings
// carry the same pointer since 015, and a rule written three times is one that
// drifts — the lesson this round has already paid for four times over.
function mergedIdsOf(table: "deals" | "plays" | "meetings", pk: string, id: string, maxDepth: number): string[] {
  const stmt = db().prepare(`SELECT ${pk} AS id FROM ${table} WHERE merged_into = ?`);
  const seen = new Set<string>([id]);
  const out: string[] = [];
  let frontier = [id];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const r of stmt.all(parent) as Array<{ id: string }>) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r.id);
        next.push(r.id);
      }
    }
    frontier = next;
  }
  return out;
}

export function mergedDealIds(dealId: string, maxDepth = 20): string[] {
  return mergedIdsOf("deals", "deal_id", dealId, maxDepth);
}

export function mergedPlayIds(playId: string, maxDepth = 20): string[] {
  return mergedIdsOf("plays", "id", playId, maxDepth);
}

export function mergedMeetingIds(meetingId: string, maxDepth = 20): string[] {
  return mergedIdsOf("meetings", "id", meetingId, maxDepth);
}

// Live plays on this account that look like the same play as `playId`: the
// same title, by the rule the importers already match on. Pre-fills the merge
// control and nothing more — the control is not gated on it, because a person
// can know two rows are one play when no rule here ever would.
export function likelyDuplicatePlays(accountId: string, playId: string): PlayRow[] {
  const self = db().prepare(`SELECT * FROM plays WHERE id = ?`).get(playId) as PlayRow | undefined;
  if (!self || self.archived_at || self.merged_into) return [];
  return (
    db()
      .prepare(`SELECT * FROM plays WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL AND id != ? ORDER BY sort_order, created_at`)
      .all(accountId, playId) as PlayRow[]
  ).filter((p) => sameName(p.title, self.title));
}

// Live deals on this account that look like the same opportunity as `dealId`:
// the same name, with exactly one of the pair carrying a CRM id. Used to
// pre-fill the merge control, because a rationale sentence under a proposal
// card is not something anyone reads before pressing Accept all.
export function likelyDuplicateDeals(accountId: string, dealId: string): DealRow[] {
  const self = db().prepare(`SELECT * FROM deals WHERE deal_id = ?`).get(dealId) as DealRow | undefined;
  if (!self || self.archived_at || self.merged_into) return [];
  return (db()
    .prepare(`SELECT * FROM deals WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL AND deal_id != ?`)
    .all(accountId, dealId) as DealRow[]).filter(
    (d) => sameName(d.name, self.name) && isLocalDealId(d.deal_id) !== isLocalDealId(self.deal_id),
  );
}

export type PipelineDeal = DealRow & { account_name: string; fq_key: number | null };

/** Which deals the pipeline is asking about. Open is the default and the ordinary case. */
export type DealStatusFilter = "open" | "won" | "lost" | "closed" | "all";

const STATUS_WHERE: Record<DealStatusFilter, string> = {
  open: "d.status = 'open'",
  won: "d.status = 'won'",
  lost: "d.status = 'lost'",
  closed: "d.status IN ('won','lost')",
  all: "1 = 1",
};

// Every deal the pipeline can be asked for, not only the open ones.
//
// This hardcoded `d.status = 'open'` into a WHERE that is otherwise assembled
// from a list, and it is the only cross-account view of a deal there is — so
// marking a deal won removed it from the last place you could see it. "What
// did we close this quarter" meant opening fifteen account pages, where the
// won and lost list is capped at ten with no page to send the rest to.
//
// The name stays `listOpenDeals` at every call site that wants open deals,
// because that is still the default and renaming it would touch the export,
// the account page and the attention list for nothing.
export function listOpenDeals(
  filter: { stage?: number; owner?: string; accountId?: string; status?: DealStatusFilter; scope?: OwnerScope } = {},
): PipelineDeal[] {
  const where: string[] = [STATUS_WHERE[filter.status ?? "open"], "d.archived_at IS NULL", "a.archived_at IS NULL"];
  const args: Array<string | number> = [];
  // Whose account the deal is on, which is a different question from `d.owner`
  // — free text the CRM report writes. "Jamie" and "Jamie L." are one owner
  // once a person has said so (lib/dealOwners.ts); the filter below asks for
  // the name and matches every spelling confirmed as it.
  const scoped = ownerClause(filter.scope);
  if (scoped.sql) {
    where.push(scoped.sql.replace(/^ AND /, ""));
    args.push(...scoped.args);
  }
  if (filter.stage) {
    where.push("d.stage = ?");
    args.push(filter.stage);
  }
  if (filter.owner) {
    const spellings = ownerNames().spellingsOf(filter.owner);
    if (spellings.length === 0) {
      where.push("0");
    } else {
      where.push(`d.owner IN (${spellings.map(() => "?").join(", ")})`);
      args.push(...spellings);
    }
  }
  if (filter.accountId) {
    where.push("d.account_id = ?");
    args.push(filter.accountId);
  }
  const rows = db()
    .prepare(
      `SELECT d.*, a.name AS account_name FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE ${where.join(" AND ")} ORDER BY COALESCE(d.close_date, '9999'), d.tcv_usd DESC`,
    )
    .all(...args) as Array<DealRow & { account_name: string }>;
  return rows.map((r) => ({ ...r, fq_key: keyFromLabel(r.fiscal_quarter) }));
}

/** One entry per owner, as a person has confirmed the spellings. */
export function listDealOwners(): string[] {
  return ownerChoices();
}

// Unfiltered, like getAccount and getDeal: a link to an archived person
// resolves so it can be read and restored.
export function getContact(contactId: string): ContactRow | null {
  return (db().prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId) as ContactRow | undefined) ?? null;
}

// Unfiltered, like getAccount, getDeal and getContact: a link to an archived
// play resolves so it can be read and restored.
export function getPlay(playId: string): PlayRow | null {
  return (db().prepare(`SELECT * FROM plays WHERE id = ?`).get(playId) as PlayRow | undefined) ?? null;
}

/**
 * The plays a follow-up editor may offer, for the items it is rendering.
 *
 * Live plays, plus any archived play one of those items already points at.
 *
 * That second half is the whole reason this is a function. A `<select>` always
 * submits its current value, so an option that is not rendered is not merely
 * missing — picking nothing submits "", which `saveActionItem` reads as a
 * clear. A follow-up filed against a play that was archived afterwards would
 * lose its link the next time anybody corrected its due date, silently, in the
 * one app built around never doing that. Same rule as the play form's deal
 * checkboxes and the meeting form's attendees, and the fourth time it has had
 * to be written down.
 */
export function playOptionsFor(accountId: string, linkedPlayIds: Array<string | null | undefined>): Array<{ id: string; title: string; archived: boolean }> {
  const live = listPlays(accountId).map((p) => ({ id: p.id, title: p.title, archived: false }));
  const have = new Set(live.map((p) => p.id));
  const missing = [...new Set(linkedPlayIds.filter((id): id is string => !!id && !have.has(id)))];
  if (missing.length === 0) return live;
  const holes = missing.map(() => "?").join(", ");
  const rest = (
    db().prepare(`SELECT id, title FROM plays WHERE account_id = ? AND id IN (${holes})`).all(accountId, ...missing) as Array<{
      id: string;
      title: string;
    }>
  ).map((p) => ({ ...p, archived: true }));
  return [...live, ...rest];
}
