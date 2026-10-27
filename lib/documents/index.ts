// The one writer for `documents` rows.
//
// A document is not an entity (DECISIONS #8): it is not in PATCH_SCHEMAS, not
// in proposals.entity_type, and nothing can ever propose one. So it does not
// go through applyEntityChange — but it still earns a history line, because
// "who hid this, and when" is exactly the question someone asks later.
// change_log.entity_type has no CHECK, so `document` rows sit alongside the
// rest and entityHistory("document", id) reads them back unchanged.
import { db, type DocumentRow } from "../db";
import { newId } from "../ids";
import { ApplyError, today } from "../proposals/apply";
import { getDocument } from "../queries/accounts";

export function logDocumentChange(input: {
  accountId: string;
  documentId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  actorUserId: string | null;
}) {
  db()
    .prepare(
      `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, proposal_id, source_ref_json, created_at)
       VALUES (?, ?, 'document', ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .run(
      newId(),
      input.accountId,
      input.documentId,
      input.field,
      input.oldValue === null || input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      input.newValue === null || input.newValue === undefined ? null : JSON.stringify(input.newValue),
      input.actorUserId,
      Date.now(),
    );
}

function setArchivedAt(documentId: string, actorUserId: string | null, day: string | null): DocumentRow {
  const conn = db();
  return conn.transaction((): DocumentRow => {
    const doc = getDocument(documentId);
    if (!doc) throw new ApplyError(`document ${documentId} not found`, "not_found");
    if (doc.archived_at === day) return doc;
    conn.prepare(`UPDATE documents SET archived_at = ? WHERE id = ?`).run(day, documentId);
    logDocumentChange({
      accountId: doc.account_id,
      documentId,
      field: "archived_at",
      oldValue: doc.archived_at,
      newValue: day,
      actorUserId,
    });
    // A research note that is no longer trusted must not still be able to
    // become part of the plan. Nothing records which proposals came from
    // which note, so this rejects the account's pending plan drafts as a
    // whole — over-rejection by a little, and a draft is cheap to re-run.
    if (day !== null && doc.kind === "research_note") {
      conn
        .prepare(
          `UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ?
           WHERE account_id = ? AND status = 'pending' AND origin_kind = 'plan_draft'`,
        )
        .run(actorUserId, Date.now(), doc.account_id);
    }
    return getDocument(documentId) as DocumentRow;
  })();
}

export function archiveDocument(documentId: string, actorUserId: string | null, day = today()): DocumentRow {
  return setArchivedAt(documentId, actorUserId, day);
}

export function restoreDocument(documentId: string, actorUserId: string | null): DocumentRow {
  return setArchivedAt(documentId, actorUserId, null);
}
