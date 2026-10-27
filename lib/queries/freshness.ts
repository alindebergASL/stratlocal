import { db } from "../db";
import { formatRevision } from "../freshness";

// Where an account is in its own history, right now.
//
// Account-scoped: change_log.account_id is NOT NULL and every hand edit goes
// through applyEntityChange, so this moves when — and only when — something on
// this account was written. Another account's busy afternoon is invisible here,
// which is what stops one open page from nagging about the other one's work.
//
// Proposals are counted too. A new batch of proposed changes and a rejection
// write no history row — nothing on the account changed yet — so the cursor
// used to stand still while the other one's extraction filled the review list,
// or while they turned a proposal down that you were looking at. `count` now
// includes every proposal row and every decided one; neither table is ever
// deleted from, so both only grow, and the token's format is unchanged.
export function accountRevision(accountId: string): string {
  const row = db()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM change_log WHERE account_id = ?) AS history,
              (SELECT COALESCE(MAX(rowid), 0) FROM change_log WHERE account_id = ?) AS seq,
              (SELECT COUNT(*) + COUNT(decided_at) FROM proposals WHERE account_id = ?) AS proposals`,
    )
    .get(accountId, accountId, accountId) as { history: number; seq: number; proposals: number };
  return formatRevision({ count: row.history + row.proposals, seq: row.seq });
}
