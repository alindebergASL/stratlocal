// The one place rows change. Manual edits and accepted proposals both come
// through applyEntityChange, which validates the payload, writes only the
// fields that actually differ, and records one change_log row per field.
import { z } from "zod";
import type Database from "better-sqlite3";
import { db, type ProposalRow, OWN_WORK_ACCOUNT_ID } from "../db";
import { newId, newLocalDealId } from "../ids";
import { todayISO } from "../clock";
import { fiscalQuarter } from "../fiscal";
import { sizeMarker } from "../format";
import { QUALIFICATION_COLUMNS } from "../playbook/qualificationFields";
import { WAIVER_ENDS_ON } from "../deals/nextStep";
import { CREATE_REQUIRED, isArchivable, parsePayload, type Archivable, type EntityType, type ProposalDraft, type SourceRef } from "./schema";

const TABLE: Record<EntityType, { table: string; pk: string; hasUpdatedAt: boolean }> = {
  account: { table: "accounts", pk: "id", hasUpdatedAt: true },
  contact: { table: "contacts", pk: "id", hasUpdatedAt: true },
  deal: { table: "deals", pk: "deal_id", hasUpdatedAt: true },
  install_base: { table: "install_base", pk: "id", hasUpdatedAt: true },
  play: { table: "plays", pk: "id", hasUpdatedAt: true },
  action_item: { table: "action_items", pk: "id", hasUpdatedAt: true },
  meeting: { table: "meetings", pk: "id", hasUpdatedAt: true },
};

// Payload field -> column. Structured values are stored as JSON text.
const JSON_FIELDS: Record<EntityType, Record<string, string>> = {
  account: { ...QUALIFICATION_COLUMNS },
  contact: {},
  deal: {},
  install_base: {},
  play: { deal_ids: "deal_ids_json", contact_ids: "contact_ids_json" },
  action_item: { source_ref: "source_ref_json" },
  meeting: { attendees: "attendees_json" },
};

// Fields that hold a document rather than a value. They are written the same
// way, but history records how big the new content was instead of copying it
// twice per edit, and a proposal may never carry one: the model proposes a
// meeting's summary, never its notes or its brief.
const LARGE_FIELDS: Record<EntityType, ReadonlySet<string>> = {
  account: new Set(),
  contact: new Set(),
  deal: new Set(),
  install_base: new Set(),
  play: new Set(),
  action_item: new Set(),
  meeting: new Set(["raw_notes", "brief_json", "brief_edits_json"]),
};

export function isLargeField(entityType: EntityType, field: string): boolean {
  return LARGE_FIELDS[entityType].has(field);
}

export class ApplyError extends Error {
  constructor(
    message: string,
    public code: "validation" | "not_found" | "conflict" | "state",
  ) {
    super(message);
  }
}

// One field two people wrote, and what the record says now.
export type FieldConflict = {
  field: string;
  theirs: string | null;
  actorUserId: string | null;
  atMs: number;
};

// The second save, refused.
//
// Accepting a proposal has always checked before_json against the live row and
// stopped when they disagreed. A form save checked nothing: it was an
// unconditional UPDATE keyed on the primary key, so whoever pressed the button
// second won, silently, and the only trace was two change_log rows nobody had
// reason to read. For most fields that is recoverable by someone who goes
// looking. For a meeting's notes it is not — they are a LARGE_FIELD, so
// history keeps their size and not their text, and the column is the only copy.
//
// Carries what it needs to be explained rather than just reported: which
// fields, what they hold now, who put it there, and the version to submit with
// if the answer is "mine anyway".
export class ConflictError extends ApplyError {
  constructor(
    public conflicts: FieldConflict[],
    public currentVersion: number | null,
  ) {
    super(`changed since you opened this: ${conflicts.map((c) => c.field.replace(/_/g, " ")).join(", ")}`, "conflict");
  }
}

// Which of `fields` were written to after `baseVersion`, newest write first.
//
// change_log is the record of who changed what and when, and it is indexed
// (entity_type, entity_id, created_at DESC) — the exact shape of this read.
// Comparing against it rather than against `updated_at` alone is what makes
// the refusal precise: a save is only stopped when the other person touched a
// field this save would actually change. Correcting a deal's notes does not
// block someone else editing its next step.
function driftedFields(conn: Database.Database, entityType: EntityType, entityId: string, baseVersion: number, fields: string[]): FieldConflict[] {
  const wanted = new Set(fields);
  const rows = conn
    .prepare(
      `SELECT field, new_value, actor_user_id, created_at FROM change_log
       WHERE entity_type = ? AND entity_id = ? AND created_at > ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(entityType, entityId, baseVersion) as Array<{
    field: string;
    new_value: string | null;
    actor_user_id: string | null;
    created_at: number;
  }>;
  const out: FieldConflict[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!wanted.has(r.field) || seen.has(r.field)) continue;
    seen.add(r.field);
    out.push({
      field: r.field,
      theirs: r.new_value,
      actorUserId: r.actor_user_id,
      atMs: r.created_at,
    });
  }
  return out;
}

function columnFor(entityType: EntityType, field: string): string {
  return JSON_FIELDS[entityType][field] ?? field;
}

function toStored(entityType: EntityType, field: string, value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (JSON_FIELDS[entityType][field]) return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

function fromStored(entityType: EntityType, field: string, value: unknown): unknown {
  const column = JSON_FIELDS[entityType][field];
  if (column && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      // Only written by toStored, so this is unreachable in practice. An
      // array-shaped column falls back to empty so a comparison against a
      // real array does not report a spurious change.
      return column.endsWith("_ids_json") || column === "attendees_json" ? [] : null;
    }
  }
  return value ?? null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function logValue(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v);
}

// What history records for a document-sized field.
function logMarker(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return sizeMarker(Buffer.byteLength(String(v), "utf8"));
}

function logFor(entityType: EntityType, field: string, v: unknown): string | null {
  return isLargeField(entityType, field) ? logMarker(v) : logValue(v);
}

export function loadRow(entityType: EntityType, entityId: string): Record<string, unknown> | null {
  const t = TABLE[entityType];
  const row = db().prepare(`SELECT * FROM ${t.table} WHERE ${t.pk} = ?`).get(entityId) as Record<string, unknown> | undefined;
  return row ?? null;
}

// Current values of the given payload fields, in payload shape (arrays parsed).
export function currentValues(entityType: EntityType, entityId: string, fields: string[]): Record<string, unknown> | null {
  const row = loadRow(entityType, entityId);
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = fromStored(entityType, f, row[columnFor(entityType, f)]);
  return out;
}

function assertLinkedIds(accountId: string, payload: Record<string, unknown>) {
  const conn = db();
  const dealIds = payload.deal_ids as string[] | undefined;
  if (dealIds) {
    const q = conn.prepare(`SELECT 1 FROM deals WHERE deal_id = ? AND account_id = ?`);
    for (const id of dealIds) if (!q.get(id, accountId)) throw new ApplyError(`unknown deal ${id}`, "validation");
  }
  const contactIds = payload.contact_ids as string[] | undefined;
  if (contactIds) {
    const q = conn.prepare(`SELECT 1 FROM contacts WHERE id = ? AND account_id = ?`);
    for (const id of contactIds) if (!q.get(id, accountId)) throw new ApplyError(`unknown contact ${id}`, "validation");
  }
}

// ---- operational references to a record that has been merged away ----------

// A follow-up's `meeting_id` and `play_id` are operational links: they say
// which conversation or which play this piece of work belongs to *now*, and
// every screen reads them as current. A merged-away record is a tombstone
// (DECISIONS #33), and both importers already follow the pointer to the
// survivor before they propose anything — but a proposal written before a
// merge still carries the loser's id, and nothing between it and the row it
// wrote checked. Accepting it created a follow-up hanging off a record that no
// list shows and `restoreEntity` refuses to bring back.
//
// So the check lives here, at the one writer (DECISIONS #1), which is what
// makes it cover the direct save and the accepted proposal, the create and the
// update, without either caller having to remember. It either resolves to the
// record that actually survived or refuses and says why; what it never does is
// write the tombstone's id and report success (DECISIONS #15).
//
// `source_ref` is deliberately untouched. That is provenance — which meeting a
// quote came from, on the day it was said — and rewriting it would be forging
// it. The merge itself takes the same position on the refs it leaves alone.
const MERGEABLE_REF = { meeting_id: "meeting", play_id: "play" } as const;

// The same bound playKeeperOf uses, for the same reason: this runs on a save
// somebody is waiting for, and a cycle in the pointers must not hang it.
const MERGE_CHAIN_MAX = 20;

type RefRow = { id: string; account_id: string; archived_at: string | null; merged_into: string | null };

function resolveMergedRefs(accountId: string, payload: Record<string, unknown>) {
  const conn = db();
  for (const [field, kind] of Object.entries(MERGEABLE_REF) as Array<[string, "meeting" | "play"]>) {
    const given = payload[field];
    // null is an explicit unlink and undefined is an omission; neither names a
    // record to resolve.
    if (typeof given !== "string" || given === "") continue;
    const t = TABLE[kind];
    const stmt = conn.prepare(`SELECT ${t.pk} AS id, account_id, archived_at, merged_into FROM ${t.table} WHERE ${t.pk} = ?`);
    const at = (id: string): RefRow | undefined => stmt.get(id) as RefRow | undefined;

    let row = at(given);
    if (!row) throw new ApplyError(`${kind} ${given} does not exist`, "not_found");
    if (row.account_id !== accountId) throw new ApplyError(`${kind} ${given} belongs to another account`, "validation");

    const seen = new Set<string>([given]);
    for (let depth = 0; row.merged_into; depth += 1) {
      const next: string = row.merged_into;
      if (depth >= MERGE_CHAIN_MAX || seen.has(next)) {
        throw new ApplyError(`${kind} ${given} was merged, and the record it points at cannot be resolved`, "validation");
      }
      seen.add(next);
      const target = at(next);
      if (!target) throw new ApplyError(`${kind} ${given} was merged into ${next}, which no longer exists`, "not_found");
      if (target.account_id !== accountId) throw new ApplyError(`${kind} ${given} was merged into a record on another account`, "validation");
      row = target;
    }

    if (row.id === given) continue;
    if (row.archived_at) {
      throw new ApplyError(`${kind} ${given} was merged into ${row.id}, which is archived; restore it first if this still belongs there`, "state");
    }
    payload[field] = row.id;
  }
}

export type ApplyInput = {
  accountId: string;
  entityType: EntityType;
  op: "create" | "update";
  entityId?: string | null;
  payload: Record<string, unknown>;
  actorUserId: string | null;
  proposalId?: string | null;
  sourceRef?: SourceRef | null;
  // The row's `updated_at` as the form that is submitting saw it. Given, an
  // update is refused when someone else has since written to a field this
  // payload would change. Omitted, the write behaves exactly as it always
  // has — which is what every caller that is not a person at a form wants,
  // the proposal path included: that has its own drift check, against
  // before_json, and it predates this one.
  baseVersion?: number | null;
};

export type ApplyResult = {
  entityId: string;
  changedFields: string[];
  version?: number;
};

// Validates, writes, logs. Runs inside its own transaction unless the caller
// already holds one (better-sqlite3 nests transactions with savepoints).
export function applyEntityChange(input: ApplyInput): ApplyResult {
  const conn = db();
  const run = conn.transaction((): ApplyResult => {
    const entityType = input.entityType;
    let payload: Record<string, unknown>;
    try {
      payload = parsePayload(entityType, input.payload);
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e);
      throw new ApplyError(`invalid ${entityType} payload: ${msg}`, "validation");
    }
    // Zod's .partial() keeps a key that is present with the value undefined,
    // and every action writes `str(fd, "x") ?? undefined` to mean "leave this
    // alone". Without this the key survives, toStored maps it to null, and a
    // single space typed into a required field becomes SET name = NULL and a
    // constraint error that discards the whole form. `undefined` never means
    // "clear" anywhere in this codebase — omitting is how you leave a field
    // alone, and null is how you clear it.
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

    if (entityType !== "account" && entityType !== "install_base") assertLinkedIds(input.accountId, payload);
    // After the payload is parsed and before anything is compared or written,
    // so an id that resolves to the survivor is the id the drift check and the
    // history line both see.
    if (entityType === "action_item") resolveMergedRefs(input.accountId, payload);

    // A deal's fiscal quarter defaults from its close date when not given.
    if (entityType === "deal" && payload.close_date && payload.fiscal_quarter === undefined) {
      const fq = fiscalQuarter(String(payload.close_date));
      if (fq) payload.fiscal_quarter = fq.label;
    }

    if (entityType === "meeting" && "brief_edits_json" in input.payload && input.proposalId) {
      throw new ApplyError("AI proposals cannot write human preparation provenance.", "validation");
    }
    const t = TABLE[entityType];
    let nowMs = Date.now();
    const sourceRefJson = input.sourceRef ? JSON.stringify(input.sourceRef) : null;
    const logStmt = conn.prepare(
      `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, proposal_id, source_ref_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    if (input.op === "create") {
      // A deal with no CRM id gets a local one, here rather than at the call
      // site. DECISIONS #16 says a deal added without one gets a local id so a
      // merge is possible later, and that is a property of deals — but it was
      // implemented once, in the deal form, so the second writer to create a
      // deal without an id hit `deal.deal_id is required` at accept time.
      // That was the spreadsheet import, whose rows genuinely need not carry
      // one, and it failed on the accept rather than on the proposal: the
      // review screen looked right and the button did not work.
      if (entityType === "deal" && (payload.deal_id === undefined || payload.deal_id === null || payload.deal_id === "")) {
        payload.deal_id = newLocalDealId();
      }
      for (const f of CREATE_REQUIRED[entityType]) {
        if (payload[f] === undefined || payload[f] === null || payload[f] === "") {
          throw new ApplyError(`${entityType}.${f} is required`, "validation");
        }
      }
      const id = entityType === "deal" ? String(payload.deal_id) : (input.entityId ?? newId());
      if (loadRow(entityType, id)) throw new ApplyError(`${entityType} ${id} already exists`, "conflict");
      const cols: string[] = [t.pk, "created_at"];
      const vals: Array<string | number | null> = [id, nowMs];
      if (t.hasUpdatedAt) {
        cols.push("updated_at");
        vals.push(nowMs);
      }
      if (entityType !== "account") {
        cols.push("account_id");
        vals.push(input.accountId);
      }
      const changed: string[] = [];
      for (const [field, value] of Object.entries(payload)) {
        if (entityType === "deal" && field === "deal_id") continue;
        // Empty fields on a new row are not a change worth a history line.
        if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
        cols.push(columnFor(entityType, field));
        vals.push(toStored(entityType, field, value));
        changed.push(field);
      }
      conn.prepare(`INSERT INTO ${t.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
      for (const field of changed) {
        logStmt.run(
          newId(),
          input.accountId,
          entityType,
          id,
          field,
          null,
          logFor(entityType, field, payload[field]),
          input.actorUserId,
          input.proposalId ?? null,
          sourceRefJson,
          nowMs,
        );
      }
      return { entityId: id, changedFields: changed };
    }

    // update
    const id = input.entityId;
    if (!id) throw new ApplyError("entity_id required for update", "validation");
    const row = loadRow(entityType, id);
    if (!row) throw new ApplyError(`${entityType} ${id} not found`, "not_found");
    if (t.hasUpdatedAt) nowMs = Math.max(nowMs, Number(row.updated_at) + 1);
    if (entityType !== "account" && row.account_id !== input.accountId) {
      throw new ApplyError(`${entityType} ${id} belongs to another account`, "validation");
    }
    if (entityType === "account" && id !== input.accountId) {
      throw new ApplyError("account id mismatch", "validation");
    }
    // A record archived while this form was open. loadRow is unfiltered on
    // purpose, so that restore and history keep working — which also meant
    // nothing stopped a save landing on a row that is no longer in any list.
    // A payload that mentions archived_at is the exception and the reason: a
    // restore, by hand or from an import that still lists the row.
    //
    // Only for a save with a form behind it. This first shipped unconditional
    // and broke every merge in the app: three of the relink loops in
    // lib/proposals/merge.ts select archived rows *deliberately* — an archived
    // play can be restored, and it would come back pointing at a merged-away
    // id — so they threw inside the merge's transaction and rolled the whole
    // thing back, with a message blaming a form nobody had open. `baseVersion`
    // is the thing that actually separates "a person looking at a stale page"
    // from every system caller, which is what this check was always after.
    if (input.baseVersion != null && row.archived_at && payload.archived_at === undefined) {
      throw new ApplyError(`that ${entityType.replace(/_/g, " ")} was archived while this was open; restore it first if the change is still wanted`, "state");
    }

    // A "no next step needed" waiver ends when the deal moves (a stage, close
    // date, status or a next step written), unless the same change sets one
    // (DECISIONS #88). It is cleared as part of the change, so history says so.
    if (entityType === "deal" && row.next_step_waived && !("next_step_waived" in payload)) {
      const moved = WAIVER_ENDS_ON.some((f) => f in payload && (f === "next_step" ? !!String(payload[f] ?? "").trim() : (payload[f] ?? null) !== (row[f] ?? null)));
      if (moved) Object.assign(payload, { next_step_waived: null, next_step_waived_until: null, next_step_waived_reason: null });
    }

    // Explicit next-step provenance is immutable; operational play membership
    // may still change without rewriting where the commitment came from.
    if (entityType === "action_item" && id.startsWith("commitment-") && payload.source_ref !== undefined &&
        !sameValue(fromStored(entityType, "source_ref", row.source_ref_json), payload.source_ref)) {
      throw new ApplyError("A commitment source cannot be rewritten.", "validation");
    }

    // What this payload would actually change, worked out before anything is
    // written so the conflict check has something to intersect with.
    const pending: Array<{
      field: string;
      col: string;
      before: unknown;
      value: unknown;
    }> = [];
    for (const [field, value] of Object.entries(payload)) {
      // A deal's id is its primary key and is cited by every change_log row,
      // every play link and every proposal. This used to be skipped silently,
      // so an update carrying a different one reported success and changed
      // nothing — immutable by silence rather than by rule.
      if (entityType === "deal" && field === "deal_id") {
        if (value !== id) throw new ApplyError("a deal's id cannot be changed; merge the two rows instead", "validation");
        continue;
      }
      const col = columnFor(entityType, field);
      const before = fromStored(entityType, field, row[col]);
      if (sameValue(before, value)) continue;
      pending.push({ field, col, before, value });
    }
    if (pending.length === 0) return { entityId: id, changedFields: [] };

    // Someone else got here first. Only refused on a real overlap: a field
    // this save would change that they have already changed since this form
    // was rendered.
    if (input.baseVersion != null && t.hasUpdatedAt) {
      const conflicts = driftedFields(
        conn,
        entityType,
        id,
        input.baseVersion,
        pending.map((p) => p.field),
      );
      if (conflicts.length > 0) throw new ConflictError(conflicts, Number(row.updated_at ?? 0) || null);
    }

    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    const changed: string[] = [];
    for (const { field, col, before, value } of pending) {
      sets.push(`${col} = ?`);
      vals.push(toStored(entityType, field, value));
      changed.push(field);
      logStmt.run(
        newId(),
        input.accountId,
        entityType,
        id,
        field,
        logFor(entityType, field, before),
        logFor(entityType, field, value),
        input.actorUserId,
        input.proposalId ?? null,
        sourceRefJson,
        nowMs,
      );
    }
    if (t.hasUpdatedAt) {
      sets.push("updated_at = ?");
      vals.push(nowMs);
    }
    vals.push(id);
    conn.prepare(`UPDATE ${t.table} SET ${sets.join(", ")} WHERE ${t.pk} = ?`).run(...vals);
    // The caller that stays on screen after a save needs to know what the row
    // is now, or its next save is measured against the picture before this one.
    return {
      entityId: id,
      changedFields: changed,
      version: t.hasUpdatedAt ? nowMs : undefined,
    };
  });
  return run();
}

// ---- proposals --------------------------------------------------------------

export type BatchOrigin = {
  kind: "import" | "meeting" | "plan_draft";
  id: string | null;
  aiRunId: string | null;
};

// Stores drafts as pending proposals. For updates, the current values of the
// touched fields are captured as before_json so a later accept can detect
// that someone edited the row in between.
// What the account held when a model read it.
//
// A model run reads the account, waits for the model, then files proposals.
// The proposal's "before" — what the accept-time conflict check compares
// against — used to be read at filing time, after the wait. So a person's
// edit made while the model was thinking became the baseline, and the stale
// answer that ignored it was accepted with no conflict: a deal moved to stage
// 6 during extraction took the model's "stage 4" without a word. A run now
// captures this before it calls the model and files against it.
export type Baseline = { values: (entityType: EntityType, entityId: string, fields: string[]) => Record<string, unknown> | null };

export function captureBaseline(accountId: string): Baseline {
  const conn = db();
  const rows = new Map<string, Record<string, unknown>>();
  for (const [entityType, t] of Object.entries(TABLE) as Array<[EntityType, (typeof TABLE)[EntityType]]>) {
    const where = entityType === "account" ? "id = ?" : "account_id = ?";
    for (const row of conn.prepare(`SELECT * FROM ${t.table} WHERE ${where}`).all(accountId) as Array<Record<string, unknown>>) {
      rows.set(`${entityType}\u0000${String(row[t.pk])}`, row);
    }
  }
  return {
    values(entityType, entityId, fields) {
      const row = rows.get(`${entityType}\u0000${entityId}`);
      if (!row) return null;
      const out: Record<string, unknown> = {};
      for (const f of fields) out[f] = fromStored(entityType, f, row[columnFor(entityType, f)]);
      return out;
    },
  };
}

export function createProposalBatch(
  accountId: string,
  origin: BatchOrigin,
  drafts: ProposalDraft[],
  opts: { baseline?: Baseline } = {},
): { batchId: string; ids: string[]; kept: number[] } {
  const conn = db();
  const batchId = newId();
  const kept: number[] = [];
  const ids: string[] = [];
  const insert = conn.prepare(
    `INSERT INTO proposals (id, account_id, batch_id, origin_kind, origin_id, ai_run_id, entity_type, entity_id, op, payload_json, before_json, rationale, source_ref_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const previouslyRejected = conn.prepare(
    `SELECT 1 FROM proposals WHERE account_id = ? AND status = 'rejected' AND decided_by IS NOT NULL AND entity_type = ? AND op = ?
       AND COALESCE(entity_id, '') = COALESCE(?, '') AND payload_json = ?`,
  );
  conn.transaction(() => {
    // Which drafts became proposals, by their index in `drafts`: a caller that
    // groups drafts (one suggestion can make several) needs to know which
    // group the declined ones belonged to.
    for (const [index, d] of drafts.entries()) {
      // Validate now so a malformed draft is rejected at creation, not at accept.
      const payload = parsePayload(d.entity_type, d.payload);
      // A document-sized field would be copied into payload_json and
      // before_json and compared in full by the dedupe below. Nothing should
      // ever propose one.
      for (const field of Object.keys(payload)) {
        if (isLargeField(d.entity_type, field)) {
          throw new ApplyError(`${d.entity_type}.${field} cannot be proposed`, "validation");
        }
      }
      // Archiving is a person's decision. A proposal may clear archived_at,
      // which is how an import restores a record it still lists, but it may
      // never set one.
      if (payload.archived_at != null) {
        throw new ApplyError(`${d.entity_type}.archived_at cannot be set by a proposal`, "validation");
      }
      // Someone already said no to exactly this change; do not ask again.
      if (previouslyRejected.get(accountId, d.entity_type, d.op, d.entity_id ?? null, JSON.stringify(payload))) continue;
      if (
        origin.id === "research_updates" &&
        conn
          .prepare(
            `SELECT 1 FROM proposals WHERE account_id=? AND origin_id='research_updates' AND entity_type=? AND op=? AND payload_json=? AND (op='create' OR COALESCE(entity_id,'')=COALESCE(?,'')) LIMIT 1`,
          )
          .get(accountId, d.entity_type, d.op, JSON.stringify(payload), d.entity_id ?? null)
      )
        continue;
      if (origin.id === "research_updates" && d.entity_type === "action_item" && d.source_ref?.kind === "research" && d.source_ref.id && d.source_ref.finding_index !== undefined) {
        const prior = conn
          .prepare("SELECT source_ref_json FROM proposals WHERE account_id=? AND origin_id='research_updates' AND entity_type='action_item'")
          .all(accountId) as Array<{ source_ref_json: string | null }>;
        if (
          prior.some((row) => {
            try {
              const ref = JSON.parse(row.source_ref_json ?? "null");
              return ref?.id === d.source_ref!.id && ref?.finding_index === d.source_ref!.finding_index;
            } catch {
              return false;
            }
          })
        )
          continue;
      }
      let beforeJson: string | null = null;
      if (d.op === "update") {
        if (!d.entity_id) throw new ApplyError("update draft without entity_id", "validation");
        const current = currentValues(d.entity_type, d.entity_id, Object.keys(payload));
        if (!current) throw new ApplyError(`${d.entity_type} ${d.entity_id} not found`, "not_found");
        // Drop no-op updates: nothing to propose.
        const differs = Object.keys(payload).some((f) => !sameValue(current[f], payload[f]));
        if (!differs) continue;
        // The baseline is what the model saw, when there is one; a record it
        // never saw (created since) falls back to now.
        beforeJson = JSON.stringify(opts.baseline?.values(d.entity_type, d.entity_id, Object.keys(payload)) ?? current);
      }
      const id = newId();
      insert.run(
        id,
        accountId,
        batchId,
        origin.kind,
        origin.id,
        origin.aiRunId,
        d.entity_type,
        d.entity_id ?? null,
        d.op,
        JSON.stringify(payload),
        beforeJson,
        d.rationale ?? null,
        d.source_ref ? JSON.stringify(d.source_ref) : null,
        Date.now(),
      );
      ids.push(id);
      kept.push(index);
    }
  })();
  return { batchId, ids, kept };
}

export function getProposal(id: string): ProposalRow | null {
  return (db().prepare(`SELECT * FROM proposals WHERE id = ?`).get(id) as ProposalRow | undefined) ?? null;
}

export type DecideResult = {
  status: "accepted" | "rejected" | "conflict";
  entityId?: string;
  message?: string;
};

export function acceptProposal(id: string, userId: string, review: { ackEvidence?: boolean; edits?: Record<string, unknown> } = {}): DecideResult {
  const conn = db();
  return conn.transaction((): DecideResult => {
    const p = getProposal(id);
    if (!p) throw new ApplyError("proposal not found", "not_found");
    if (p.status !== "pending") throw new ApplyError(`proposal is ${p.status}`, "state");
    const payload = JSON.parse(p.payload_json) as Record<string, unknown>;
    // Edited before accepting (DECISIONS #98): only a value the proposal
    // already proposes may change, so an edit can correct a change but never
    // widen it to a field nobody proposed. What was proposed is kept.
    if (review.edits && Object.keys(review.edits).length > 0) {
      const extra = Object.keys(review.edits).filter((f) => !(f in payload));
      if (extra.length) throw new ApplyError(`not proposed, so not editable here: ${extra.join(", ")}`, "validation");
      Object.assign(payload, review.edits);
      conn.prepare(`UPDATE proposals SET proposed_json = payload_json, payload_json = ? WHERE id = ?`).run(JSON.stringify(payload), id);
    }
    const sourceRef = p.source_ref_json ? (JSON.parse(p.source_ref_json) as SourceRef) : null;
    const account = loadRow("account", p.account_id);
    if (!account || account.archived_at) throw new ApplyError("Account missing or archived", "state");
    let needsAcknowledgment = sourceRef?.verification === "report_excerpt";
    for (const ref of sourceRef ? [sourceRef, ...(sourceRef.refs ?? [])] : []) {
      if (ref.kind !== "research" || !ref.id) continue;
      const [noteId, position] = ref.id.split("#");
      const index = ref.finding_index ?? (position === undefined ? undefined : Number(position));
      const doc = conn.prepare("SELECT * FROM documents WHERE id = ?").get(noteId) as
        | {
            account_id: string;
            status: string;
            archived_at: string | null;
            meta_json: string;
          }
        | undefined;
      if (!doc || doc.account_id !== p.account_id || doc.status !== "accepted" || doc.archived_at)
        throw new ApplyError("Supporting research evidence is no longer accepted", "state");
      const meta = JSON.parse(doc.meta_json);
      const kept = meta.accepted_finding_indexes ?? meta.findings.map((_: unknown, i: number) => i);
      if (index !== undefined && (!kept.includes(index) || !meta.findings[index] || (meta.resolutions ?? []).some((r: { obsolete_index: number }) => r.obsolete_index === index)))
        throw new ApplyError("Supporting research evidence was removed or resolved", "state");
      const active = kept.filter((i: number) => meta.findings[i] && !(meta.resolutions ?? []).some((r: { obsolete_index: number }) => r.obsolete_index === i));
      if (!active.length) throw new ApplyError("No retained research evidence", "state");
      if ((index === undefined ? active : [index]).some((i: number) => meta.findings[i]?.evidence?.kind !== "source_excerpt")) needsAcknowledgment = true;
    }
    if (needsAcknowledgment && review.ackEvidence !== true) throw new ApplyError("Acknowledge source review for this unverified report excerpt", "validation");
    if (sourceRef?.verification && p.op === "create") {
      const key = p.entity_type === "contact" ? "name" : p.entity_type === "action_item" ? "text" : null;
      if (key && conn.prepare(`SELECT 1 FROM ${TABLE[p.entity_type].table} WHERE account_id=? AND lower(trim(${key}))=lower(trim(?))`).get(p.account_id, String(payload[key])))
        throw new ApplyError("Matching record already exists; review a fresh proposal", "conflict");
    }
    const nowMs = Date.now();

    // The record's lifecycle is checked here, at the moment of accepting, not
    // left to applyEntityChange — whose archived guard runs only for a form
    // that sends a version, which an accepted proposal never does. Archiving
    // rejects the proposals pending at that moment, but a model run already
    // under way files its proposals afterwards: archive a meeting while its
    // notes are being extracted, accept the summary, and the archived meeting
    // was written to. A proposal that itself restores the record (an import
    // listing an archived row) says so with `archived_at` and is let through;
    // a merged-away record is never written to.
    if (p.op === "update" && p.entity_id) {
      const target = loadRow(p.entity_type, p.entity_id) as { archived_at?: string | null; merged_into?: string | null } | null;
      const restores = Object.prototype.hasOwnProperty.call(payload, "archived_at") && payload.archived_at === null;
      if (target && (target.merged_into || (target.archived_at && !restores))) {
        conn.prepare(`UPDATE proposals SET status = 'conflict', decided_by = ?, decided_at = ? WHERE id = ?`).run(userId, nowMs, id);
        return { status: "conflict", message: target.merged_into ? "the record was merged into another since this was proposed" : "the record was archived since this was proposed" };
      }
    }

    if (p.op === "update" && p.entity_id && p.before_json) {
      const before = JSON.parse(p.before_json) as Record<string, unknown>;
      const current = currentValues(p.entity_type, p.entity_id, Object.keys(before));
      if (!current) {
        conn.prepare(`UPDATE proposals SET status = 'conflict', decided_by = ?, decided_at = ? WHERE id = ?`).run(userId, nowMs, id);
        return { status: "conflict", message: "the row no longer exists" };
      }
      const drifted = Object.keys(before).filter((f) => !sameValue(before[f], current[f]) && !sameValue(current[f], payload[f]));
      if (drifted.length > 0) {
        conn.prepare(`UPDATE proposals SET status = 'conflict', decided_by = ?, decided_at = ? WHERE id = ?`).run(userId, nowMs, id);
        return {
          status: "conflict",
          message: `changed since proposed: ${drifted.join(", ")}`,
        };
      }
    }

    const result = applyEntityChange({
      accountId: p.account_id,
      entityType: p.entity_type,
      op: p.op,
      entityId: p.entity_id,
      payload,
      actorUserId: userId,
      proposalId: p.id,
      sourceRef,
    });
    conn.prepare(`UPDATE proposals SET status = 'accepted', entity_id = ?, decided_by = ?, decided_at = ? WHERE id = ?`).run(result.entityId, userId, nowMs, id);
    return { status: "accepted", entityId: result.entityId };
  })();
}

export function rejectProposal(id: string, userId: string): DecideResult {
  const p = getProposal(id);
  if (!p) throw new ApplyError("proposal not found", "not_found");
  if (p.status !== "pending") throw new ApplyError(`proposal is ${p.status}`, "state");
  db().prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?`).run(userId, Date.now(), id);
  return { status: "rejected" };
}

// ---- archive ----------------------------------------------------------------

// Which account a record belongs to. An account belongs to itself.
export function accountIdOf(entityType: Archivable, entityId: string): string | null {
  const row = loadRow(entityType, entityId);
  if (!row) return null;
  return entityType === "account" ? String(row.id) : String(row.account_id);
}

export function today(now = new Date()): string {
  return todayISO(now);
}

// Archiving hides a record everywhere and rejects anything still proposed for
// it. Without that rejection a proposal would keep appearing for review and
// accepting it would silently edit an archived row: the update path has no
// archived check, and before_json only covers the fields in the payload, so
// conflict detection cannot see the archive either.
export function archiveEntity(input: { accountId: string; entityType: Archivable; entityId: string; actorUserId: string | null; day?: string }): ApplyResult {
  const conn = db();
  // Own work is not a customer and cannot be put away. Archiving it would
  // hide every todo that is not about an account — the whole reason it
  // exists — and there would be nothing left on screen to restore it from,
  // because it is excluded from the archived list by design.
  if (input.entityType === "account" && input.entityId === OWN_WORK_ACCOUNT_ID) {
    throw new ApplyError("Own work is where todos that are not about a customer live; it cannot be archived.", "validation");
  }
  return conn.transaction((): ApplyResult => {
    const result = applyEntityChange({
      accountId: input.accountId,
      entityType: input.entityType,
      op: "update",
      entityId: input.entityId,
      payload: { archived_at: input.day ?? today() },
      actorUserId: input.actorUserId,
    });
    const nowMs = Date.now();
    if (input.entityType === "account") {
      conn
        .prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE account_id = ? AND status = 'pending'`)
        .run(input.actorUserId, nowMs, input.accountId);
    } else {
      conn
        .prepare(`UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE account_id = ? AND status = 'pending' AND entity_id = ?`)
        .run(input.actorUserId, nowMs, input.accountId, input.entityId);
    }
    return result;
  })();
}

export function restoreEntity(input: { accountId: string; entityType: Archivable; entityId: string; actorUserId: string | null }): ApplyResult {
  // A merged-away row is a tombstone, not an archived record waiting to come
  // back. Restoring one would return a deal to pipeline whose plays have been
  // relinked to the survivor, a play whose follow-ups and links now answer to
  // the keeper, or a meeting whose attendees do — half a record either way,
  // and the survivor answers for its history.
  //
  // All three tables that carry the pointer, not just deals: 015 gave plays
  // and meetings the same column, and this check written for one of them is
  // the hole the other two fall through. The check lives here rather than in
  // the action so nothing, including a future caller, can go round it.
  // An account merged into another comes back only by undoing that merge,
  // which puts its records back with it (lib/proposals/mergeAccount.ts).
  if (input.entityType === "account") {
    const row = loadRow("account", input.entityId) as { merged_into?: string | null } | null;
    if (row?.merged_into) throw new ApplyError("that account was merged into another; undo the merge there to bring it back", "state");
  }
  if (input.entityType === "deal" || input.entityType === "play" || input.entityType === "meeting" || input.entityType === "contact") {
    const row = loadRow(input.entityType, input.entityId) as {
      merged_into?: string | null;
    } | null;
    if (row?.merged_into) {
      throw new ApplyError(`that ${input.entityType} was merged into ${row.merged_into}; it lives there now`, "state");
    }
  }
  return applyEntityChange({
    accountId: input.accountId,
    entityType: input.entityType,
    op: "update",
    entityId: input.entityId,
    payload: { archived_at: null },
    actorUserId: input.actorUserId,
  });
}

export { isArchivable };
