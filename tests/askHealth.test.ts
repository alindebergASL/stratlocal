// Synthetic runs, messages and proposals only.
import { expect, it } from "vitest";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { askHealth } from "@/lib/ask/health";
import { createProposalBatch } from "@/lib/proposals/apply";

it("counts answers, time, cost, verdicts, proposals and repeated questions from what is stored", () => {
  const now = Date.now();
  const run = (id: string, status: string, secs: number, cents: number | null) =>
    db().prepare("INSERT INTO ai_runs (id, account_id, kind, provider, model, status, started_at, finished_at, cost_cents) VALUES (?, NULL, 'ask', 'bedrock', 'm', ?, ?, ?, ?)").run(id, status, now - 60000, now - 60000 + secs * 1000, cents);
  run("r1", "done", 10, 3);
  run("r2", "done", 30, 5);
  run("r3", "done", 20, 4);
  run("r4", "failed", 5, null);
  db().prepare("INSERT INTO ask_threads (id, title, created_at, updated_at) VALUES ('t1', 'Synthetic', ?, ?)").run(now, now);
  const msg = (id: string, role: string, text: string, verdict: string | null) =>
    db().prepare("INSERT INTO ask_messages (id, thread_id, role, text, created_at, verdict) VALUES (?, 't1', ?, ?, ?, ?)").run(id, role, text, now - 1000, verdict);
  msg("m1", "user", "What slipped this week?", null);
  msg("m2", "user", "what slipped this week? ", null);
  msg("m3", "assistant", "A.", "useful");
  msg("m4", "assistant", "B.", "wrong");
  msg("m5", "assistant", "C.", null);
  const { accountId } = seedAccount();
  createProposalBatch(accountId, { kind: "plan_draft", id: "ask:t1", aiRunId: null }, [{ entity_type: "action_item", op: "create", payload: { text: "Synthetic" }, rationale: "synthetic" }]);

  const h = askHealth(now);
  expect(h).toMatchObject({ answered: 3, failed: 1, medianSeconds: 20, medianCents: 4, totalCents: 12, useful: 1, wrong: 1, unmarked: 1, proposals: { accepted: 0, waiting: 1, rejected: 0 } });
  expect(h.repeated).toEqual([{ text: "What slipped this week?", times: 2 }]);
  // Older than the window: not counted.
  expect(askHealth(now + 40 * 86400000).answered).toBe(0);
});
