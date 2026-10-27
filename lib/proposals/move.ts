// Moving a record to another account: the one write that is not an edit.
//
// "Which account does this belong to" is not a field any patch may carry —
// applyEntityChange refuses it on purpose, because a model must never be able
// to move a record and an ordinary edit should never do it by accident. So
// it is its own function, with its own rules, used by every caller that moves
// something: a deal opened against the wrong account, a task connected from
// Own work, and every row of an account merged into another.
//
// The rules, the same for every kind of record:
// - Both accounts exist; the target is live.
// - The record is on `from`, and, when a version is given, still at it.
// - Anything still proposed for the record is rejected: it was written
//   against the old account, and its before_json cannot see the move.
// - One history row on each account, so the move reads from either side and
//   the record's earlier history stays where it was written.
// - Runs inside the caller's transaction, as a savepoint when there is one.
import { db } from "../db";
import { newId } from "../ids";
import { ApplyError } from "./apply";

const TABLES = {
  contact: { table: "contacts", key: "id", versioned: true },
  deal: { table: "deals", key: "deal_id", versioned: true },
  install_base: { table: "install_base", key: "id", versioned: true },
  play: { table: "plays", key: "id", versioned: true },
  meeting: { table: "meetings", key: "id", versioned: true },
  action_item: { table: "action_items", key: "id", versioned: true },
  document: { table: "documents", key: "id", versioned: false },
  ask_thread: { table: "ask_threads", key: "id", versioned: true },
} as const;

export type MovableEntity = keyof typeof TABLES;

export function moveToAccount(input: {
  entity: MovableEntity;
  id: string;
  from: string;
  to: string;
  actorUserId: string | null;
  /** The version the caller rendered; omitted when the caller has none to check. */
  baseVersion?: number | null;
}): { version: number | null } {
  const conn = db();
  const { table, key, versioned } = TABLES[input.entity];
  return conn.transaction((): { version: number | null } => {
    if (input.from === input.to) throw new ApplyError(`that ${input.entity.replace("_", " ")} is already on that account`, "validation");
    const target = conn.prepare(`SELECT archived_at FROM accounts WHERE id = ?`).get(input.to) as { archived_at: string | null } | undefined;
    if (!target) throw new ApplyError("that account does not exist", "not_found");
    if (target.archived_at) throw new ApplyError("that account is archived; restore it first", "state");
    const row = conn.prepare(`SELECT account_id${versioned ? ", updated_at" : ""} FROM ${table} WHERE ${key} = ?`).get(input.id) as
      | { account_id: string; updated_at?: number }
      | undefined;
    if (!row) throw new ApplyError(`${input.entity} ${input.id} not found`, "not_found");
    if (row.account_id !== input.from) throw new ApplyError(`${input.entity} ${input.id} is not on that account`, "validation");
    if (versioned && input.baseVersion !== undefined && input.baseVersion !== null && row.updated_at !== input.baseVersion) {
      throw new ApplyError("This changed since you opened it. Reload before moving it.", "conflict");
    }

    const now = Math.max(Date.now(), (row.updated_at ?? 0) + 1);
    if (versioned) conn.prepare(`UPDATE ${table} SET account_id = ?, updated_at = ? WHERE ${key} = ?`).run(input.to, now, input.id);
    else conn.prepare(`UPDATE ${table} SET account_id = ? WHERE ${key} = ?`).run(input.to, input.id);

    conn
      .prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE status = 'pending' AND entity_type = ? AND entity_id = ?`)
      .run(input.actorUserId, now, input.entity, input.id);

    const log = conn.prepare(
      `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, 'account_id', ?, ?, ?, ?)`,
    );
    for (const account of [input.from, input.to]) log.run(newId(), account, input.entity, input.id, JSON.stringify(input.from), JSON.stringify(input.to), input.actorUserId, now);
    return { version: versioned ? now : null };
  })();
}
