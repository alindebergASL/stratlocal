// SYNTHETIC ONLY. No network: streamed provider responses are controlled here.
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as client from "@/lib/ai/client";
import { db } from "@/lib/db";
import { getRun } from "@/lib/ai/guard";
import { startAsk } from "@/lib/ask/run";
import { createThread } from "@/lib/ask/threads";

import { seedAccount, USER } from "./helpers";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function move(dealId: string, from: string, to: string) {
  db().prepare("UPDATE deals SET account_id = ? WHERE deal_id = ?").run(to, dealId);
  db().prepare("INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at) VALUES (?, ?, 'deal', ?, 'account_id', ?, ?, ?, ?)")
    .run(randomUUID(), to, dealId, JSON.stringify(from), JSON.stringify(to), USER, Date.now());
}

it("rejects saved focus that has moved away from its thread account before any provider call", () => {
  vi.stubEnv("AI_FAKE", "1");
  const a = seedAccount();
  const b = seedAccount({ name: "Synthetic Second", dealId: "SYN-SECOND" });
  const focus = { kind: "deal" as const, id: a.dealId };
  const thread = createThread({ accountId: a.accountId, question: "This deal", saved: true, userId: USER, focus });
  move(a.dealId, a.accountId, b.accountId);
  const provider = vi.spyOn(client, "getClient");
  expect(() => startAsk({ userId: USER, threadId: thread.id, question: "Write about this deal" })).toThrow(/focus|context|moved/i);
  expect(provider).not.toHaveBeenCalled();
  expect(db().prepare("SELECT count(*) n FROM ai_runs").get()).toEqual({ n: 0 });
});

it.each([false, true])("captures focused record ownership before the first stream (move back: %s)", async (back) => {
  vi.stubEnv("AI_FAKE", "");
  vi.stubEnv("AWS_REGION", "us-west-2");
  const a = seedAccount();
  const b = seedAccount({ name: "Synthetic Second", dealId: "SYN-SECOND" });
  const before = db().prepare("SELECT count(*) n FROM documents").get();
  let round = 0;
  const requests: unknown[] = [];
  const stream = vi.fn((request: unknown) => {
    requests.push(request);
    const i = round++;
    return { on: vi.fn(), finalMessage: async () => {
      if (i === 0) {
        move(a.dealId, a.accountId, b.accountId);
        if (back) move(a.dealId, b.accountId, a.accountId);
      }
      // Only read A, not the moved deal: its prompt alone already informed the model.
      const call = i === 0 ? { name: "account", input: { account_id: a.accountId } }
        : i === 1 ? { name: "create_report", input: { title: "Synthetic report", account_id: a.accountId, sections: [{ heading: "Snapshot", body: "Synthetic account [1]." }], citations: [{ n: 1, kind: "account", id: a.accountId }] } }
        : { name: "final_answer", input: { text: "Nothing saved.", citations: [] } };
      return { content: [{ type: "tool_use", id: `test-${i}`, ...call }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "tool_use" };
    } };
  });
  vi.spyOn(client, "getClient").mockReturnValue({ messages: { stream } } as unknown as ReturnType<typeof client.getClient>);
  const run = startAsk({ userId: USER, question: "Report on this deal", focus: { kind: "deal", id: a.dealId } });
  await vi.waitFor(() => expect(getRun(run.runId)?.status).toBe("failed"));
  expect(db().prepare("SELECT count(*) n FROM documents").get()).toEqual(before);
  expect(stream).toHaveBeenCalledTimes(1);
  // Subsequent system prompts must never follow the deal to B.
  expect(JSON.stringify(requests.map((r) => (r as { system: unknown }).system))).not.toContain(b.accountId);
});
