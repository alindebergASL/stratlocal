// Synthetic-only planning acceptance and write-boundary regressions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, OWN_WORK_ACCOUNT_ID, type ActionItemRow } from "@/lib/db";
import { ApplyError, applyEntityChange, archiveEntity } from "@/lib/proposals/apply";
import { getMeeting, listOpenFollowUps } from "@/lib/queries/meetings";
import { editPreparation, getTask, latestBriefRun, readBriefEdits, saveTask } from "@/lib/planning";
import { startBriefRun } from "@/lib/meetings/run";
import { briefFingerprint, createFollowUpFromBrief } from "@/lib/meetings/briefFollowUp";
import { buildContextPack } from "@/lib/meetings/contextPack";
import { briefReadiness } from "@/lib/ai/readiness";
import { seedAccount, USER, type Seed } from "./helpers";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePageUser: vi.fn(async () => ({ id: "user-1" })), listUsers: () => [{ id: "user-1", display_name: "Alex" }] }));
import { captureTask, saveActionItem, savePreparation } from "@/app/actions";
import { revalidatePath } from "next/cache";
const form = (values: Record<string, string>) => { const fd = new FormData(); Object.entries(values).forEach(([k,v]) => fd.set(k,v)); return fd; };
const rows = () => db().prepare("SELECT * FROM action_items").all() as ActionItemRow[];
let seed: Seed;
beforeEach(() => { seed = seedAccount(); });
function loose() {
  const { entityId } = saveTask({ accountId: OWN_WORK_ACCOUNT_ID, itemId: null, userId: USER, version: null, payload: { text: "Synthetic loose thought" } });
  return getTask(entityId)!;
}
function connect(item: ActionItemRow, target = seed.accountId, meeting: string | null = seed.meetingId, version: number | null = item.updated_at) {
  return saveTask({ accountId: item.account_id, itemId: item.id, targetAccountId: target, userId: USER, version, payload: { text: item.text, meeting_id: meeting } });
}
function storeBrief() {
  const brief = { conversation: { purpose: "Plan the synthetic conversation.", facts: [{ text: "There is an EHR refresh deal.", source_refs: [{ kind: "deal", id: seed.dealId }] }], questions: ["What changed?"], hypothesis: null, connection: null, uncertainty: "No date agreed." }, situation: [], deals_in_play: [], attendees: [], changes_since_last: [], questions: [], risks: [], proposed_next_step: { action: "Agree a synthetic review.", concern: "No next date.", owner: "Alex", target_date: "2026-10-01", blocker: null, evidence_ids: [seed.dealId] } };
  applyEntityChange({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, op: "update", payload: { brief_json: JSON.stringify(brief) }, actorUserId: USER });
  return brief;
}
const editInput = () => ({ accountId: seed.accountId, meetingId: seed.meetingId, userId: USER, version: getMeeting(seed.meetingId)!.updated_at, purpose: "Our human purpose.", questions: ["Who decides?"], action: "Ask for a technical review.", concern: "Validate the scope." });

describe("loose thoughts to actionable work", () => {
  it("captures only a title, leaves all optional fields empty, is findable without a due date, and never runs AI", async () => {
    expect(await captureTask(form({ text: "  Think about a synthetic workshop tomorrow  " }))).toEqual({ ok: true });
    const item = rows()[0]!;
    expect(item).toMatchObject({ account_id: OWN_WORK_ACCOUNT_ID, text: "Think about a synthetic workshop tomorrow", due: null, owner_user_id: null, meeting_id: null, play_id: null, notes: null, status: "open", source_ref_json: null });
    expect(listOpenFollowUps({ unowned: true }).map(t => t.id)).toContain(item.id);
    expect(db().prepare("SELECT COUNT(*) n FROM ai_runs").get()).toEqual({ n: 0 });
    expect((await captureTask(form({ text: " " }))).ok).toBe(false);
  });
  it("saves optional metadata then preserves it when connecting without resubmitting it", async () => {
    await captureTask(form({ text: "Synthetic workshop", owner_user_id: USER, notes: "Ask about a small pilot.", due: "2026-10-15" }));
    const item = rows()[0]!;
    const result = await saveActionItem(item.account_id, item.id, form({ text: item.text, account_id: seed.accountId, meeting_id: seed.meetingId, base_version: String(item.updated_at) }));
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/accounts/${seed.accountId}/meetings/${seed.meetingId}`);
    expect(getTask(item.id)).toMatchObject({ id: item.id, account_id: seed.accountId, meeting_id: seed.meetingId, owner_user_id: USER, notes: item.notes, due: item.due, created_at: item.created_at, source_ref_json: null });
    expect(getTask(item.id)!.updated_at).toBeGreaterThan(item.updated_at);
    const logs = db().prepare("SELECT account_id, field FROM change_log WHERE entity_id = ? ORDER BY created_at").all(item.id);
    expect(logs).toContainEqual({ account_id: OWN_WORK_ACCOUNT_ID, field: "text" });
    expect(logs).toContainEqual({ account_id: OWN_WORK_ACCOUNT_ID, field: "account_id" });
    expect(logs).toContainEqual({ account_id: seed.accountId, field: "account_id" });
  });
  it("supports account first, meeting later with the same ID", () => {
    const item = loose(); connect(item, seed.accountId, null); connect(getTask(item.id)!);
    expect(getTask(item.id)!.meeting_id).toBe(seed.meetingId);
    expect(rows()).toHaveLength(1);
  });
  it("requires an exact rendered version for links and refuses stale account bindings", () => {
    const item = loose();
    expect(() => connect(item, seed.accountId, seed.meetingId, null)).toThrow(/changed/);
    expect(() => connect(item, seed.accountId, seed.meetingId, item.updated_at - 1)).toThrow(/changed/);
    connect(item);
    expect(() => connect(item)).toThrow(/moved/);
  });
  it.each(["account", "meeting", "action_item"] as const)("rejects archived %s", entityType => {
    const item = loose();
    archiveEntity({ accountId: entityType === "action_item" ? item.account_id : seed.accountId, entityType, entityId: entityType === "account" ? seed.accountId : entityType === "meeting" ? seed.meetingId : item.id, actorUserId: USER });
    expect(() => connect(item)).toThrow(/archived/);
    expect(getTask(item.id)!.account_id).toBe(OWN_WORK_ACCOUNT_ID);
  });
  it("rejects missing and cross-account references transactionally", () => {
    const item = loose();
    const before = db().prepare("SELECT COUNT(*) n FROM change_log").get();
    expect(() => connect(item, "missing")).toThrow(/missing/);
    expect(() => connect(item, seed.accountId, "missing")).toThrow(/missing/);
    const other = seedAccount({ dealId: "SYN-OTHER", name: "Synthetic Elsewhere" });
    expect(() => connect(item, other.accountId, seed.meetingId)).toThrow(/another account/);
    expect(getTask(item.id)).toEqual(item);
    expect(db().prepare("SELECT COUNT(*) n FROM change_log WHERE entity_id=?").get(item.id)).toEqual({ n: 1 });
    expect(before).toBeTruthy();
  });
  it("rejects merged meetings and missing plays without altering the task", () => {
    const item = loose();
    db().prepare("UPDATE meetings SET merged_into='synthetic-survivor' WHERE id=?").run(seed.meetingId);
    expect(() => connect(item)).toThrow(/merged/);
    expect(() => saveTask({ accountId: item.account_id, itemId: item.id, targetAccountId: seed.accountId, userId: USER, version: item.updated_at, payload: { play_id: "missing" } })).toThrow(/missing/);
    expect(getTask(item.id)).toEqual(item);
  });
  it("rolls back account relocation when the following patch is invalid", () => {
    const item = loose();
    expect(() => saveTask({ accountId: item.account_id, itemId: item.id, targetAccountId: seed.accountId, userId: USER, version: item.updated_at, payload: { text: "", meeting_id: seed.meetingId } })).toThrow();
    expect(getTask(item.id)).toEqual(item);
    expect(db().prepare("SELECT COUNT(*) n FROM change_log WHERE entity_id=? AND field='account_id'").get(item.id)).toEqual({ n: 0 });
  });
  it("preserves source evidence on ordinary edits but never transplants it", async () => {
    const id = applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", actorUserId: USER, payload: { text: "Synthetic sourced action", meeting_id: seed.meetingId, source_ref: { kind: "meeting", id: seed.meetingId, quote: "Agreed to follow up." } } }).entityId;
    const item = getTask(id)!;
    expect(() => connect(item, seed.accountId, null)).toThrow(/evidence cannot be transplanted/);
    expect((await saveActionItem(seed.accountId, id, form({ text: item.text, notes: "Personal reminder", base_version: String(item.updated_at) }))).ok).toBe(true);
    expect(getTask(id)!.source_ref_json).toBe(item.source_ref_json);
    expect(getTask(id)!.meeting_id).toBe(seed.meetingId);
  });
  it("does not allow moving existing customer-context work to a different account", () => {
    const item = loose(); connect(item, seed.accountId, null);
    const other = seedAccount({ dealId: "SYN-OTHER", name: "Synthetic Other" });
    expect(() => connect(getTask(item.id)!, other.accountId, null)).toThrow(/Only standalone Own work/);
  });
  it("validates owner and real dates", async () => {
    for (const bad of [{ owner_user_id: "missing" }, { due: "2026-02-30" }] as Record<string, string>[]) expect((await captureTask(form({ text: "Synthetic task", ...bad }))).ok).toBe(false);
    expect(rows()).toHaveLength(0);
  });
  it("includes connected tasks in preparation context, including tasks-only accounts", () => {
    const item = loose(); connect(item);
    db().prepare("UPDATE deals SET archived_at='2026-09-29'").run();
    db().prepare("UPDATE plays SET archived_at='2026-09-29'").run();
    db().prepare("UPDATE contacts SET archived_at='2026-09-29'").run();
    expect(briefReadiness(getMeeting(seed.meetingId)!)).toBeNull();
    expect(buildContextPack(seed.accountId).open_action_items.map(a => a.id)).toContain(item.id);
  });
});

describe("editable, evidence-preserving meeting preparation", () => {
  it("keeps the original source-backed draft and labels human edits without creating commitments", () => {
    const original = storeBrief();
    editPreparation(editInput());
    const meeting = getMeeting(seed.meetingId)!;
    const edited = JSON.parse(meeting.brief_json!);
    expect(edited.conversation.purpose).toBe("Our human purpose.");
    expect(edited.conversation.facts).toEqual(original.conversation.facts);
    expect(edited.proposed_next_step.evidence_ids).toEqual(original.proposed_next_step.evidence_ids);
    expect(readBriefEdits(meeting.brief_edits_json)).toMatchObject({ userId: USER, original });
    // The provenance stamp is who edited and when, to the millisecond. A
    // second edit inside the same millisecond carries an identical stamp and
    // is rightly not logged as a change to it — which a fast runner can hit.
    // The claim here is about two edits a person could tell apart.
    for (const t = Date.now(); Date.now() === t; ) { /* next millisecond */ }
    editPreparation({ ...editInput(), purpose: "A second human edit." });
    expect(readBriefEdits(getMeeting(meeting.id)!.brief_edits_json)!.original).toEqual(original);
    expect(rows()).toEqual([]);
    expect(db().prepare("SELECT COUNT(*) n FROM proposals").get()).toEqual({ n: 0 });
    expect(db().prepare("SELECT COUNT(*) n FROM change_log WHERE entity_id=? AND field='brief_edits_json'").get(meeting.id)).toEqual({ n: 2 });
  });
  it("requires explicit confirmation and retains actual AI wording even after human preparation edits", () => {
    const original = storeBrief(); editPreparation(editInput());
    const m = getMeeting(seed.meetingId)!;
    const result = createFollowUpFromBrief({ accountId: seed.accountId, meetingId: m.id, userId: USER, fingerprint: briefFingerprint(m.brief_json), text: "A human-confirmed next step", ownerChoice: "unassigned", due: null, dueUnknown: true, ackEvidence: true });
    const task = getTask(result.itemId)!;
    expect(JSON.parse(task.source_ref_json!).quote).toBe(original.proposed_next_step.action);
    expect(task.due).toBeNull(); expect(task.owner_user_id).toBeNull();
  });
  it("cannot label a model proposal as human-edited preparation", () => {
    storeBrief();
    expect(() => applyEntityChange({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, op: "update", actorUserId: USER, proposalId: "synthetic-ai-proposal", payload: { brief_edits_json: JSON.stringify({ userId: USER }) } })).toThrow(/cannot write human/);
    expect(getMeeting(seed.meetingId)!.brief_edits_json).toBeNull();
  });
  it("refuses concurrent edits including edits made in the same millisecond", () => {
    storeBrief(); const input = editInput();
    editPreparation(input);
    expect(() => editPreparation({ ...input, purpose: "Stale." })).toThrow(/changed/);
    expect(() => editPreparation({ ...editInput(), version: null })).toThrow(/changed/);
  });
  it("rejects invalid edits and archived or cross-account meetings without changing the original", async () => {
    storeBrief(); const before = getMeeting(seed.meetingId)!;
    const fd = form({ base_version: String(before.updated_at), purpose: "x".repeat(301), questions: "One?", action: "Act", concern: "Why" });
    expect((await savePreparation(seed.accountId, seed.meetingId, fd)).ok).toBe(false);
    expect(getMeeting(seed.meetingId)).toEqual(before);
    expect(() => editPreparation({ ...editInput(), accountId: OWN_WORK_ACCOUNT_ID })).toThrow(/no editable brief/);
    archiveEntity({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, actorUserId: USER });
    expect(() => editPreparation(editInput())).toThrow(/archived/);
  });
  it("hydrates durable running and done states; rejects duplicate execution and stale background writes (AI_FAKE replay)", async () => {
    vi.stubEnv("AI_FAKE", "1");
    try {
      storeBrief();
      const runId = startBriefRun(getMeeting(seed.meetingId)!, USER, { baseVersion: getMeeting(seed.meetingId)!.updated_at, replaceHumanEdits: false });
      expect(latestBriefRun(seed.accountId, seed.meetingId)).toMatchObject({ id: runId, state: { status: "running" } });
      expect(latestBriefRun(OWN_WORK_ACCOUNT_ID, seed.meetingId)).toBeNull();
      expect(() => startBriefRun(getMeeting(seed.meetingId)!, USER, { baseVersion: getMeeting(seed.meetingId)!.updated_at, replaceHumanEdits: false })).toThrow(/already in progress/);
      editPreparation(editInput());
      await vi.waitFor(() => expect(latestBriefRun(seed.accountId, seed.meetingId)!.state.status).toBe("failed"));
      expect(JSON.parse(getMeeting(seed.meetingId)!.brief_json!).conversation.purpose).toBe("Our human purpose.");
      const retryId = startBriefRun(getMeeting(seed.meetingId)!, USER, { baseVersion: getMeeting(seed.meetingId)!.updated_at, replaceHumanEdits: true });
      await vi.waitFor(() => expect(latestBriefRun(seed.accountId, seed.meetingId)!.state.status).toBe("done"));
      expect(latestBriefRun(seed.accountId, seed.meetingId)!.id).toBe(retryId);
      expect(getMeeting(seed.meetingId)!.brief_edits_json).toBeNull();
      expect(rows()).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("a brief column that will not parse", () => {
  it("is refused as an application error, not thrown as a SyntaxError", () => {
    storeBrief();
    db().prepare("UPDATE meetings SET brief_json = ? WHERE id = ?").run("{not json", seed.meetingId);
    const version = getMeeting(seed.meetingId)!.updated_at;
    let caught: unknown;
    try { editPreparation({ ...editInput(), version }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApplyError);
    expect((caught as ApplyError).code).toBe("validation");
    expect((caught as ApplyError).message).toMatch(/cannot be read/);
    expect(db().prepare("SELECT COUNT(*) n FROM change_log WHERE entity_id=? AND field='brief_json'").get(seed.meetingId)).toEqual({ n: 1 });
  });
});

describe("the bound account is the scope of a create", () => {
  it("files a new follow-up under the page's account whatever the form names", async () => {
    const result = await saveActionItem(seed.accountId, null, form({ text: "Synthetic item filed from the account page", account_id: OWN_WORK_ACCOUNT_ID }));
    expect(result.ok).toBe(true);
    const row = rows().find(r => r.text === "Synthetic item filed from the account page")!;
    expect(row.account_id).toBe(seed.accountId);
  });
});
