// Two account records for one customer, made one.
//
// It happens: an account typed by hand before the report arrived, a name
// spelled two ways, a subsidiary that turned out to be the same buyer. Every
// record on the merged-away account moves to the one being kept, through the
// one move function (lib/proposals/move.ts), so each move is a history line on
// both accounts. The kept account's blank fields are filled from the other;
// nothing it already says is overwritten. The merged-away account is archived
// and points at the one it lives in now, and a link to it lands there.
//
// What is not carried, and why, is said before the press:
// - an install-base line for a product family and date the kept account
//   already has a line for (the snapshot is one row per family per date);
// - the other account's thesis, when both have one;
// - its history, its AI runs and its own merge receipts, which stay filed
//   under it — the record of what happened there before it was merged.
// Two people with the same name on both accounts are left as two records:
// merging people is its own decision, made on the person's page.
//
// Undo moves back what is still on the kept account and has not been tied to
// it since, and puts back fields nothing has written since; anything else is
// named and left as it is — the same rule as every other merge (unmerge.ts).
import { createHash } from "node:crypto";
import { db, type AccountRow } from "../db";
import { newId } from "../ids";
import { fieldLabel } from "../fieldLabels";
import { applyEntityChange, ApplyError, archiveEntity } from "./apply";
import { moveToAccount, type MovableEntity } from "./move";

type Conn = ReturnType<typeof db>;
type Value = string | number | null;

const CHILDREN: Array<{ entity: MovableEntity; table: string; key: string; label: string; noun: [string, string] }> = [
  { entity: "contact", table: "contacts", key: "id", label: "name", noun: ["person", "people"] },
  { entity: "deal", table: "deals", key: "deal_id", label: "name", noun: ["deal", "deals"] },
  { entity: "play", table: "plays", key: "id", label: "title", noun: ["play", "plays"] },
  { entity: "meeting", table: "meetings", key: "id", label: "title", noun: ["meeting", "meetings"] },
  { entity: "action_item", table: "action_items", key: "id", label: "text", noun: ["follow-up", "follow-ups"] },
  { entity: "install_base", table: "install_base", key: "id", label: "product_family", noun: ["install-base line", "install-base lines"] },
  { entity: "document", table: "documents", key: "id", label: "filename", noun: ["document", "documents"] },
  { entity: "ask_thread", table: "ask_threads", key: "id", label: "title", noun: ["conversation", "conversations"] },
];
const FILLABLE = ["crm_id", "legal_entity", "region", "segment", "hq", "thesis", "research_summary", "owner_user_id"] as const;

type AccountReceipt = {
  moved: Array<[MovableEntity, string]>;
  filled: Record<string, [Value, Value]>;
  calendar: string[];
  /** Whether the merged-away account was watched, and the kept one was. */
  watched: boolean;
  keeperWatched?: boolean;
};

export type AccountMergePlan = {
  keeper: AccountRow;
  loser: AccountRow;
  moves: Array<[MovableEntity, string]>;
  counts: Array<{ entity: MovableEntity; n: number; noun: string }>;
  fills: Array<{ field: string; value: Value }>;
  notCarried: string[];
  samePeople: string[];
};

function account(conn: Conn, id: string): AccountRow & { kind?: string } {
  const a = conn.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as (AccountRow & { kind?: string }) | undefined;
  if (!a) throw new ApplyError("That account does not exist.", "not_found");
  return a;
}

export function planAccountMerge(conn: Conn, keeperId: string, loserId: string): AccountMergePlan {
  if (keeperId === loserId) throw new ApplyError("Choose a different account to merge in.", "validation");
  const keeper = account(conn, keeperId);
  const loser = account(conn, loserId);
  for (const a of [keeper, loser]) {
    if (a.kind && a.kind !== "customer") throw new ApplyError("Only customer accounts can be merged.", "validation");
    if (a.archived_at) throw new ApplyError(`“${a.name}” is archived; restore it first.`, "state");
    if (a.merged_into) throw new ApplyError(`“${a.name}” was already merged into another account.`, "state");
  }
  const moves: Array<[MovableEntity, string]> = [];
  const counts: AccountMergePlan["counts"] = [];
  const notCarried: string[] = [];
  for (const c of CHILDREN) {
    const ids = conn.prepare(`SELECT ${c.key} FROM ${c.table} WHERE account_id = ?`).pluck().all(loserId) as string[];
    let n = 0;
    for (const id of ids) {
      if (c.entity === "install_base") {
        const line = conn.prepare(`SELECT product_family, as_of FROM install_base WHERE id = ?`).get(id) as { product_family: string; as_of: string };
        const clash = conn.prepare(`SELECT 1 FROM install_base WHERE account_id = ? AND product_family = ? AND as_of = ?`).get(keeperId, line.product_family, line.as_of);
        if (clash) {
          notCarried.push(`Install base “${line.product_family}” as of ${line.as_of}: “${keeper.name}” already has a line for it`);
          continue;
        }
      }
      moves.push([c.entity, id]);
      n += 1;
    }
    if (n) counts.push({ entity: c.entity, n, noun: c.noun[n === 1 ? 0 : 1] });
  }
  const fills: AccountMergePlan["fills"] = [];
  for (const f of FILLABLE) {
    const mine = keeper[f as keyof AccountRow] ?? null;
    const theirs = loser[f as keyof AccountRow] ?? null;
    if (theirs === null || theirs === "") continue;
    if (mine === null || mine === "") fills.push({ field: f, value: theirs as Value });
    else if (f === "thesis" && mine !== theirs) notCarried.push(`The account thesis of “${loser.name}”: “${keeper.name}” has its own`);
    else if (f === "research_summary" && mine !== theirs) notCarried.push(`The researched overview of “${loser.name}”: “${keeper.name}” has its own`);
  }
  const names = (id: string) => conn.prepare(`SELECT name FROM contacts WHERE account_id = ? AND archived_at IS NULL`).pluck().all(id) as string[];
  const mine = new Set(names(keeperId).map((n) => n.trim().toLowerCase()));
  const samePeople = [...new Set(names(loserId).filter((n) => mine.has(n.trim().toLowerCase())))];
  return { keeper, loser, moves, counts, fills, notCarried, samePeople };
}

export type AccountMergePreview =
  | { ok: true; loserName: string; counts: AccountMergePlan["counts"]; fills: string[]; notCarried: string[]; samePeople: string[] }
  | { ok: false; why: string };

export function previewAccountMerge(keeperId: string, loserId: string): AccountMergePreview {
  try {
    const p = planAccountMerge(db(), keeperId, loserId);
    return { ok: true, loserName: p.loser.name, counts: p.counts, fills: p.fills.map((f) => fieldLabel(f.field)), notCarried: p.notCarried, samePeople: p.samePeople };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, why: e.message };
    throw e;
  }
}

export function mergeAccounts(input: { keeperId: string; loserId: string; actorUserId: string | null }): { receiptId: string; moved: number } {
  const conn = db();
  return conn
    .transaction(() => {
      const { keeperId, loserId, actorUserId } = input;
      const plan = planAccountMerge(conn, keeperId, loserId);
      for (const [entity, id] of plan.moves) moveToAccount({ entity, id, from: loserId, to: keeperId, actorUserId });

      const filled: AccountReceipt["filled"] = {};
      if (plan.fills.length) {
        applyEntityChange({ accountId: keeperId, entityType: "account", op: "update", entityId: keeperId, payload: Object.fromEntries(plan.fills.map((f) => [f.field, f.value])), actorUserId });
        for (const f of plan.fills) filled[f.field] = [null, f.value];
      }

      // Calendar events matched to the merged-away account are the kept
      // account's now; so is a weekly watch, if only the other had one.
      const calendar = conn.prepare(`SELECT id FROM calendar_events WHERE account_id = ?`).pluck().all(loserId) as string[];
      conn.prepare(`UPDATE calendar_events SET account_id = ? WHERE account_id = ?`).run(keeperId, loserId);
      const loserWatched = !!conn.prepare(`SELECT 1 FROM watched_accounts WHERE account_id = ?`).get(loserId);
      const keeperWatched = !!conn.prepare(`SELECT 1 FROM watched_accounts WHERE account_id = ?`).get(keeperId);
      if (loserWatched && !keeperWatched) conn.prepare(`INSERT INTO watched_accounts (account_id, added_by, added_at) VALUES (?, ?, ?)`).run(keeperId, actorUserId, Date.now());
      if (loserWatched) conn.prepare(`DELETE FROM watched_accounts WHERE account_id = ?`).run(loserId);

      // Archived, which rejects anything still proposed for it and writes a
      // history line there, so a page open on it learns that it changed.
      archiveEntity({ accountId: loserId, entityType: "account", entityId: loserId, actorUserId });
      conn.prepare(`UPDATE accounts SET merged_into = ? WHERE id = ?`).run(keeperId, loserId);

      const now = Date.now();
      const log = conn.prepare(
        `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at) VALUES (?, ?, 'account', ?, ?, NULL, ?, ?, ?)`,
      );
      log.run(newId(), keeperId, keeperId, "merged_from", JSON.stringify(plan.loser.name), actorUserId, now);
      log.run(newId(), loserId, loserId, "merged_into", JSON.stringify(plan.keeper.name), actorUserId, now);

      const receipt: AccountReceipt = { moved: plan.moves, filled, calendar, watched: loserWatched, keeperWatched };
      const logSeq = (conn.prepare(`SELECT COALESCE(MAX(rowid), 0) FROM change_log`).pluck().get() as number) ?? 0;
      const receiptId = newId();
      conn
        .prepare(
          `INSERT INTO merge_receipts (id, account_id, entity_type, keeper_id, loser_id, keeper_label, loser_label, actor_user_id, created_at, changes_json, log_seq)
           VALUES (?, ?, 'account', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(receiptId, keeperId, keeperId, loserId, plan.keeper.name, plan.loser.name, actorUserId, now, JSON.stringify(receipt), logSeq);
      return { receiptId, moved: plan.moves.length };
    })
    .immediate();
}

// ---- undo -------------------------------------------------------------------

type ReceiptRow = { id: string; account_id: string; entity_type: string; keeper_id: string; loser_id: string; keeper_label: string; loser_label: string; changes_json: string; log_seq: number; undone_at: number | null };

export type AccountUnmergePlan = {
  back: Array<[MovableEntity, string]>;
  fieldsBack: Array<{ field: string; to: Value }>;
  calendar: string[];
  watched: boolean;
  keeperWatched: boolean;
  keptAsIs: string[];
  loserLabel: string;
  digest: string;
};

const parseIds = (json: unknown): string[] => {
  try {
    const v = JSON.parse(String(json ?? "[]")) as unknown;
    return Array.isArray(v) ? v.map((x) => (typeof x === "object" && x ? String((x as { contact_id?: unknown }).contact_id ?? "") : String(x))).filter(Boolean) : [];
  } catch {
    return [];
  }
};

function loadAccountReceipt(conn: Conn, keeperId: string, receiptId: string): ReceiptRow {
  const r = conn.prepare(`SELECT * FROM merge_receipts WHERE id = ?`).get(receiptId) as ReceiptRow | undefined;
  if (!r || r.account_id !== keeperId || r.entity_type !== "account") throw new ApplyError("That merge is not on this account.", "not_found");
  if (r.undone_at) throw new ApplyError("That merge has already been undone.", "state");
  const keeper = account(conn, keeperId);
  if (keeper.archived_at) throw new ApplyError("This account is archived; restore it before undoing a merge on it.", "state");
  const loser = account(conn, r.loser_id);
  if (loser.merged_into !== keeperId) throw new ApplyError(`“${r.loser_label}” is no longer merged into this account.`, "state");
  return r;
}

export function planAccountUnmerge(conn: Conn, keeperId: string, receiptId: string): AccountUnmergePlan {
  const r = loadAccountReceipt(conn, keeperId, receiptId);
  const receipt = JSON.parse(r.changes_json) as AccountReceipt;
  const keptAsIs: string[] = [];
  const meta = new Map(CHILDREN.map((c) => [c.entity, c]));
  const rowOf = (entity: MovableEntity, id: string) => {
    const c = meta.get(entity)!;
    return conn.prepare(`SELECT * FROM ${c.table} WHERE ${c.key} = ?`).get(id) as Record<string, Value> | undefined;
  };
  const nameOf = (entity: MovableEntity, id: string, row?: Record<string, Value>) => {
    const c = meta.get(entity)!;
    const v = row?.[c.label];
    return `${c.noun[0][0]!.toUpperCase()}${c.noun[0].slice(1)} “${typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : id}”`;
  };

  // What is still here, then what of that is now tied to the kept account's
  // own records (or they to it) — those stay, until nothing changes.
  const laterMove = conn.prepare(`SELECT 1 FROM change_log WHERE entity_type = ? AND entity_id = ? AND field = 'account_id' AND rowid > ? LIMIT 1`);
  let back = receipt.moved.filter(([entity, id]) => {
    const row = rowOf(entity, id);
    const movedSince = !!laterMove.get(entity, id, r.log_seq);
    if (!row) keptAsIs.push(`${nameOf(entity, id)} no longer exists`);
    else if (row.account_id !== keeperId || movedSince) keptAsIs.push(`${nameOf(entity, id, row)} has moved to another account since`);
    // A later decision to move away and back is still a later write. Keep
    // it, just as we keep a field somebody changed back to the merge's value.
    return !!row && row.account_id === keeperId && !movedSince;
  });
  for (;;) {
    const going = new Set(back.map(([, id]) => id));
    const tied = (entity: MovableEntity, id: string): boolean => {
      const row = rowOf(entity, id)!;
      // Its own links must all be going too.
      const own =
        entity === "play"
          ? [...parseIds(row.deal_ids_json), ...parseIds(row.contact_ids_json)]
          : entity === "action_item"
            ? [row.meeting_id, row.play_id].filter((v): v is string => typeof v === "string")
            : entity === "meeting"
              ? parseIds(row.attendees_json)
              : [];
      if (own.some((x) => !going.has(x))) return true;
      // And nothing staying may point at it.
      const like = `%"${id}"%`;
      const stayingPlay = conn.prepare(`SELECT id FROM plays WHERE account_id = ? AND (deal_ids_json LIKE ? OR contact_ids_json LIKE ?)`).pluck().all(keeperId, like, like) as string[];
      const stayingMeeting = conn.prepare(`SELECT id FROM meetings WHERE account_id = ? AND attendees_json LIKE ?`).pluck().all(keeperId, like) as string[];
      const stayingItem = conn.prepare(`SELECT id FROM action_items WHERE account_id = ? AND (meeting_id = ? OR play_id = ?)`).pluck().all(keeperId, id, id) as string[];
      return [...stayingPlay, ...stayingMeeting, ...stayingItem].some((x) => !going.has(x));
    };
    const next = back.filter(([entity, id]) => {
      if (!tied(entity, id)) return true;
      keptAsIs.push(`${nameOf(entity, id, rowOf(entity, id))} is now linked with “${r.keeper_label}”'s own records`);
      return false;
    });
    if (next.length === back.length) break;
    back = next;
  }

  const fieldsBack: AccountUnmergePlan["fieldsBack"] = [];
  const keeper = account(conn, keeperId) as unknown as Record<string, Value>;
  const laterWrite = conn.prepare(`SELECT 1 FROM change_log WHERE entity_type = 'account' AND entity_id = ? AND field = ? AND rowid > ? LIMIT 1`);
  for (const [field, [was, wrote]] of Object.entries(receipt.filled ?? {})) {
    if ((keeper[field] ?? null) === wrote && !laterWrite.get(keeperId, field, r.log_seq)) fieldsBack.push({ field, to: was });
    else keptAsIs.push(`${fieldLabel(field)} on “${r.keeper_label}” was changed since`);
  }
  const calendar = (receipt.calendar ?? []).filter((id) => {
    const ev = conn.prepare(`SELECT account_id FROM calendar_events WHERE id = ?`).get(id) as { account_id: string | null } | undefined;
    return ev?.account_id === keeperId;
  });
  const digest = createHash("sha256")
    .update(JSON.stringify([back, fieldsBack.map((f) => f.field), calendar, keptAsIs]))
    .digest("hex")
    .slice(0, 16);
  return { back, fieldsBack, calendar, watched: !!receipt.watched, keeperWatched: !!receipt.keeperWatched, keptAsIs, loserLabel: r.loser_label, digest };
}

export type AccountUnmergePreview = { ok: true; returns: number; keptAsIs: string[]; digest: string; loserLabel: string } | { ok: false; why: string };

export function previewAccountUnmerge(keeperId: string, receiptId: string): AccountUnmergePreview {
  try {
    const p = planAccountUnmerge(db(), keeperId, receiptId);
    return { ok: true, returns: p.back.length, keptAsIs: p.keptAsIs, digest: p.digest, loserLabel: p.loserLabel };
  } catch (e) {
    if (e instanceof ApplyError) return { ok: false, why: e.message };
    throw e;
  }
}

export function unmergeAccount(input: { keeperId: string; receiptId: string; actorUserId: string | null; expect?: string }): { returned: number; keptAsIs: string[] } {
  const conn = db();
  return conn
    .transaction(() => {
      const { keeperId, receiptId, actorUserId } = input;
      const plan = planAccountUnmerge(conn, keeperId, receiptId);
      if (input.expect !== undefined && input.expect !== plan.digest) {
        throw new ApplyError("Something on these accounts changed since this page was drawn. Read what the undo would do now, then press it again.", "conflict");
      }
      const r = conn.prepare(`SELECT loser_id, keeper_label FROM merge_receipts WHERE id = ?`).get(receiptId) as { loser_id: string; keeper_label: string };
      const loserId = r.loser_id;
      // The account first, so it is live to move records back onto.
      conn.prepare(`UPDATE accounts SET merged_into = NULL WHERE id = ?`).run(loserId);
      applyEntityChange({ accountId: loserId, entityType: "account", op: "update", entityId: loserId, payload: { archived_at: null }, actorUserId });
      for (const [entity, id] of plan.back) moveToAccount({ entity, id, from: keeperId, to: loserId, actorUserId });
      if (plan.fieldsBack.length) {
        applyEntityChange({ accountId: keeperId, entityType: "account", op: "update", entityId: keeperId, payload: Object.fromEntries(plan.fieldsBack.map((f) => [f.field, f.to])), actorUserId });
      }
      const ev = conn.prepare(`UPDATE calendar_events SET account_id = ? WHERE id = ? AND account_id = ?`);
      for (const id of plan.calendar) ev.run(loserId, id, keeperId);
      if (plan.watched) {
        conn.prepare(`INSERT OR IGNORE INTO watched_accounts (account_id, added_by, added_at) VALUES (?, ?, ?)`).run(loserId, actorUserId, Date.now());
        // The kept account's watch came from the merge only if it had none.
        if (!plan.keeperWatched) conn.prepare(`DELETE FROM watched_accounts WHERE account_id = ?`).run(keeperId);
      }
      const now = Date.now();
      const log = conn.prepare(
        `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at) VALUES (?, ?, 'account', ?, 'unmerged', NULL, ?, ?, ?)`,
      );
      log.run(newId(), keeperId, keeperId, JSON.stringify(`“${plan.loserLabel}” is its own account again`), actorUserId, now);
      log.run(newId(), loserId, loserId, JSON.stringify(`no longer merged into “${r.keeper_label}”`), actorUserId, now);
      conn.prepare(`UPDATE merge_receipts SET undone_at = ?, undone_by = ? WHERE id = ?`).run(now, actorUserId, receiptId);
      return { returned: plan.back.length, keptAsIs: plan.keptAsIs };
    })
    .immediate();
}
