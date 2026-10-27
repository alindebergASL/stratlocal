// What Ask may change: nothing, directly. It files proposals, which a person
// accepts or rejects on the account's review page like any other.
//
// The limits are tighter than a plan draft's, because a conversation can wander:
// - only records a tool returned in this turn may be updated, and only on the
//   account named;
// - only people and follow-ups may be created;
// - only the fields a seller would edit by hand — never an owner, an archive,
//   a CRM id, a play's links or its order;
// - one batch per account per question, so one review decision is one answer.
import { z } from "zod";
import { db } from "../db";
import { acceptProposal, ApplyError, createProposalBatch } from "../proposals/apply";
import type { ProposalDraft, SourceRef } from "../proposals/schema";
import { getAccount } from "../queries/accounts";
import type { ToolContext, ToolResult } from "./tools";
import { assertAskWriteContext, EDITABLE } from "./writeContext";

/** The origin every Ask batch is filed under; plan re-drafts leave these alone. */
export const askOrigin = (threadId: string) => `ask:${threadId}`;

type Editable = keyof typeof EDITABLE;
const CREATABLE = new Set<Editable>(["contact", "action_item"]);

export const ProposeChanges = z.object({
  account_id: z.string().describe("The account these changes are on, as a tool returned it. One call per account."),
  changes: z
    .array(
      z.object({
        record: z.enum(["account", "deal", "contact", "play", "action_item"]).describe("action_item is a follow-up."),
        op: z.enum(["create", "update"]).describe("create only a contact or an action_item."),
        id: z.string().optional().describe("For update: the record's id exactly as a tool returned it (a deal's deal_id)."),
        fields: z.record(z.string(), z.unknown()).describe(
          "Only these fields — account: thesis, segment, region, hq, legal_entity; deal: stage (1-6), stage_label, close_date (YYYY-MM-DD), tcv_usd (whole dollars), competitor, partner, next_step, notes, status (open|won|lost); contact: name, title, org (customer|vendor|partner), role, email, notes; play: title, thesis, status (proposed|active|stalled|won|dropped), next_step, next_step_due; action_item: text, notes, owner, due (YYYY-MM-DD), status (open|done).",
        ),
        why: z.string().min(3).max(600).describe("One sentence a seller reads on the review page: why this change, from which record."),
        because: z
          .array(z.object({ kind: z.string(), id: z.string() }))
          .max(10)
          .optional()
          .describe("The records this rests on, as a tool returned them."),
      }),
    )
    .min(1)
    .max(20),
});

export const PROPOSE_DESCRIPTION =
  "Propose changes to records on one account, for a person to accept or reject on the review page. Use it only when asked to change, add or update something, or when the question is what to change and they asked you to draft it. Nothing is changed until a person accepts. You may update only records a tool returned in this conversation turn, and create only contacts and follow-ups (action_item).";

export type FiledBatch = { batchId: string; accountId: string; count: number };

export function proposeChanges(raw: unknown, ctx: ToolContext): ToolResult & { batch: FiledBatch | null } {
  return db().transaction(() => fileChanges(raw, ctx)).immediate();
}

function fileChanges(raw: unknown, ctx: ToolContext): ToolResult & { batch: FiledBatch | null } {
  const input = ProposeChanges.parse(raw);
  const refuse = (why: string): never => {
    throw new ApplyError(why, "validation");
  };
  const shown = [...ctx.cites.map.values()].some((c) => c.accountId === input.account_id);
  const account = getAccount(input.account_id);
  if (!account || !shown) refuse("That account was not returned by a tool this turn. Look it up first.");
  const baseline = assertAskWriteContext(ctx, input.account_id);
  if (ctx.batches.some((b) => b.accountId === input.account_id)) refuse("Changes on this account were already proposed for this question. Put them all in one call.");

  const drafts: ProposalDraft[] = input.changes.map((c, i) => {
    const at = `change ${i + 1}`;
    if (c.op === "create" && !CREATABLE.has(c.record)) refuse(`${at}: Ask can create only contacts and follow-ups, not a ${c.record}.`);
    const allowed = new Set<string>(EDITABLE[c.record]);
    const bad = Object.keys(c.fields).filter((f) => !allowed.has(f));
    if (bad.length) refuse(`${at}: ${c.record} fields ${bad.join(", ")} cannot be proposed here.`);
    if (Object.keys(c.fields).length === 0) refuse(`${at}: no fields.`);
    let entityId: string | null = null;
    if (c.op === "update") {
      if (c.record === "account") {
        if (c.id && c.id !== input.account_id) refuse(`${at}: an account update is on the account named in account_id.`);
        entityId = input.account_id;
      } else {
        const seen = c.id ? ctx.cites.get(c.record, c.id) : undefined;
        if (!seen) refuse(`${at}: ${c.record} ${c.id ?? "(no id)"} was not returned by a tool this turn.`);
        if (seen!.accountId !== input.account_id) refuse(`${at}: that ${c.record} is on another account.`);
        entityId = c.id!;
      }
    }
    const refs = (c.because ?? []).filter((r) => ctx.cites.get(r.kind, r.id));
    const source: SourceRef = {
      kind: "ai",
      origin: "ai_generated",
      ...(refs.length ? { refs: refs.map((r) => ({ kind: r.kind as NonNullable<SourceRef["refs"]>[number]["kind"], id: r.id })) } : {}),
    };
    const payload = { ...c.fields };
    // A follow-up keeps where it came from on the row, as every AI one does.
    if (c.record === "action_item" && c.op === "create") payload.source_ref = source;
    // Validate every update before inserting anything, even no-op or previously
    // rejected drafts. The generic batch builder's current-value fallback must
    // never turn an absent Ask read snapshot into permission to overwrite.
    if (c.op === "update") baseline.values(c.record, entityId!, Object.keys(payload));
    return { entity_type: c.record, op: c.op, entity_id: entityId, payload, rationale: c.why, source_ref: source };
  });

  let filed: { batchId: string; ids: string[] };
  try {
    filed = createProposalBatch(
      input.account_id,
      { kind: "plan_draft", id: askOrigin(ctx.threadId), aiRunId: ctx.runId },
      drafts,
      { baseline },
    );
  } catch (e) {
    if (e instanceof z.ZodError) refuse(`A field is not valid: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
    throw e;
  }
  const count = filed!.ids.length;
  const batch = count ? { batchId: filed!.batchId, accountId: input.account_id, count } : null;
  if (batch) ctx.batches.push(batch);
  return {
    batch,
    step: `Proposed ${count} change${count === 1 ? "" : "s"} on ${account!.name}`,
    content: JSON.stringify({
      proposed: count,
      skipped: drafts.length - count,
      note: count
        ? "Filed for review on the account's review page. Nothing is changed until a person accepts. Tell them so in the answer."
        : "Nothing new to propose: each change was already the current value, or was turned down before.",
    }),
  };
}

/** Where a filed batch stands now: how many still wait, were accepted, or were turned down. */
export function batchStatus(batchId: string): { pending: number; accepted: number; rejected: number } {
  const rows = db().prepare(`SELECT status, COUNT(*) AS n FROM proposals WHERE batch_id = ? GROUP BY status`).all(batchId) as Array<{ status: string; n: number }>;
  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { pending: n("pending"), accepted: n("accepted"), rejected: n("rejected") };
}

export type QuickFollowUp = { id: string; text: string; due: string | null };

/**
 * The batch's waiting proposals, when every one of them is a new follow-up
 * and needs no evidence to be acknowledged; otherwise null. A follow-up you
 * asked Ask to add is the one change worth taking with one tap: it creates a
 * row and edits nothing, so reviewing it on another page was ceremony.
 */
export function quickFollowUps(batchId: string): QuickFollowUp[] | null {
  const rows = db()
    .prepare(`SELECT id, entity_type, op, payload_json, source_ref_json FROM proposals WHERE batch_id = ? AND status = 'pending' ORDER BY created_at, rowid`)
    .all(batchId) as Array<{ id: string; entity_type: string; op: string; payload_json: string; source_ref_json: string | null }>;
  if (rows.length === 0) return null;
  const quick = rows.every((r) => {
    if (r.entity_type !== "action_item" || r.op !== "create") return false;
    // Anything resting on public research keeps its acknowledgement step.
    const ref = r.source_ref_json ? (JSON.parse(r.source_ref_json) as SourceRef) : null;
    return !ref || ![ref, ...(ref.refs ?? [])].some((x) => x.kind === "research");
  });
  if (!quick) return null;
  return rows.map((r) => {
    const p = JSON.parse(r.payload_json) as { text?: string; due?: string | null };
    return { id: r.id, text: String(p.text ?? ""), due: p.due ?? null };
  });
}

/** Accept every follow-up in a quick batch through the ordinary accept path. */
export function acceptQuickFollowUps(batchId: string, userId: string): { accepted: number; failed: string[] } {
  const items = quickFollowUps(batchId);
  if (!items) throw new ApplyError("These changes need the review page.", "state");
  let accepted = 0;
  const failed: string[] = [];
  for (const item of items) {
    try {
      acceptProposal(item.id, userId);
      accepted += 1;
    } catch (e) {
      if (!(e instanceof ApplyError)) throw e;
      failed.push(`${item.text.slice(0, 60)}: ${e.message}`);
    }
  }
  return { accepted, failed };
}
