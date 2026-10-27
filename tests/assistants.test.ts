// SYNTHETIC ONLY: invented accounts, people and follow-ups. AI_FAKE replay only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { BudgetError, startRun } from "@/lib/ai/guard";
import { findPromises, openNotices, promiseKey, resolveNotice, runPromiseKeeper, stillTrue, type PromiseRow } from "@/lib/assistants/promiseKeeper";
import { assistantMode, budgetSettings, saveAssistant, saveBudget, SettingsError } from "@/lib/assistants/settings";
import { tick } from "@/lib/assistants/scheduler";
import { meetingsToPrepare, runMeetingPrep } from "@/lib/assistants/meetingPrep";
import { getMeeting } from "@/lib/queries/meetings";
import { POST as tickRoute } from "@/app/api/internal/tick/route";
import { beginAssistantRun, endAssistantRun, recentAssistantRuns, runRepeats } from "@/lib/assistants/runs";

const TODAY = "2026-10-21";
const row = (p: Partial<PromiseRow>): PromiseRow => ({ id: "f1", account_id: "a1", account_name: "Synthetic Account", account_owner: null, text: "Synthetic promise", owner: null, owner_user_id: null, due: null, ...p });

describe("Promise keeper's rules", () => {
  it("reminds us two days ahead, never on the day or after: Today already says those", () => {
    const find = (due: string) => findPromises([row({ owner_user_id: USER, due })], [], TODAY);
    expect(find("2026-10-22")).toMatchObject([{ kind: "notify", forUserId: USER, dedupeKey: promiseKey("ours-soon", "f1", "2026-10-22") }]);
    expect(find("2026-10-23")).toHaveLength(1);
    expect(find("2026-10-21")).toEqual([]);
    expect(find("2026-10-24")).toEqual([]);
    expect(find("2026-10-19")).toEqual([]);
  });

  it("tells you when the customer's promise is due, and asks when it has no date", () => {
    const theirs = findPromises([row({ owner: "Finley Example", due: "2026-10-21", account_owner: "user-2" }), row({ id: "f2", owner: "Finley Example" })], [], TODAY);
    expect(theirs.map((f) => [f.kind, f.forUserId])).toEqual([["notify", "user-2"], ["question", null]]);
    expect(theirs[1]!.text).toContain("Finley Example promised this with no date");
  });

  it("leaves alone what has no owner, and what our side wrote as 'we' or by a teammate's name", () => {
    expect(findPromises([row({ due: null }), row({ id: "f2", owner: "We", due: null }), row({ id: "f3", owner: "Alex", due: null })], [{ name: "Alex Example" }], TODAY)).toEqual([]);
  });

  it("stops showing a notice once it is no longer true", () => {
    const n = { kind: "notify" as const, dedupe_key: promiseKey("ours-soon", "f1", "2026-10-22") };
    expect(stillTrue(n, { due: "2026-10-22" }, TODAY)).toBe(true);
    expect(stillTrue(n, { due: "2026-10-25" }, TODAY)).toBe(false);
    expect(stillTrue(n, { due: "2026-10-22" }, "2026-10-22")).toBe(false);
    const q = { kind: "question" as const, dedupe_key: promiseKey("theirs-undated", "f1", null) };
    expect(stillTrue(q, { due: null }, TODAY)).toBe(true);
    expect(stillTrue(q, { due: "2026-10-30" }, TODAY)).toBe(false);
  });
});

describe("Promise keeper against the database", () => {
  let seed: Seed;
  beforeEach(() => {
    seed = seedAccount();
  });
  const followUp = (payload: Record<string, unknown>) =>
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { status: "open", ...payload }, actorUserId: USER }).entityId;

  it("says each thing once, however often it runs, and changes no follow-up", () => {
    const id = followUp({ text: "Share the synthetic fleet numbers", owner: "Finley Example" });
    const before = db().prepare("SELECT updated_at FROM action_items WHERE id = ?").get(id);
    const first = runPromiseKeeper("manual", USER, TODAY);
    const second = runPromiseKeeper("schedule", null, TODAY);
    expect([first.added, second.added]).toEqual([1, 0]);
    expect(db().prepare("SELECT updated_at FROM action_items WHERE id = ?").get(id)).toEqual(before);
    expect(openNotices(USER, TODAY).map((n) => [n.kind, n.item_text])).toEqual([["question", "Share the synthetic fleet numbers"]]);
    const runs = db().prepare("SELECT trigger, status, summary FROM assistant_runs ORDER BY started_at").all() as Array<{ summary: string }>;
    expect(runs).toHaveLength(2);
    expect(runs[1]!.summary).toContain("nothing new");
  });

  it("does not ask again once you say they gave no date, and goes quiet when switched off", () => {
    followUp({ text: "Send the synthetic sizing outline", owner: "Finley Example" });
    runPromiseKeeper("manual", USER, TODAY);
    const [n] = openNotices(USER, TODAY);
    resolveNotice(n!.id, USER, "dismissed");
    runPromiseKeeper("manual", USER, TODAY);
    expect(openNotices(USER, TODAY)).toEqual([]);
    followUp({ text: "Book the synthetic site visit", owner: "Finley Example" });
    runPromiseKeeper("manual", USER, TODAY);
    expect(openNotices(USER, TODAY)).toHaveLength(1);
    saveAssistant("promise_keeper", { mode: "off", monthlyCents: 0 }, USER);
    expect(openNotices(USER, TODAY)).toEqual([]);
  });

  it("shows a notice only to the person it is for, and to both when that person is not a user", () => {
    const user = db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'x', ?, 0, 0)");
    user.run(USER, "alex@example.com", "Alex");
    user.run("user-2", "jamie@example.com", "Jamie");
    followUp({ text: "Synthetic proposal review", owner_user_id: "user-2", due: "2026-10-22" });
    followUp({ text: "Synthetic orphan review", owner_user_id: "user-gone", due: "2026-10-22" });
    runPromiseKeeper("manual", USER, TODAY);
    expect(openNotices(USER, TODAY).map((n) => n.item_text)).toEqual(["Synthetic orphan review"]);
    expect(openNotices("user-2", TODAY)).toHaveLength(2);
    expect(openNotices(USER, TODAY, { everyone: true }).find((n) => n.item_text === "Synthetic proposal review")?.for_user_name).toBe("Jamie");
  });
});

describe("budgets nest under one monthly total", () => {
  beforeEach(() => vi.stubEnv("AI_FAKE", "1"));
  const spent = (cents: number, assistant: string | null) =>
    db()
      .prepare(`INSERT INTO ai_runs (id, account_id, kind, provider, model, status, cost_cents, started_at, finished_at, assistant) VALUES (?, NULL, 'brief', 'bedrock', 'synthetic', 'done', ?, ?, ?, ?)`)
      .run(`run-${Math.random()}`, cents, Date.now(), Date.now(), assistant);

  it("refuses settings that do not fit inside the total", () => {
    expect(budgetSettings()).toEqual({ monthlyTotalCents: 25000, peopleShareCents: 10000 });
    expect(() => saveBudget({ monthlyTotalCents: 5000, peopleShareCents: 6000 }, USER)).toThrow(SettingsError);
    saveBudget({ monthlyTotalCents: 5000, peopleShareCents: 3000 }, USER);
    expect(() => saveAssistant("meeting_prep", { mode: "auto", monthlyCents: 2500 }, USER)).toThrow(/does not fit/);
    saveAssistant("meeting_prep", { mode: "auto", monthlyCents: 2000 }, USER);
    expect(assistantMode("meeting_prep")).toBe("auto");
    expect(() => saveAssistant("debrief", { mode: "auto", monthlyCents: 0 }, USER)).toThrow(/cannot be switched yet/);
  });

  it("stops an assistant at its own limit without touching the people's share", () => {
    saveAssistant("meeting_prep", { mode: "auto", monthlyCents: 300 }, USER);
    spent(250, "meeting_prep");
    expect(() => startRun({ role: "brief", accountId: null, userId: null, assistant: "meeting_prep" })).toThrow(/Meeting prep has \$0\.50 of its \$3\.00 left/);
    expect(() => startRun({ role: "brief", accountId: null, userId: USER })).not.toThrow();
  });

  it("holds an assistant's reservation back from button presses", () => {
    saveBudget({ monthlyTotalCents: 3000, peopleShareCents: 1000 }, USER);
    saveAssistant("meeting_prep", { mode: "auto", monthlyCents: 2000 }, USER);
    spent(1000, null);
    expect(() => startRun({ role: "brief", accountId: null, userId: USER })).toThrow(/Your share of this month's AI budget is spent/);
    // Turning it off frees its reservation.
    saveAssistant("meeting_prep", { mode: "ask", monthlyCents: 2000 }, USER);
    expect(() => startRun({ role: "brief", accountId: null, userId: USER })).not.toThrow();
  });

  it("charges Run now on an assistant not on its own to the people's share, not to a reservation", () => {
    vi.stubEnv("AI_DAILY_CAP_CENTS", "100000");
    saveBudget({ monthlyTotalCents: 3000, peopleShareCents: 1000 }, USER);
    saveAssistant("meeting_prep", { mode: "auto", monthlyCents: 1000 }, USER);
    saveAssistant("account_watch", { mode: "ask", monthlyCents: 1000 }, USER);
    spent(1000, "account_watch");
    spent(950, null);
    // $19.50 of the $20.00 that is not held: one more press would pass it.
    expect(() => startRun({ role: "brief", accountId: null, userId: USER })).toThrow(/Your share of this month's AI budget is spent/);
    // Meeting prep's $10.00 is still all there.
    expect(() => startRun({ role: "brief", accountId: null, userId: null, assistant: "meeting_prep" })).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("refuses a run that would carry the month past its total", () => {
    vi.stubEnv("AI_DAILY_CAP_CENTS", "100000");
    saveBudget({ monthlyTotalCents: 1000, peopleShareCents: 1000 }, USER);
    spent(999, null);
    expect(() => startRun({ role: "brief", accountId: null, userId: USER })).toThrow(/This month's AI total of \$10\.00 is spent/);
    vi.unstubAllEnvs();
  });

  it("keeps one row for a scheduled look skipped for the same reason tick after tick", () => {
    for (let i = 0; i < 3; i++) endAssistantRun(beginAssistantRun("account_watch", "schedule", null), { status: "skipped", summary: "Synthetic: the budget is spent." });
    const rows = recentAssistantRuns("account_watch");
    expect(rows).toHaveLength(1);
    expect(runRepeats(rows[0]!)).toBe(3);
    // A different reason, or a press, is its own row.
    endAssistantRun(beginAssistantRun("account_watch", "manual", USER), { status: "skipped", summary: "Synthetic: the budget is spent." });
    expect(recentAssistantRuns("account_watch")).toHaveLength(2);
  });

  it("holds a run still in flight at what its kind usually costs, not a flat dollar", () => {
    vi.stubEnv("AI_DAILY_CAP_CENTS", "100000");
    saveAssistant("meeting_prep", { mode: "auto", monthlyCents: 1000 }, USER);
    // Briefs usually cost $4.00 (people's history); two are running for Meeting prep.
    for (let i = 0; i < 3; i++) spent(400, null);
    const running = db().prepare(`INSERT INTO ai_runs (id, account_id, kind, provider, model, status, started_at, assistant) VALUES (?, NULL, 'brief', 'bedrock', 'synthetic', 'running', ?, 'meeting_prep')`);
    running.run("run-flight-1", Date.now());
    running.run("run-flight-2", Date.now());
    // $8.00 held and $4.00 more would pass its $10.00.
    expect(() => startRun({ role: "brief", accountId: null, userId: null, assistant: "meeting_prep" })).toThrow(/Meeting prep has \$2\.00 of its \$10\.00 left/);
    vi.unstubAllEnvs();
  });

  it("treats the monthly total as a hard stop for everything", () => {
    saveBudget({ monthlyTotalCents: 0, peopleShareCents: 0 }, USER);
    const attempt = () => startRun({ role: "brief", accountId: null, userId: USER });
    expect(attempt).toThrow(BudgetError);
    expect(attempt).toThrow(/switched off/);
  });
});

describe("the scheduler", () => {
  afterEach(() => vi.useRealTimers());
  // 2026-10-21 in America/Los_Angeles (UTC-7).
  const at = (hhmm: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const [h, m] = hhmm.split(":").map(Number);
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 21, h! + 7, m!)));
    return new Date();
  };
  const looks = () => db().prepare("SELECT COUNT(*) AS n FROM assistant_runs WHERE assistant = 'promise_keeper'").get() as { n: number };

  it("runs Promise keeper once each morning, not before six, and only when it is on its own", () => {
    seedAccount();
    tick(at("05:30"));
    expect(looks().n).toBe(0);
    expect(tick(at("06:05")).ran.map((r) => r.assistant)).toEqual(["promise_keeper"]);
    tick(at("06:10"));
    tick(at("14:00"));
    expect(looks().n).toBe(1);
  });

  it("tries again after a look that died with a restart", () => {
    seedAccount();
    tick(at("07:00"));
    db().prepare("UPDATE assistant_runs SET status = 'failed', error = 'process restarted'").run();
    tick(at("07:05"));
    expect(looks().n).toBe(2);
  });

  it("leaves an assistant set to When I ask alone", () => {
    saveAssistant("promise_keeper", { mode: "ask", monthlyCents: 0 }, USER);
    tick(at("09:00"));
    expect(looks().n).toBe(0);
  });

  it("writes tomorrow's brief from late afternoon, and never one a person edited", async () => {
    vi.stubEnv("AI_FAKE", "1");
    const seed = seedAccount({ heldAt: "2026-10-22" });
    saveAssistant("meeting_prep", { mode: "auto", monthlyCents: 2000 }, USER);
    const midnight = Date.UTC(2026, 9, 21, 7);
    expect(meetingsToPrepare(at("10:00"), midnight).map((m) => m.id)).toEqual([]);
    expect(meetingsToPrepare(at("16:30"), midnight).map((m) => m.id)).toEqual([seed.meetingId]);
    const r = runMeetingPrep("schedule", null, at("16:30"), midnight);
    expect(r?.started).toEqual([seed.meetingId]);
    vi.useRealTimers();
    await vi.waitFor(() => expect(getMeeting(seed.meetingId)!.brief_json).not.toBeNull());
    const run = db().prepare("SELECT assistant, created_by, status FROM ai_runs WHERE kind = 'brief'").get();
    expect(run).toEqual({ assistant: "meeting_prep", created_by: null, status: "done" });
    // Written, so not again.
    expect(meetingsToPrepare(at("17:00"), midnight)).toEqual([]);
  });
});

describe("the scheduler's door", () => {
  const knock = (auth?: string) => tickRoute(new NextRequest("http://localhost/api/internal/tick", { method: "POST", headers: auth ? { authorization: auth } : {} }));
  const SECRET = "synthetic-secret-synthetic-secret-0123";

  it("does not exist without a secret of at least 32 characters", async () => {
    vi.stubEnv("SCHEDULER_SECRET", "");
    expect((await knock(`Bearer ${SECRET}`)).status).toBe(404);
    vi.stubEnv("SCHEDULER_SECRET", "short");
    expect((await knock("Bearer short")).status).toBe(404);
  });

  it("refuses a wrong secret and runs a tick for the right one", async () => {
    vi.stubEnv("SCHEDULER_SECRET", SECRET);
    expect((await knock("Bearer nope")).status).toBe(403);
    expect((await knock()).status).toBe(403);
    const ok = await knock(`Bearer ${SECRET}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ran: expect.any(Array), errors: [] });
  });
});
