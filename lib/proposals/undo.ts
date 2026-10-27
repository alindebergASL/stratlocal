// Undoing an accepted change (DECISIONS #98).
//
// An accept wrote fields and logged each one against the proposal. Undo puts
// back only the fields whose latest change is still that accept: anything
// someone wrote since stays, and is reported as kept, because undo must never
// overwrite a later decision. A record the accept created is archived, like
// every other removal here (DECISIONS #8), so its history survives.
//
// The proposal goes back to pending, as it was proposed (an edit made while
// accepting is dropped): undo means "let me decide that again", and the
// drift check sees any field that stayed changed if it is accepted twice.
import { db, type ProposalRow } from "../db";
import { applyEntityChange, archiveEntity, ApplyError, getProposal, isLargeField, loadRow } from "./apply";
import { isArchivable } from "./schema";

export type UndoResult = { reverted: string[]; kept: string[] };

export function undoAccepted(id: string, userId: string): UndoResult {
  const conn = db();
  return conn.transaction((): UndoResult => {
    const p = getProposal(id) as ProposalRow | null;
    if (!p) throw new ApplyError("proposal not found", "not_found");
    if (p.status !== "accepted" || !p.entity_id) throw new ApplyError(`proposal is ${p.status}, not accepted`, "state");
    const mark = () =>
      conn
        .prepare(
          `UPDATE proposals SET status = 'pending', decided_by = NULL, decided_at = NULL, undone_at = ?, undone_by = ?,
             entity_id = CASE WHEN op = 'create' THEN NULL ELSE entity_id END,
             payload_json = COALESCE(proposed_json, payload_json), proposed_json = NULL
           WHERE id = ?`,
        )
        .run(Date.now(), userId, id);

    if (p.op === "create") {
      if (!isArchivable(p.entity_type)) throw new ApplyError(`a new ${p.entity_type} cannot be taken back`, "state");
      const row = loadRow(p.entity_type, p.entity_id);
      if (row && !row.archived_at) archiveEntity({ accountId: p.account_id, entityType: p.entity_type, entityId: p.entity_id, actorUserId: userId });
      mark();
      return { reverted: ["created"], kept: [] };
    }

    const written = conn
      .prepare(`SELECT field, old_value FROM change_log WHERE proposal_id = ? AND entity_type = ? AND entity_id = ? ORDER BY rowid`)
      .all(id, p.entity_type, p.entity_id) as Array<{ field: string; old_value: string | null }>;
    const latest = conn.prepare(`SELECT proposal_id FROM change_log WHERE entity_type = ? AND entity_id = ? AND field = ? ORDER BY rowid DESC LIMIT 1`).pluck();
    const back: Record<string, unknown> = {};
    const kept: string[] = [];
    for (const w of written) {
      if (w.field in back || kept.includes(w.field)) continue;
      if (isLargeField(p.entity_type, w.field) || latest.get(p.entity_type, p.entity_id, w.field) !== id) {
        kept.push(w.field);
        continue;
      }
      back[w.field] = w.old_value === null ? null : JSON.parse(w.old_value);
    }
    if (Object.keys(back).length) applyEntityChange({ accountId: p.account_id, entityType: p.entity_type, op: "update", entityId: p.entity_id, payload: back, actorUserId: userId });
    mark();
    return { reverted: Object.keys(back), kept };
  })();
}
