// SYNTHETIC ONLY: invented accounts, plays, theses and meeting notes. AI_FAKE replay only.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requirePageUser: vi.fn(async () => ({ id: "user-1" })) }));
import { db } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { checkThesisCheck } from "@/lib/plan/check";
import { livePlays, openPlanQuestions, playQuestion, runPlanLook, runThesisLook, thesisDue, type PlayRow } from "@/lib/assistants/planKeeper";
import { saveAssistant } from "@/lib/assistants/settings";
import { dismissPlanQuestion, editThesisAction, setNextStepAction, setPlayStatusAction } from "@/app/plans/actions";
import { todayISO, addDays } from "@/lib/clock";

const TODAY = "2026-10-21";
const DAY = 86400_000;
const play = (p: Partial<PlayRow>): PlayRow => ({ id: "p1", account_id: "a1", account_name: "Synthetic", account_owner: null, title: "Synthetic play", status: "active", next_step: "Book the workshop", next_step_due: "2026-10-30", updated_at: Date.parse("2026-10-20T12:00:00Z"), last_activity: Date.parse("2026-10-20T12:00:00Z"), ...p });

describe("one question per play, the most pressing first", () => {
  it("asks about a slipped next step before anything else", () => {
    expect(playQuestion(play({ next_step_due: "2026-10-12", last_activity: Date.parse("2026-08-01T12:00:00Z") }), TODAY)).toMatchObject({ rule: "overdue", dedupeKey: "plan:overdue:p1:2026-10-12" });
  });

  it("asks for a next step on an active play with none, but not on a proposed one", () => {
    expect(playQuestion(play({ next_step: null, next_step_due: null }), TODAY)).toMatchObject({ rule: "nonext" });
    expect(playQuestion(play({ status: "proposed", next_step: null, next_step_due: null }), TODAY)).toBeNull();
  });

  it("calls a play quiet only after thirty days without anything moving", () => {
    expect(playQuestion(play({ last_activity: Date.parse("2026-09-22T12:00:00Z") }), TODAY)).toBeNull();
    expect(playQuestion(play({ last_activity: Date.parse("2026-09-15T12:00:00Z") }), TODAY)).toMatchObject({ rule: "quiet", text: expect.stringContaining("36 days") });
  });
});

describe("the thesis check's guards", () => {
  const input = { thesis: "We win by owning the clinical records refresh. The CIO sponsors it.", meetings: [{ id: "m1", title: "Sync", heldAt: TODAY, notes: "The CIO is leaving in December.\nBudget moved to next year." }] };
  it("accepts quotes from both sides, and refuses an invented clause, quote or meeting", () => {
    const good = { tensions: [{ thesis_claim: "The CIO sponsors it.", meeting_id: "m1", quote: "The CIO is leaving in December.", question: "Who sponsors it after December?" }], holds: "" };
    expect(checkThesisCheck(good, input)).toEqual([]);
    const bad = { tensions: [{ thesis_claim: "We are the incumbent.", meeting_id: "m9", quote: "Budget was cut.", question: "Synthetic question here?" }], holds: "" };
    expect(checkThesisCheck(bad, input).map((f) => f.path)).toEqual(["tensions[0].thesis_claim", "tensions[0].meeting_id"]);
  });
});

describe("Plan keeper against the database", () => {
  let seed: Seed;
  beforeEach(() => {
    vi.stubEnv("AI_FAKE", "1");
    seed = seedAccount();
    saveAssistant("plan_keeper", { mode: "ask", monthlyCents: 1500 }, USER);
  });
  const age = (days: number) => {
    const t = Date.now() - days * DAY;
    db().prepare("UPDATE plays SET updated_at = ?, next_step = COALESCE(next_step, 'Synthetic step on file') WHERE id = ?").run(t, seed.playId);
    db().prepare("UPDATE deals SET updated_at = ? WHERE account_id = ?").run(t, seed.accountId);
  };

  it("asks once about a quiet play, and stops asking once something moves", () => {
    age(40);
    expect(runPlanLook("manual", USER).added).toBe(1);
    expect(runPlanLook("schedule", null).added).toBe(0);
    const [q] = openPlanQuestions(USER, { everyone: true });
    expect(q).toMatchObject({ play_title: "EHR platform defense", text: expect.stringContaining("Nothing about it has moved in 40 days") });
    // A follow-up on the play counts as movement.
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic step", status: "open", play_id: seed.playId }, actorUserId: USER });
    expect(openPlanQuestions(USER, { everyone: true })).toEqual([]);
  });

  it("sets the next step, or the status, as a person's edit, and closes the question", async () => {
    age(40);
    runPlanLook("manual", USER);
    const [q] = openPlanQuestions(USER, { everyone: true });
    const fd = new FormData();
    fd.set("next_step", "Book the synthetic workshop");
    fd.set("due", addDays(todayISO(), 7));
    fd.set("base_version", String(q!.play_version));
    expect(await setNextStepAction(q!.id, fd)).toEqual({ ok: true });
    expect(db().prepare("SELECT next_step FROM plays WHERE id = ?").get(seed.playId)).toEqual({ next_step: "Book the synthetic workshop" });
    expect(db().prepare("SELECT actor_user_id FROM change_log WHERE entity_id = ? AND field = 'next_step'").get(seed.playId)).toEqual({ actor_user_id: USER });
    expect(openPlanQuestions(USER, { everyone: true })).toEqual([]);
    expect((await setNextStepAction(q!.id, fd)) as { ok: boolean }).toMatchObject({ ok: false });
  });

  it("refuses an answer that does not say which version it was made from", async () => {
    age(40);
    runPlanLook("manual", USER);
    const [q] = openPlanQuestions(USER, { everyone: true });
    const fd = new FormData();
    fd.set("next_step", "Book the synthetic workshop");
    expect(await setNextStepAction(q!.id, fd)).toMatchObject({ ok: false });
    expect(await setPlayStatusAction(q!.id, "dropped", Number.NaN)).toMatchObject({ ok: false });
    const thesis = new FormData();
    thesis.set("thesis", "Synthetic thesis written without a version.");
    expect(await editThesisAction(q!.id, thesis)).toMatchObject({ ok: false });
    expect(db().prepare("SELECT next_step, status FROM plays WHERE id = ?").get(seed.playId)).not.toMatchObject({ next_step: "Book the synthetic workshop" });
    expect(openPlanQuestions(USER, { everyone: true })).toHaveLength(1);
  });

  it("refuses an answer to a play someone changed since the card was dealt", async () => {
    age(40);
    runPlanLook("manual", USER);
    const [q] = openPlanQuestions(USER, { everyone: true });
    applyEntityChange({ accountId: seed.accountId, entityType: "play", op: "update", entityId: seed.playId, payload: { status: "active" }, actorUserId: "user-2" });
    expect(await setPlayStatusAction(q!.id, "dropped", q!.play_version!)).toMatchObject({ ok: false });
  });

  it("reads the thesis against recent notes once a month, and an edited thesis retires its questions", async () => {
    applyEntityChange({ accountId: seed.accountId, entityType: "account", op: "update", entityId: seed.accountId, payload: { thesis: "We win by owning the clinical records refresh. The CIO sponsors it." }, actorUserId: USER });
    applyEntityChange({ accountId: seed.accountId, entityType: "meeting", op: "create", payload: { title: "Synthetic sync", held_at: todayISO(), raw_notes: "The CIO is leaving in December.\nBudget moved to next year." }, actorUserId: USER });
    expect(thesisDue().map((a) => a.id)).toEqual([seed.accountId]);
    expect(runThesisLook("manual", USER)).toMatchObject({ started: true });
    await vi.waitFor(() => expect(db().prepare("SELECT status FROM ai_runs WHERE kind = 'plan_check'").get()).toEqual({ status: "done" }));
    expect(db().prepare("SELECT assistant FROM ai_runs WHERE kind = 'plan_check'").get()).toEqual({ assistant: "plan_keeper" });
    expect(thesisDue()).toEqual([]);
    const [q] = openPlanQuestions(USER, { everyone: true });
    expect(q!.payload).toMatchObject({ thesis_claim: "We win by owning the clinical records refresh.", quote: "The CIO is leaving in December." });
    const fd = new FormData();
    fd.set("thesis", "We win by owning the clinical records refresh, whoever sponsors it next.");
    fd.set("base_version", String(q!.account_version));
    expect(await editThesisAction(q!.id, fd)).toEqual({ ok: true });
    expect(openPlanQuestions(USER, { everyone: true })).toEqual([]);
  });

  it("goes quiet when switched off, and closes a question on 'It's fine' without touching the play", async () => {
    age(40);
    runPlanLook("manual", USER);
    const before = db().prepare("SELECT updated_at FROM plays WHERE id = ?").get(seed.playId);
    const [q] = openPlanQuestions(USER, { everyone: true });
    expect(await dismissPlanQuestion(q!.id)).toEqual({ ok: true });
    expect(db().prepare("SELECT updated_at FROM plays WHERE id = ?").get(seed.playId)).toEqual(before);
    age(50);
    runPlanLook("manual", USER);
    saveAssistant("plan_keeper", { mode: "off", monthlyCents: 1500 }, USER);
    expect(openPlanQuestions(USER, { everyone: true })).toEqual([]);
    expect(livePlays(seed.accountId)).toHaveLength(1);
  });
});
