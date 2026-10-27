// SYNTHETIC ONLY: invented account, person and follow-up.
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requirePageUser: vi.fn(async () => ({ id: "user-1" })) }));
import { db } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { todayISO, addDays } from "@/lib/clock";
import { openNotices, runPromiseKeeper } from "@/lib/assistants/promiseKeeper";
import { answerPromise, dismissNotice, runAssistantNow, saveAssistantAction, saveBudgetAction } from "@/app/assistants/actions";

let seed: Seed;
let item: string;
beforeEach(() => {
  seed = seedAccount();
  item = applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { text: "Share the synthetic fleet numbers", owner: "Finley Example", status: "open" }, actorUserId: USER }).entityId;
  runPromiseKeeper("manual", USER);
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

it("answers 'when did they say?' by dating the follow-up as your own edit, and closes the question", async () => {
  const [q] = openNotices(USER);
  const due = addDays(todayISO(), 7);
  expect(await answerPromise(q!.id, form({ due }))).toEqual({ ok: true });
  expect(db().prepare("SELECT due FROM action_items WHERE id = ?").get(item)).toEqual({ due });
  expect(db().prepare("SELECT actor_user_id FROM change_log WHERE entity_id = ? AND field = 'due'").get(item)).toEqual({ actor_user_id: USER });
  expect(openNotices(USER).filter((n) => n.kind === "question")).toEqual([]);
  expect((await answerPromise(q!.id, form({ due })) as { ok: boolean }).ok).toBe(false);
});

it("will not date a promise in the past, nor overwrite a date someone set meanwhile", async () => {
  const [q] = openNotices(USER);
  expect(await answerPromise(q!.id, form({ due: addDays(todayISO(), -1) }))).toMatchObject({ ok: false });
  const theirs = addDays(todayISO(), 3);
  db().prepare("UPDATE action_items SET due = ? WHERE id = ?").run(theirs, item);
  expect(await answerPromise(q!.id, form({ due: addDays(todayISO(), 9) }))).toMatchObject({ ok: false, error: expect.stringContaining("already has a date") });
  expect(db().prepare("SELECT due FROM action_items WHERE id = ?").get(item)).toEqual({ due: theirs });
});

it("lets a question be closed without touching the follow-up", async () => {
  const [q] = openNotices(USER);
  expect(await dismissNotice(q!.id)).toEqual({ ok: true });
  expect(db().prepare("SELECT due FROM action_items WHERE id = ?").get(item)).toEqual({ due: null });
  expect(await dismissNotice(q!.id)).toMatchObject({ ok: false });
});

it("reads dollars as typed and refuses an assistant switched off from running", async () => {
  expect(await saveBudgetAction(form({ total: "$1,250.50", share: "100" }))).toEqual({ ok: true });
  expect(db().prepare("SELECT value FROM settings WHERE key = 'ai_monthly_total_cents'").get()).toEqual({ value: "125050" });
  expect(await saveBudgetAction(form({ total: "lots", share: "100" }))).toMatchObject({ ok: false });
  expect(await saveAssistantAction("promise_keeper", form({ mode: "off", limit: "0" }))).toEqual({ ok: true });
  expect(await runAssistantNow("promise_keeper")).toMatchObject({ ok: false, error: expect.stringContaining("switched off") });
  expect(await saveAssistantAction("nobody", form({ mode: "auto", limit: "0" }))).toMatchObject({ ok: false });
});
