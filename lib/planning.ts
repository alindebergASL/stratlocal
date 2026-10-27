// Human planning writes. No model calls, date inference, or proposal acceptance.
import { db, OWN_WORK_ACCOUNT_ID, type ActionItemRow, type AiRunRow } from "./db";
import { applyEntityChange, ApplyError } from "./proposals/apply";
import { moveToAccount } from "./proposals/move";
import { getAccount } from "./queries/accounts";
import { getMeeting } from "./queries/meetings";
import { runState } from "./ai/runState";
import { MeetingBrief, readStoredBrief } from "./meetings/briefSchema";
import { conversationView } from "./meetings/briefView";

export function getTask(id: string): ActionItemRow | null {
  return (db().prepare("SELECT * FROM action_items WHERE id = ?").get(id) as ActionItemRow | undefined) ?? null;
}

function liveAccount(id: string) {
  const account = getAccount(id);
  if (!account || account.archived_at) throw new ApplyError("That account is missing or archived.", "state");
  return account;
}

export function saveTask(input: { accountId: string; itemId: string | null; targetAccountId?: string; payload: Record<string, unknown>; version: number | null; userId: string }) {
  return db().transaction(() => {
    const { accountId, itemId, payload, version, userId } = input;
    const target = input.targetAccountId ?? accountId;
    liveAccount(accountId);
    liveAccount(target);
    const item = itemId ? getTask(itemId) : null;
    if (itemId && (!item || item.account_id !== accountId || item.archived_at)) throw new ApplyError("That task is missing, archived, or has moved. Reload before editing.", "state");
    // Connection changes are identity operations, not proposals. Require the
    // exact rendered version; never carry a stale form across an account move.
    const connecting = target !== accountId || (payload.meeting_id !== undefined && payload.meeting_id !== item?.meeting_id);
    if (item && connecting && (version === null || item.updated_at !== version)) throw new ApplyError("This task changed since you opened it. Reload before connecting it.", "conflict");
    if (target !== accountId && item && (accountId !== OWN_WORK_ACCOUNT_ID || item.meeting_id || item.play_id || item.source_ref_json)) {
      throw new ApplyError("Only standalone Own work can move accounts. Source-backed work keeps its original account and evidence.", "validation");
    }
    if (item && payload.meeting_id !== undefined && payload.meeting_id !== item.meeting_id && item.source_ref_json) {
      throw new ApplyError("Source-backed work keeps its original meeting. Its evidence cannot be transplanted.", "validation");
    }
    for (const [field, table] of [["meeting_id", "meetings"], ["play_id", "plays"]] as const) {
      const value = payload[field];
      if (typeof value !== "string" || value === item?.[field]) continue;
      const ref = db().prepare(`SELECT account_id, archived_at, merged_into FROM ${table} WHERE id = ?`).get(value) as { account_id: string; archived_at: string | null; merged_into: string | null } | undefined;
      if (!ref || ref.account_id !== target || ref.archived_at || ref.merged_into) throw new ApplyError(`That ${field === "meeting_id" ? "meeting" : "play"} is missing, archived, merged, or belongs to another account.`, "validation");
    }
    // The move keeps old history in its original account and is visible from
    // both; the edit that follows checks against the version the move wrote.
    const moved = item && target !== accountId ? moveToAccount({ entity: "action_item", id: item.id, from: accountId, to: target, actorUserId: userId, baseVersion: version }) : null;
    return applyEntityChange({ accountId: target, entityType: "action_item", entityId: itemId, op: itemId ? "update" : "create", payload, actorUserId: userId, baseVersion: item ? (moved?.version ?? version) : null });
  })();
}

export function latestBriefRun(accountId: string, meetingId: string) {
  const row = db().prepare("SELECT * FROM ai_runs WHERE account_id = ? AND kind = 'brief' AND input_summary = ? ORDER BY started_at DESC, rowid DESC LIMIT 1").get(accountId, `meeting ${meetingId}`) as AiRunRow | undefined;
  return row ? { id: row.id, state: runState(row) } : null;
}

export type BriefEdits = { original: MeetingBrief; userId: string; at: number };
export function readBriefEdits(json: string | null | undefined): BriefEdits | null {
  try {
    const value = JSON.parse(json ?? "null") as BriefEdits | null;
    return value && typeof value.userId === "string" && typeof value.at === "number" && MeetingBrief.safeParse(value.original).success ? value : null;
  } catch { return null; }
}

export function editPreparation(input: { accountId: string; meetingId: string; version: number | null; userId: string; purpose: string; questions: string[]; action: string; concern: string }) {
  return db().transaction(() => {
    liveAccount(input.accountId);
    const meeting = getMeeting(input.meetingId);
    if (!meeting || meeting.account_id !== input.accountId || meeting.archived_at || meeting.merged_into || !meeting.brief_json) throw new ApplyError("This meeting has no editable brief, or is archived or merged.", "state");
    if (input.version === null || input.version !== meeting.updated_at) throw new ApplyError("This meeting changed since you opened the brief. Reload before editing.", "conflict");
    const brief = readStoredBrief(meeting.brief_json);
    if (!brief) throw new ApplyError("The stored brief cannot be read; regenerate it before editing.", "validation");
    const view = conversationView(brief);
    const edited = MeetingBrief.parse({ ...brief,
      conversation: { ...(brief.conversation ?? { facts: [], hypothesis: null, connection: null, uncertainty: view.uncertainty }), purpose: input.purpose, questions: input.questions },
      proposed_next_step: { ...brief.proposed_next_step, action: input.action, concern: input.concern },
    });
    // Keep the complete original, including every citation. Human edits never
    // claim to be evidence-checked AI output. A regeneration is explicit.
    const provenance: BriefEdits = { original: readBriefEdits(meeting.brief_edits_json)?.original ?? brief, userId: input.userId, at: Date.now() };
    return applyEntityChange({ accountId: input.accountId, entityType: "meeting", op: "update", entityId: meeting.id, actorUserId: input.userId, baseVersion: input.version,
      payload: { brief_json: JSON.stringify(edited), brief_edits_json: JSON.stringify(provenance) }, sourceRef: { kind: "user", id: input.userId } });
  })();
}
