import { createHash } from "node:crypto";
import { db, type ActionItemRow } from "./db";
import { listUsers } from "./auth";
import { isRealDay } from "./clock";
import { applyEntityChange, ApplyError } from "./proposals/apply";
import { SourceRef } from "./proposals/schema";

export type CommitmentKind = "deal" | "play";
export type CommitmentSource = { account_id: string; next_step: string | null; next_step_due?: string | null; updated_at: number | null; archived_at?: string | null; merged_into?: string | null };
export function commitmentBasis(source: CommitmentSource): string {
  return createHash("sha256").update(JSON.stringify([source.account_id, source.next_step, source.next_step_due ?? null])).digest("hex");
}
export function commitmentId(accountId: string, kind: CommitmentKind, sourceId: string, basis: string): string {
  return `commitment-${createHash("sha256").update(JSON.stringify([accountId, kind, sourceId, basis])).digest("hex")}`;
}
export function sourceRefOf(row: { source_ref_json: string | null }): SourceRef | null {
  try { const parsed = SourceRef.safeParse(JSON.parse(row.source_ref_json ?? "null")); return parsed.success ? parsed.data : null; } catch { return null; }
}
export function linkedCommitments(accountId: string, kind: CommitmentKind, sourceId: string): ActionItemRow[] {
  // Provenance, never text equality or current play membership.
  return (db().prepare("SELECT * FROM action_items WHERE account_id = ? ORDER BY created_at").all(accountId) as ActionItemRow[])
    .filter((row) => { const ref = sourceRefOf(row); return ref?.kind === kind && ref.id === sourceId; });
}
export function createNextStepCommitment(input: { accountId: string; kind: CommitmentKind; sourceId: string; basis: string; userId: string; text: string; assignee: string; due: string; noDate: boolean }) {
  if (input.kind !== "deal" && input.kind !== "play") throw new ApplyError("Invalid source kind.", "validation");
  if (!/^[a-f0-9]{64}$/.test(input.basis)) throw new ApplyError("Invalid source basis.", "validation");
  return db().transaction(() => {
    const users = listUsers();
    if (!users.some((u) => u.id === input.userId)) throw new ApplyError("Sign in before creating a follow-up.", "validation");
    const account = db().prepare("SELECT archived_at FROM accounts WHERE id = ?").get(input.accountId) as { archived_at: string | null } | undefined;
    if (!account || account.archived_at) throw new ApplyError("That account is unavailable.", "state");
    const source = db().prepare(`SELECT * FROM ${input.kind === "deal" ? "deals" : "plays"} WHERE ${input.kind === "deal" ? "deal_id" : "id"} = ? AND account_id = ?`).get(input.sourceId, input.accountId) as CommitmentSource | undefined;
    if (!source) throw new ApplyError("That source is unavailable on this account.", "state");
    // Deterministic primary key + IMMEDIATE transaction serialize competing
    // confirmations. A retry recovers even after the action was edited/archived.
    const id = commitmentId(input.accountId, input.kind, input.sourceId, input.basis);
    const existing = db().prepare("SELECT id FROM action_items WHERE id = ? AND account_id = ?").get(id, input.accountId) as { id: string } | undefined;
    if (existing) return { id, already: true };
    if (source.archived_at || source.merged_into) throw new ApplyError("That source is archived or merged.", "state");
    if (commitmentBasis(source) !== input.basis) throw new ApplyError("The next step changed. Close this draft and review the current source.", "state");
    if (!source.next_step?.trim()) throw new ApplyError("Write a next step before creating a follow-up.", "state");
    if (!input.text.trim()) throw new ApplyError("The follow-up needs something to do.", "validation");
    if (!input.assignee || (input.assignee !== "unassigned" && !users.some((u) => u.id === input.assignee))) throw new ApplyError("Choose an assignee or unassigned.", "validation");
    if (input.noDate ? !!input.due : !input.due || !isRealDay(input.due)) throw new ApplyError("Choose a real date or explicitly choose no date.", "validation");
    applyEntityChange({ accountId: input.accountId, entityType: "action_item", op: "create", entityId: id, actorUserId: input.userId,
      payload: { text: input.text, owner_user_id: input.assignee === "unassigned" ? null : input.assignee, due: input.noDate ? null : input.due, status: "open", play_id: input.kind === "play" ? input.sourceId : null,
        source_ref: { kind: input.kind, id: input.sourceId, quote: source.next_step.slice(0, 1000) } } });
    return { id, already: false };
  }).immediate();
}
