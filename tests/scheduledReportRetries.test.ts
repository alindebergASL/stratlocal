// SYNTHETIC ONLY. Detached Ask launches are controlled; no network or scheduler.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, failOrphanedRuns } from "@/lib/db";
import { BudgetError, finishRun, getRun, startRun } from "@/lib/ai/guard";
import * as client from "@/lib/ai/client";
import * as ask from "@/lib/ask/run";
import { scheduleFor, setSchedule } from "@/lib/ask/schedules";
import { runScheduledReports } from "@/lib/assistants/scheduledReports";
import { openReady } from "@/lib/assistants/ready";
import { storeReport } from "@/lib/ask/report";
import { USER } from "./helpers";

const at = new Date("2026-10-26T08:00:00Z");
let launches: Array<{ input: Parameters<typeof ask.startAsk>[0]; runId: string }>;
beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1"); vi.stubEnv("AI_DAILY_CAP_CENTS", "10000"); vi.stubEnv("APP_TIMEZONE", "UTC");
  launches = [];
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, 'synthetic@example.test', 'x', 'Synthetic', 0, 0)").run(USER);
  setSchedule("weekly_pipeline", { days: [0,1,2,3,4,5,6], at: "00:00", forUserId: USER }, USER);
  vi.spyOn(ask, "startAsk").mockImplementation((input) => {
    const run = startRun({ role: "ask", accountId: null, userId: USER, assistant: "scheduled_reports" });
    launches.push({ input, runId: run.id });
    return { threadId: "synthetic-thread", runId: run.id };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const tick = (minutes: number) => runScheduledReports("schedule", null, new Date(at.getTime() + minutes * 60_000));
const status = (id: string | null) => (db().prepare("SELECT status FROM assistant_runs WHERE id = ?").get(id) as { status: string } | undefined)?.status;
function complete(report: boolean) {
  const launch = launches.at(-1)!;
  const doc = report ? storeReport({ accountId: null, userId: USER, report: { title: "Synthetic report", summary: null, sections: [{ heading: "Synthetic", body: "Synthetic" }], citations: [], threadId: "synthetic-thread" } }).doc.id : null;
  launch.input.onDone?.({ threadId: "synthetic-thread", messageId: "synthetic-message", reportDocId: doc });
  finishRun(launch.runId, { stages: [], result: {} });
}

it("does not consume baseline or finish assistant before a saved report; no duplicate in flight even on later days/manual", () => {
  const first = tick(0)!;
  expect(first.started).toBe(1);
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBeNull();
  expect(status(first.runId)).toBe("running");
  tick(30); tick(24 * 60);
  runScheduledReports("manual", USER, new Date(at.getTime() + 31 * 60_000));
  expect(launches).toHaveLength(1);
  complete(true);
  expect(status(first.runId)).toBe("done");
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBe(at.getTime());
  expect(openReady(USER)).toHaveLength(1);
  expect(tick(45)).toBeNull();
});

it.each(["failure", "restart", "no-report"])("keeps successful baseline on %s and allows only bounded delayed retries", (mode) => {
  const first = tick(0)!;
  if (mode === "restart") failOrphanedRuns(db());
  else if (mode === "no-report") complete(false);
  else finishRun(launches[0]!.runId, { stages: [], error: "Synthetic detached failure" });
  tick(1);
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBeNull();
  expect(status(first.runId)).toBe("failed");
  expect(openReady(USER)).toEqual([]);
  expect(launches).toHaveLength(1);
  expect(tick(16)?.started).toBe(1);
  finishRun(launches.at(-1)!.runId, { stages: [], error: "Synthetic retry failure" });
  expect(tick(32)?.started).toBe(1);
  finishRun(launches.at(-1)!.runId, { stages: [], error: "Synthetic final failure" });
  tick(48); tick(60);
  expect(launches).toHaveLength(3);
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBeNull();
  expect(tick(24 * 60)?.started).toBe(1);
});

it("skipping unchanged records never advances the last successful report baseline", () => {
  tick(0); complete(true);
  expect(tick(24 * 60)?.reason).toMatch(/nothing changed/);
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBe(at.getTime());
});

it.each(["failure", "no-report"])("reconciles real detached Ask %s without a successful baseline or notice", async (mode) => {
  vi.mocked(ask.startAsk).mockRestore();
  vi.stubEnv("AI_FAKE", ""); vi.stubEnv("AWS_REGION", "us-west-2");
  vi.spyOn(client, "getClient").mockReturnValue({ messages: { stream: () => ({ on: vi.fn(), finalMessage: async () => {
    if (mode === "failure") throw new Error("Synthetic detached provider failure");
    return { content: [{ type: "tool_use", id: "synthetic-final", name: "final_answer", input: { text: "No report was written.", citations: [] } }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "tool_use" };
  } }) } } as unknown as ReturnType<typeof client.getClient>);
  const first = tick(0)!;
  const aiId = (db().prepare("SELECT id FROM ai_runs").get() as { id: string }).id;
  expect(status(first.runId)).toBe("running");
  await vi.waitFor(() => expect(getRun(aiId)?.status).toBe(mode === "failure" ? "failed" : "done"));
  tick(1);
  expect(status(first.runId)).toBe("failed");
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBeNull();
  expect(openReady(USER)).toEqual([]);
});

it("preserves a previous successful baseline after a later failed manual attempt", () => {
  tick(0); complete(true);
  const later = runScheduledReports("manual", USER, new Date(at.getTime() + 20 * 60_000))!;
  expect(later.started).toBe(1);
  finishRun(launches.at(-1)!.runId, { stages: [], error: "Synthetic later failure" });
  tick(21);
  expect(status(later.runId)).toBe("failed");
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBe(at.getTime());
});

it("bounds synchronous start failures without consuming the successful baseline", () => {
  vi.mocked(ask.startAsk).mockImplementation(() => { throw new BudgetError("Synthetic budget refusal"); });
  tick(0); tick(1); tick(16); tick(32); tick(48);
  expect(ask.startAsk).toHaveBeenCalledTimes(3);
  expect(scheduleFor("weekly_pipeline")!.lastRunAt).toBeNull();
});
