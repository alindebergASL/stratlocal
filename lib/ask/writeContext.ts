// Server-only read snapshots and live ownership checks for Ask's two writes.
import { db } from "../db";
import { ApplyError, currentValues, loadRow, type Baseline } from "../proposals/apply";
import type { EntityType } from "../proposals/schema";
import type { Citable, ToolContext } from "./tools";

export const EDITABLE = {
  account: ["thesis", "segment", "region", "hq", "legal_entity"],
  deal: ["stage", "stage_label", "close_date", "tcv_usd", "competitor", "partner", "next_step", "notes", "status"],
  contact: ["name", "title", "org", "role", "email", "notes"],
  play: ["title", "thesis", "status", "next_step", "next_step_due"],
  action_item: ["text", "notes", "owner", "due", "status"],
} as const;

const logSequence = () => db().prepare("SELECT COALESCE(MAX(rowid), 0) FROM change_log").pluck().get() as number;
const stale = (): never => { throw new ApplyError("Ask context changed or is unavailable. Start a new question before writing; nothing was saved.", "conflict"); };

/** First observation wins, including fields not displayed by a compact tool.
 * Values stay server-side; a repeated/broader read must not bless a human edit
 * made after an earlier read. Each record gets its own read-time snapshot,
 * not an account-wide snapshot that accidentally includes unseen records.
 */
export class AskReadState implements Baseline {
  private readonly records = new Map<string, { cite: Citable; seq: number; fields: Readonly<Record<string, unknown>> | null }>();
  private readonly chartReads = new Map<string, { snapshot: string; dealIds: ReadonlySet<string>; seq: number }>();
  private readonly threadSeq = logSequence();
  private readonly threadId: string;
  private readonly accountId: string | null;

  constructor(ctx: Pick<ToolContext, "threadId" | "accountId">) {
    this.threadId = ctx.threadId;
    this.accountId = ctx.accountId;
  }

  remember(cite: Citable): void {
    const key = `${cite.kind}:${cite.id}`;
    if (this.records.has(key)) return;
    const fields = Object.prototype.hasOwnProperty.call(EDITABLE, cite.kind)
      ? currentValues(cite.kind as keyof typeof EDITABLE, cite.id, [...EDITABLE[cite.kind as keyof typeof EDITABLE]])
      : null;
    this.records.set(key, { cite: { ...cite }, seq: logSequence(), fields: fields ? Object.freeze(fields) : null });
  }

  /** Aggregate reads cover their full query, including rows omitted from the
   * tool's display cap. This evidence is not a citation or a proposal baseline.
   * As with record reads, rereading must not bless a changed snapshot.
   */
  rememberChart(key: string, snapshot: string, dealIds: string[]): void {
    if (!this.chartReads.has(key)) this.chartReads.set(key, { snapshot, dealIds: new Set(dealIds), seq: logSequence() });
  }

  assertChart(key: string, snapshot: string): void {
    const read = this.chartReads.get(key);
    if (!read || read.snapshot !== snapshot) return stale();
    // Equal final numbers cannot bless a move/undo of a hidden aggregate member.
    const moved = db().prepare("SELECT entity_id FROM change_log WHERE rowid > ? AND entity_type = 'deal' AND field = 'account_id'").all(read.seq) as Array<{ entity_id: string }>;
    if (moved.some((row) => read.dealIds.has(row.entity_id))) stale();
  }

  values(kind: EntityType, id: string, fields: string[]): Record<string, unknown> {
    const snapshot = this.records.get(`${kind}:${id}`)?.fields;
    if (!snapshot || fields.some((f) => !Object.prototype.hasOwnProperty.call(snapshot, f) || snapshot[f] === undefined)) {
      throw new ApplyError("Read-time baseline unavailable. Start a new question and read the record before proposing changes.", "conflict");
    }
    return Object.fromEntries(fields.map((f) => [f, snapshot[f]]));
  }

  assertWritable(ctx: ToolContext, targetAccount: string | null): void {
    const conn = db();
    const movedSince = (kind: string, id: string, seq: number) => !!conn.prepare(
      "SELECT 1 FROM change_log WHERE rowid > ? AND entity_type = ? AND entity_id = ? AND field = 'account_id' LIMIT 1",
    ).get(seq, kind, id);
    const thread = conn.prepare("SELECT account_id, archived_at FROM ask_threads WHERE id = ?").get(this.threadId) as { account_id: string | null; archived_at: string | null } | undefined;
    if (ctx.threadId !== this.threadId || ctx.accountId !== this.accountId || !thread || thread.archived_at || thread.account_id !== this.accountId || movedSince("ask_thread", this.threadId, this.threadSeq)) stale();
    const accounts = new Set([this.accountId, targetAccount]);
    // All observed context can inform the model's prose, not just its citations.
    for (const { cite, seq } of this.records.values()) {
      accounts.add(cite.accountId);
      const kind = cite.kind === "research" || cite.kind === "web" ? "document" : cite.kind;
      const id = cite.kind === "research" || cite.kind === "web" ? cite.id.split("#")[0]! : cite.id;
      const row = kind === "document"
        ? conn.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined
        : loadRow(kind, id);
      if (!row || row.archived_at || row.merged_into || (kind === "account" ? row.id : row.account_id) !== cite.accountId || movedSince(kind, id, seq)) stale();
    }
    for (const id of accounts) {
      if (id === null) continue;
      const account = loadRow("account", id);
      if (!account || account.archived_at || account.merged_into) stale();
    }
  }
}

/** Called inside the same immediate transaction as the eventual insert. */
export function assertAskWriteContext(ctx: ToolContext, accountId: string | null): AskReadState {
  const state = ctx.readState;
  if (!state) return stale();
  state.assertWritable(ctx, accountId);
  return state;
}
