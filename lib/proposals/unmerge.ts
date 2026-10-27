// Undoing a merge.
//
// A merge relinks, fills, unions and archives inside one transaction, and
// until now nothing could take that back. History was not enough to do it:
// it keeps a meeting's notes by size only, and some of a merge's writes —
// the tombstone pointer, the proposals it rejects — are not history rows at
// all. So each merge now leaves a receipt, captured inside its own
// transaction: the before and after of every column it changed, on every row
// it could have touched (`beginReceipt` / `finishReceipt`, called by
// lib/proposals/merge.ts).
//
// Undoing reads the receipt against the records as they are now. A column
// goes back to what it held before the merge only if nothing has written to
// it since: it still holds what the merge wrote, no history row on it is
// newer than the merge, and the row is still on this account. Anything else
// stays exactly as it is and is named — a later edit is a person's decision,
// even one that happened to put the same value back, and un-merging is not a
// way to overwrite it. The preview and the undo are the same computation
// (`planUnmerge`), and the undo refuses if the plan has changed since the
// page that showed it was drawn, so what the page said is what the press did.
import { createHash } from "node:crypto";
import { db } from "../db";
import { newId } from "../ids";
import { fieldLabel } from "../fieldLabels";
import { ApplyError } from "./apply";

type Conn = ReturnType<typeof db>;
type Value = string | number | null;
type Row = Record<string, Value>;

// Every table a merge can write to, with its key and what to call a row.
const TABLES = {
  contacts: { pk: "id", entity: "contact", noun: "Person", label: "name" },
  deals: { pk: "deal_id", entity: "deal", noun: "Deal", label: "name" },
  plays: { pk: "id", entity: "play", noun: "Play", label: "title" },
  meetings: { pk: "id", entity: "meeting", noun: "Meeting", label: "title" },
  action_items: { pk: "id", entity: "action_item", noun: "Follow-up", label: "text" },
  proposals: { pk: "id", entity: null, noun: "Proposal", label: null },
} as const;
type Table = keyof typeof TABLES;
const TABLE_NAMES = Object.keys(TABLES) as Table[];
const OWN_TABLE: Record<MergeEntity, Table> = { contact: "contacts", deal: "deals", play: "plays", meeting: "meetings" };

// Columns that are bookkeeping rather than content. `updated_at` moves on
// every write and is bumped again by the undo itself.
const IGNORED = new Set(["updated_at"]);
// Document-sized columns. The receipt keeps what they held before (it has to,
// to restore them) but only a fingerprint of what the merge wrote, which is
// all the "still holds it" comparison needs; a meeting merge's receipt is
// otherwise two copies of the notes.
const LARGE = new Set(["raw_notes", "brief_json", "brief_edits_json"]);
const fingerprint = (v: Value) => `sha256:${createHash("sha256").update(String(v)).digest("hex")}`;

// What history calls each column, so "has anything written to it since" can
// be asked of change_log. Everything else is its own name.
const HISTORY_FIELD: Record<string, string> = {
  contact_ids_json: "contact_ids",
  deal_ids_json: "deal_ids",
  attendees_json: "attendees",
  source_ref_json: "source_ref",
  person_id: "person_link",
};
const historyField = (col: string) => HISTORY_FIELD[col] ?? col;
// And what to call it in a sentence.
const LABEL: Record<string, string> = { person_id: "Same person at another account", archived_at: "Archived" };
const colLabel = (col: string) => LABEL[col] ?? fieldLabel(col);

export type RowChange = { table: Table; key: string; cols: Record<string, [Value, Value]> };
export type MergeEntity = "contact" | "deal" | "play" | "meeting";
type Snapshot = Map<string, Row>; // `${table}\0${key}` → row
const at = (t: Table, key: string) => `${t}\u0000${key}`;

// The rows a merge of `loserId` into `keeperId` can write: the two records,
// everything that names the loser, and what is still proposed for it. Read
// by key rather than as the whole account — a merge holds the write lock, and
// a whole account's meetings carry every set of notes ever written.
function touchable(conn: Conn, accountId: string, entity: MergeEntity, keeperId: string, loserId: string): Array<[Table, string]> {
  const own = OWN_TABLE[entity];
  const out: Array<[Table, string]> = [
    [own, keeperId],
    [own, loserId],
  ];
  const ids = (sql: string, ...args: unknown[]) => (conn.prepare(sql).pluck().all(...args) as string[]);
  const like = `%"${loserId}"%`;
  for (const id of ids(`SELECT id FROM plays WHERE account_id = ? AND (contact_ids_json LIKE ? OR deal_ids_json LIKE ?)`, accountId, like, like)) out.push(["plays", id]);
  for (const id of ids(`SELECT id FROM meetings WHERE account_id = ? AND attendees_json LIKE ?`, accountId, like)) out.push(["meetings", id]);
  for (const id of ids(`SELECT id FROM action_items WHERE account_id = ? AND (play_id = ? OR meeting_id = ?)`, accountId, loserId, loserId)) out.push(["action_items", id]);
  for (const id of ids(`SELECT id FROM proposals WHERE account_id = ? AND status = 'pending' AND entity_id = ?`, accountId, loserId)) out.push(["proposals", id]);
  return out;
}

function read(conn: Conn, keys: Array<[Table, string]>): Snapshot {
  const out: Snapshot = new Map();
  for (const [t, key] of keys) {
    const row = conn.prepare(`SELECT * FROM ${t} WHERE ${TABLES[t].pk} = ?`).get(key) as Row | undefined;
    if (row) out.set(at(t, key), row);
  }
  return out;
}

export type Receipt = { keys: Array<[Table, string]>; before: Snapshot };

/** Call first thing inside a merge's transaction, before anything is written. */
export function beginReceipt(conn: Conn, accountId: string, entity: MergeEntity, keeperId: string, loserId: string): Receipt {
  const keys = touchable(conn, accountId, entity, keeperId, loserId);
  return { keys, before: read(conn, keys) };
}

/** Call last thing inside the same transaction: stores what changed. */
export function finishReceipt(
  conn: Conn,
  receipt: Receipt,
  meta: { accountId: string; entityType: MergeEntity; keeperId: string; loserId: string; keeperLabel: string; loserLabel: string; actorUserId: string | null },
): string {
  const after = read(conn, receipt.keys);
  const changes: RowChange[] = [];
  for (const [t, key] of receipt.keys) {
    const was = receipt.before.get(at(t, key));
    const now = after.get(at(t, key));
    if (!was || !now) continue;
    const cols: Record<string, [Value, Value]> = {};
    for (const col of Object.keys(now)) {
      if (IGNORED.has(col)) continue;
      if (was[col] === now[col]) continue;
      const wrote = now[col] ?? null;
      cols[col] = [was[col] ?? null, LARGE.has(col) && wrote !== null ? fingerprint(wrote) : wrote];
    }
    if (Object.keys(cols).length > 0) changes.push({ table: t, key, cols });
  }
  const logSeq = (conn.prepare(`SELECT COALESCE(MAX(rowid), 0) FROM change_log`).pluck().get() as number) ?? 0;
  const id = newId();
  conn
    .prepare(
      `INSERT INTO merge_receipts (id, account_id, entity_type, keeper_id, loser_id, keeper_label, loser_label, actor_user_id, created_at, changes_json, log_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, meta.accountId, meta.entityType, meta.keeperId, meta.loserId, meta.keeperLabel, meta.loserLabel, meta.actorUserId, Date.now(), JSON.stringify(changes), logSeq);
  return id;
}

export type MergeReceipt = {
  id: string;
  accountId: string;
  /** An "account" receipt is undone by lib/proposals/mergeAccount.ts. */
  entityType: MergeEntity | "account";
  keeperId: string;
  loserId: string;
  keeperLabel: string;
  loserLabel: string;
  actorUserId: string | null;
  createdAt: number;
  undoneAt: number | null;
};

type ReceiptRow = {
  id: string;
  account_id: string;
  entity_type: MergeEntity;
  keeper_id: string;
  loser_id: string;
  keeper_label: string;
  loser_label: string;
  actor_user_id: string | null;
  created_at: number;
  changes_json: string;
  log_seq: number;
  undone_at: number | null;
};

const toReceipt = (r: Omit<ReceiptRow, "changes_json" | "log_seq">): MergeReceipt => ({
  id: r.id,
  accountId: r.account_id,
  entityType: r.entity_type,
  keeperId: r.keeper_id,
  loserId: r.loser_id,
  keeperLabel: r.keeper_label,
  loserLabel: r.loser_label,
  actorUserId: r.actor_user_id,
  createdAt: r.created_at,
  undoneAt: r.undone_at,
});

/** Merges on this account that can still be undone, newest first. */
export function listMergeReceipts(accountId: string, limit = 20): MergeReceipt[] {
  return (
    db()
      .prepare(
        `SELECT id, account_id, entity_type, keeper_id, loser_id, keeper_label, loser_label, actor_user_id, created_at, undone_at
         FROM merge_receipts WHERE account_id = ? AND undone_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(accountId, limit) as Array<Omit<ReceiptRow, "changes_json" | "log_seq">>
  ).map(toReceipt);
}

export type UnmergePlan = {
  receipt: MergeReceipt;
  /** Columns nothing has written since, and so go back. */
  restore: Array<{ table: Table; key: string; col: string; to: Value; from: Value }>;
  /** What changed since, in words, and stays as it is. */
  keptAsIs: string[];
  /** Whether the merged-away record comes back as a live record. */
  loserReturns: boolean;
  /** A digest of the plan, so the undo can refuse a plan the page did not show. */
  digest: string;
};

function loadReceipt(conn: Conn, accountId: string, receiptId: string): ReceiptRow {
  const r = conn.prepare(`SELECT * FROM merge_receipts WHERE id = ?`).get(receiptId) as ReceiptRow | undefined;
  if (!r || r.account_id !== accountId) throw new ApplyError("That merge is not on this account.", "not_found");
  if (r.undone_at) throw new ApplyError("That merge has already been undone.", "state");
  if ((r.entity_type as string) === "account") throw new ApplyError("That was a merge of two accounts; it is undone from the account it went into.", "validation");
  // An archived account has nothing pending and nothing live; bringing a
  // record and its proposals back onto one would break both. Restore the
  // account first.
  const account = conn.prepare(`SELECT archived_at FROM accounts WHERE id = ?`).get(accountId) as { archived_at: string | null } | undefined;
  if (!account || account.archived_at) throw new ApplyError("This account is archived; restore it before undoing a merge on it.", "state");
  return r;
}

function parseChanges(json: string): RowChange[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as RowChange[]) : [];
  } catch {
    return [];
  }
}

function rowName(t: Table, row: Row | undefined, key: string): string {
  const label = TABLES[t].label;
  const name = label && row ? row[label] : null;
  return `${TABLES[t].noun} “${typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : key}”`;
}

export function planUnmerge(conn: Conn, accountId: string, receiptId: string): UnmergePlan {
  const r = loadReceipt(conn, accountId, receiptId);
  const restore: UnmergePlan["restore"] = [];
  const keptAsIs: string[] = [];
  const laterWrite = conn.prepare(`SELECT 1 FROM change_log WHERE entity_type = ? AND entity_id = ? AND field = ? AND rowid > ? LIMIT 1`);
  for (const change of parseChanges(r.changes_json)) {
    const t = TABLES[change.table];
    if (!t) continue;
    const row = conn.prepare(`SELECT * FROM ${change.table} WHERE ${t.pk} = ?`).get(change.key) as Row | undefined;
    if (!row) {
      keptAsIs.push(`${rowName(change.table, undefined, change.key)} no longer exists`);
      continue;
    }
    // A row moved to another account since is that account's now: nothing
    // here may write to it, and history filed under this account would be
    // invisible on the one it lives on.
    if (row.account_id !== accountId) {
      keptAsIs.push(`${rowName(change.table, row, change.key)} has moved to another account`);
      continue;
    }
    for (const [col, [was, wrote]] of Object.entries(change.cols)) {
      const now = row[col] ?? null;
      const holds = LARGE.has(col) && typeof wrote === "string" && wrote.startsWith("sha256:") ? now !== null && fingerprint(now) === wrote : now === wrote;
      const touched = t.entity !== null && !!laterWrite.get(t.entity, change.key, historyField(col), r.log_seq);
      if (holds && !touched) restore.push({ table: change.table, key: change.key, col, to: was, from: now });
      else if (now !== was || touched) keptAsIs.push(`${rowName(change.table, row, change.key)}: ${colLabel(col)} was changed since`);
      // `now === was` with no later write cannot happen; with one, it is
      // somebody having put it back by hand, and it is reported above.
    }
  }
  const ownTable = OWN_TABLE[r.entity_type];
  const loserReturns = restore.some((s) => s.table === ownTable && s.key === r.loser_id && s.col === "archived_at" && s.to === null);
  const digest = createHash("sha256")
    .update(JSON.stringify([restore.map((s) => [s.table, s.key, s.col]), keptAsIs]))
    .digest("hex")
    .slice(0, 16);
  return { receipt: toReceipt(r), restore, keptAsIs, loserReturns, digest };
}

export type UnmergePreview = { ok: true; restores: number; keptAsIs: string[]; loserReturns: boolean; digest: string } | { ok: false; why: string };

/** Read-only: what undoing this merge would do, for the screen. */
export function previewUnmerge(input: { accountId: string; receiptId: string }): UnmergePreview {
  try {
    const p = planUnmerge(db(), input.accountId, input.receiptId);
    return { ok: true, restores: p.restore.length, keptAsIs: p.keptAsIs, loserReturns: p.loserReturns, digest: p.digest };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, why: e.message };
    throw e;
  }
}

function logText(col: string, v: Value): string | null {
  if (v === null || v === "") return null;
  if (LARGE.has(col)) return `${Buffer.byteLength(String(v), "utf8") < 1024 ? `${Buffer.byteLength(String(v), "utf8")} B` : `${(Buffer.byteLength(String(v), "utf8") / 1024).toFixed(1)} KB`}`;
  // A JSON column is already JSON; anything else is encoded the way
  // applyEntityChange encodes it, so Activity reads both the same.
  return col.endsWith("_json") ? String(v) : JSON.stringify(v);
}

/**
 * Undo a merge. `expect` is the digest of the plan the person was shown; if
 * anything has changed since, the undo is refused rather than doing
 * something the page did not say.
 */
export function unmerge(input: { accountId: string; receiptId: string; actorUserId: string | null; expect?: string }): { restored: number; keptAsIs: string[] } {
  const conn = db();
  return conn
    .transaction(() => {
      const plan = planUnmerge(conn, input.accountId, input.receiptId);
      if (input.expect !== undefined && input.expect !== plan.digest) {
        throw new ApplyError("Something on these records changed since this page was drawn. Read what the undo would do now, then press it again.", "conflict");
      }
      const now = Date.now();
      const log = conn.prepare(
        `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      // One UPDATE per row, every restorable column at once.
      const byRow = new Map<string, UnmergePlan["restore"]>();
      for (const step of plan.restore) {
        const k = at(step.table, step.key);
        byRow.set(k, [...(byRow.get(k) ?? []), step]);
      }
      for (const steps of byRow.values()) {
        const { table, key } = steps[0]!;
        const t = TABLES[table];
        const sets = steps.map((s) => `${s.col} = ?`);
        if (table !== "proposals") sets.push(`updated_at = MAX(updated_at + 1, ?)`);
        conn
          .prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${t.pk} = ? AND account_id = ?`)
          .run(...steps.map((s) => s.to), ...(table !== "proposals" ? [now] : []), key, input.accountId);
        if (t.entity) {
          for (const s of steps) log.run(newId(), input.accountId, t.entity, key, historyField(s.col), logText(s.col, s.from), logText(s.col, s.to), input.actorUserId, now);
        }
      }
      // The narrative beside the mechanics, on both records: a statement,
      // like the merge's own lines, not a before-and-after.
      const r = plan.receipt;
      log.run(newId(), input.accountId, r.entityType, r.keeperId, "unmerged", null, `“${r.loserLabel}” is its own record again`, input.actorUserId, now);
      log.run(newId(), input.accountId, r.entityType, r.loserId, "unmerged", null, `no longer merged into “${r.keeperLabel}”`, input.actorUserId, now);
      conn.prepare(`UPDATE merge_receipts SET undone_at = ?, undone_by = ? WHERE id = ?`).run(now, input.actorUserId, r.id);
      return { restored: plan.restore.length, keptAsIs: plan.keptAsIs };
    })
    .immediate();
}
