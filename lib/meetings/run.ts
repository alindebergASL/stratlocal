// Starting an extraction or a brief: build the context pack, run the model in
// the background, and land the result as proposals or as the meeting's brief.
import { db, type AiRunRow, type MeetingRow } from "../db";
import { getAccount } from "../queries/accounts";
import { getMeeting } from "../queries/meetings";
import { listUsers } from "../auth";
import { BudgetError, runDetached, startRun } from "../ai/guard";
import { applyEntityChange, captureBaseline, createProposalBatch } from "../proposals/apply";
import type { Attendee, ProposalDraft } from "../proposals/schema";
import { briefReadingForPrompt, buildContextPack, evidenceIds, evidenceIndex } from "./contextPack";
import { extractMeetingNotes, qualificationTask } from "./extract";
import { diffMeetingExtraction } from "./diffMeeting";
import { generateBrief } from "./brief";
import { directionForPrompt } from "../teamDirection";
import { playbookForPrompt } from "../playbook/prompt";
import { currentPlaybook } from "../playbook/store";
import { scorecard } from "../playbook/qualification";
import { researchForPrompt } from "../research/notes";
import { customerDocsForPrompt } from "../documents/customer";
import { briefReadiness } from "../ai/readiness";
import type { AssistantId } from "../assistants/registry";
import { readInvite, type InviteAttendee } from "./invite";
import { listContacts } from "../queries/accounts";
import { appTimeZone } from "../clock";
import { draftRecap, readRecap, type MeetingRecap } from "./recap";
import { runState } from "../ai/runState";

export function meetingAttendees(meeting: MeetingRow): Attendee[] {
  try {
    const parsed = JSON.parse(meeting.attendees_json) as unknown;
    return Array.isArray(parsed) ? (parsed as Attendee[]) : [];
  } catch {
    return [];
  }
}

export type ExtractRunResult = { batchId: string; proposals: number; dropped: string[]; attempts: number };

export function startExtractRun(meeting: MeetingRow, userId: string): string {
  if (!meeting.raw_notes || meeting.raw_notes.trim().length < 20) {
    throw new BudgetError("Paste the meeting notes first.");
  }
  const run = startRun({
    role: "meeting_extract",
    accountId: meeting.account_id,
    userId,
    inputSummary: `meeting ${meeting.id} (${meeting.raw_notes.length} chars of notes)`,
  });
  runDetached(run.id, async (stages): Promise<ExtractRunResult> => {
    // Before the model reads the account: what it saw is what its proposals
    // are checked against when someone accepts them.
    const baseline = captureBaseline(meeting.account_id);
    const pack = buildContextPack(meeting.account_id, { excludeMeetingId: meeting.id });
    const ids = evidenceIds(pack);
    const account = currentPlaybook({ accountId: meeting.account_id }) ? getAccount(meeting.account_id) : null;
    const card = account ? scorecard(account) : null;
    const { extraction, attempts, dropped } = await extractMeetingNotes(
      { notes: meeting.raw_notes ?? "", pack, ids, title: meeting.title, heldAt: meeting.held_at, qualification: card ? qualificationTask(card) : undefined },
      stages,
    );
    const drafts = dropRepeatedFollowUps(
      meeting.id,
      diffMeetingExtraction(extraction, pack, {
        meetingId: meeting.id,
        currentSummary: meeting.summary,
        users: listUsers().map((u) => ({ id: u.id, name: u.display_name })),
        qualification: card ? { accountId: meeting.account_id, rows: card } : undefined,
      }),
    );
    const batch = createProposalBatch(meeting.account_id, { kind: "meeting", id: meeting.id, aiRunId: run.id }, drafts, { baseline });
    return { batchId: batch.batchId, proposals: batch.ids.length, dropped, attempts };
  });
  return run.id;
}

// Extracting the same notes twice must not make every follow-up twice. The
// model is asked afresh each time and has no idea what the last run filed,
// and a follow-up proposal is a create, so the second extraction proposed
// all of them again and accepting both gave two identical tasks. A follow-up
// already on this meeting (open or done, not archived) or already proposed
// for it and still pending is not proposed again. Matched on the text,
// ignoring case and spacing — the same test the accept path uses for a
// sourced create.
export function dropRepeatedFollowUps(meetingId: string, drafts: ProposalDraft[]): ProposalDraft[] {
  const key = (s: unknown) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").toLowerCase() : "");
  const conn = db();
  const seen = new Set<string>([
    ...(conn.prepare(`SELECT text FROM action_items WHERE meeting_id = ? AND archived_at IS NULL`).pluck().all(meetingId) as string[]).map(key),
    ...(
      conn
        .prepare(`SELECT payload_json FROM proposals WHERE status = 'pending' AND entity_type = 'action_item' AND op = 'create' AND origin_kind = 'meeting' AND origin_id = ?`)
        .pluck()
        .all(meetingId) as string[]
    ).map((j) => {
      try {
        return key((JSON.parse(j) as { text?: unknown }).text);
      } catch {
        return "";
      }
    }),
  ]);
  return drafts.filter((d) => {
    if (d.entity_type !== "action_item" || d.op !== "create") return true;
    const k = key(d.payload.text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type BriefRunResult = { claims: number; attempts: number };

export type BriefStartIntent = { baseVersion: number; replaceHumanEdits: boolean };
export class BriefStartConflict extends Error {}

// `userId` is null when Meeting prep started it on its own; the brief is then
// written with no actor and its run is charged to that assistant.
export function startBriefRun(meeting: MeetingRow, userId: string | null, intent: BriefStartIntent, opts: { assistant?: AssistantId } = {}): string {
  const current = getMeeting(meeting.id);
  const account = getAccount(meeting.account_id);
  if (!current || current.account_id !== meeting.account_id || current.archived_at || current.merged_into || !account || account.archived_at) throw new BudgetError("This meeting or account is missing, archived, or merged.");
  // A fresh database read is not the version the person saw. Check the
  // rendered token before reserving a run, including an old tab with no brief.
  if (!intent || intent.baseVersion !== current.updated_at) throw new BriefStartConflict("This meeting changed since you opened it. Reload and review the current preparation before trying again.");
  if (current.brief_edits_json && intent.replaceHumanEdits !== true) throw new BriefStartConflict("This preparation has human edits. Reload and confirm their replacement before regenerating.");
  meeting = current;
  // This had no guard at all: a brief over an empty account was a paid-for
  // page of nothing.
  const notReady = briefReadiness(meeting);
  if (notReady) throw new BudgetError(notReady);
  const run = startRun({ role: "brief", accountId: meeting.account_id, userId, inputSummary: `meeting ${meeting.id}`, assistant: opts.assistant ?? null });
  runDetached(run.id, async (stages): Promise<BriefRunResult> => {
    const pack = buildContextPack(meeting.account_id, { excludeMeetingId: meeting.id, forBrief: { heldAt: meeting.held_at } });
    const index = evidenceIndex(pack);
    const ids = new Set(index.keys());
    // What each id actually is, so a citation of the wrong kind comes back as
    // a finding rather than as a link the page then refuses to make.
    const kinds = new Map([...index].map(([id, entry]) => [id, entry.kind as string]));
    // An attendee whose contact has since been archived keeps their name but
    // loses the id: the pack no longer offers it, so checkBrief would reject
    // the whole brief for citing a contact it was never given.
    const attendees = meetingAttendees(meeting).map((a) =>
      a.contact_id && !ids.has(a.contact_id) ? { ...a, contact_id: null } : a,
    );
    const { brief, attempts } = await generateBrief(
      { pack, ids, kinds, title: meeting.title, heldAt: meeting.held_at, attendees, researchBlock: [briefReadingForPrompt(meeting.account_id, meeting.id, meeting.held_at), researchForPrompt(meeting.account_id), customerDocsForPrompt(meeting.account_id)].filter(Boolean).join("\n\n"), direction: [directionForPrompt(), playbookForPrompt(meeting.account_id, attendees)].filter(Boolean).join("\n\n") },
      stages,
    );
    if (getAccount(meeting.account_id)?.archived_at) throw new BudgetError("This account was archived while preparation was running.");
    // The brief is a document, so history records its size rather than a copy.
    applyEntityChange({
      accountId: meeting.account_id,
      entityType: "meeting",
      op: "update",
      entityId: meeting.id,
      payload: { brief_json: JSON.stringify(brief), brief_edits_json: null },
      baseVersion: meeting.updated_at,
      actorUserId: userId,
      sourceRef: { kind: "meeting", id: meeting.id },
    });
    const claims =
      brief.situation.length + brief.deals_in_play.length + brief.changes_since_last.length + brief.questions.length + brief.risks.length;
    return { claims, attempts };
  });
  return run.id;
}

export { BudgetError };

// Reading a pasted invite into the New meeting form.
//
// Unlike extraction and the brief, nothing is written when this finishes: the
// answer is handed back to the form, and the person presses Create. That is
// deliberate — it keeps DECISIONS #1 without needing a new proposal origin, a
// migration, or a second review surface for a thing that is four fields.
export type InviteRunResult = {
  title: string;
  heldAt: string;
  heldTime: string | null;
  /** What the conversion did, when it did anything worth saying. */
  timeNote: string | null;
  attendees: InviteAttendee[];
  dropped: string[];
};

export function startInviteRun(accountId: string, text: string, userId: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 20) throw new BudgetError("Paste the invite first.");
  // Bounded before it is sent, not after: a pasted thread can be enormous and
  // the whole of it goes to the model.
  if (trimmed.length > 20_000) throw new BudgetError("That is longer than an invite. Paste just the invite, or the top of the email.");
  const run = startRun({
    role: "meeting_invite",
    accountId,
    userId,
    kind: "meeting_invite",
    inputSummary: `invite paste (${trimmed.length} chars)`,
  });
  runDetached(run.id, async (stages): Promise<InviteRunResult> => {
    const contacts = listContacts(accountId).map((c) => ({ id: c.id, name: c.name, email: c.email }));
    const read = await readInvite({ text: trimmed, contacts, appZone: appTimeZone(), stages });
    return {
      title: read.invite.title,
      heldAt: read.invite.held_at,
      heldTime: read.local.time,
      timeNote: read.local.note,
      attendees: read.attendees,
      dropped: read.dropped,
    };
  });
  return run.id;
}

// The recap email (lib/meetings/recap.ts). Like the invite, its result lives
// only on the run: it is a draft for the person's own mail client, not a
// change to any record, so it is neither a proposal nor a field.
export type RecapRunResult = { recap: MeetingRecap; attempts: number };

export function startRecapRun(meeting: MeetingRow, userId: string): string {
  const notes = (meeting.raw_notes ?? "").trim();
  if (notes.length < 20) throw new BudgetError("Write the meeting notes first: the recap is drafted from them.");
  const account = getAccount(meeting.account_id);
  const run = startRun({
    role: "meeting_recap",
    accountId: meeting.account_id,
    userId,
    kind: "meeting_recap",
    inputSummary: `meeting ${meeting.id}`,
  });
  runDetached(run.id, async (stages): Promise<RecapRunResult> => {
    // Customer attendees only: the email is to them.
    const contacts = new Map(listContacts(meeting.account_id, { includeArchived: true }).map((c) => [c.id, c]));
    const attendees = meetingAttendees(meeting)
      .filter((a) => !a.contact_id || (contacts.get(a.contact_id)?.org ?? "customer") === "customer")
      .map((a) => a.name)
      .filter((n): n is string => !!n && n.trim().length > 0);
    return draftRecap({ notes, title: meeting.title, heldAt: meeting.held_at, accountName: account?.name ?? "", attendees }, stages);
  });
  return run.id;
}

export function latestRecapRun(accountId: string, meetingId: string): { id: string; state: ReturnType<typeof runState>; recap: MeetingRecap | null } | null {
  const row = db()
    .prepare("SELECT * FROM ai_runs WHERE account_id = ? AND kind = 'meeting_recap' AND input_summary = ? ORDER BY started_at DESC, rowid DESC LIMIT 1")
    .get(accountId, `meeting ${meetingId}`) as AiRunRow | undefined;
  if (!row) return null;
  const state = runState(row);
  const result = state.status === "done" ? (state.result as RecapRunResult | null) : null;
  return { id: row.id, state, recap: result ? readRecap(result.recap) : null };
}
