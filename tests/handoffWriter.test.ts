// SYNTHETIC ONLY: invented accounts, people, follow-ups and time off. AI_FAKE replay only.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requirePageUser: vi.fn(async () => ({ id: "user-1" })) }));
import { db } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { addDays, todayISO } from "@/lib/clock";
import { buildCover, coverSize, nextTimeOff } from "@/lib/handoff/cover";
import { checkDraft } from "@/lib/handoff/draft";
import { coversDue, latestAccountDraft, latestCoverDraft, runHandoffWriter, startAccountDraft } from "@/lib/handoff/writer";
import { addSource, storeEvents } from "@/lib/calendar/sync";
import { handOverAction } from "@/app/handoff/actions";
import { evidenceIds, buildContextPack } from "@/lib/meetings/contextPack";

const today = todayISO();
const day = (n: number) => addDays(today, n);

let seed: Seed;
beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  const user = db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'x', ?, 0, 0)");
  user.run(USER, "alex@example.com", "Alex");
  user.run("user-2", "jamie@example.com", "Jamie");
  seed = seedAccount();
});

const followUp = (payload: Record<string, unknown>) =>
  applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { status: "open", ...payload }, actorUserId: USER }).entityId;

function timeOff(from: number, to: number) {
  const s = addSource({ kind: "ics", label: "Alex's calendar", ownerUserId: USER, value: "https://calendar.example.com/a.ics", userId: USER });
  storeEvents(s, [{ key: "off", title: "Out of office", day: day(from), time: null, endDay: day(to), allDay: true, organizer: null, attendees: [], busy: "oof", cancelled: false }], { from: day(-7), to: day(30) });
}

describe("the cover sheet, built in code", () => {
  it("finds the next stretch of time off on the person's own calendar", () => {
    expect(nextTimeOff(USER)).toBeNull();
    timeOff(2, 4);
    expect(nextTimeOff(USER)).toEqual({ from: day(2), to: day(4), first: day(2) });
    expect(nextTimeOff(USER, today, 1)).toBeNull();
    // Once it has begun, the window starts today but remembers its first day.
    expect(nextTimeOff(USER, day(3))).toEqual({ from: day(3), to: day(4), first: day(2) });
  });

  it("lists their dated follow-ups, the meetings in the window, customer promises and play steps due", () => {
    const mine = followUp({ text: "Send the synthetic sizing outline", owner_user_id: USER, due: day(3) });
    followUp({ text: "Jamie's synthetic task", owner_user_id: "user-2", due: day(3) });
    followUp({ text: "Undated synthetic task", owner_user_id: USER });
    const theirs = followUp({ text: "Share the synthetic fleet numbers", owner: "Finley Example", due: day(2) });
    const meeting = applyEntityChange({ accountId: seed.accountId, entityType: "meeting", op: "create", payload: { title: "Synthetic steering call", held_at: day(3) }, actorUserId: USER }).entityId;
    applyEntityChange({ accountId: seed.accountId, entityType: "play", op: "update", entityId: seed.playId, payload: { next_step: "Book the synthetic workshop", next_step_due: day(4) }, actorUserId: USER });
    const c = buildCover(USER, { from: day(2), to: day(4) });
    expect(c.followUps.map((f) => f.id)).toEqual([mine]);
    expect(c.meetings.map((m) => m.id)).toEqual([meeting]);
    expect(c.promises.map((p) => p.id)).toEqual([theirs]);
    expect(c.plays.map((p) => p.id)).toEqual([seed.playId]);
    expect(c.partner).toEqual({ id: "user-2", name: "Jamie" });
    expect(coverSize(c)).toBe(4);
  });
});

describe("drafts cite only what they were given", () => {
  it("refuses an id that was not in the records", () => {
    const d = { opening: "Synthetic opening line.", points: [{ text: "Synthetic point.", refs: ["known", "made-up"] }] };
    expect(checkDraft(d, new Set(["known"])).map((f) => f.path)).toEqual(["points[0].refs[1]"]);
  });

  it("drafts an account handoff from the account's records, charged to the person who pressed", async () => {
    startAccountDraft(seed.accountId, USER);
    await vi.waitFor(() => expect(latestAccountDraft(seed.accountId)?.draft).not.toBeNull());
    const d = latestAccountDraft(seed.accountId)!.draft!;
    const ids = evidenceIds(buildContextPack(seed.accountId));
    expect(d.points.every((p) => p.refs.every((r) => ids.has(r)))).toBe(true);
    expect(db().prepare("SELECT assistant, created_by FROM ai_runs WHERE kind = 'handoff_draft'").get()).toEqual({ assistant: null, created_by: USER });
    // Drafting writes nothing to the account.
    expect(db().prepare("SELECT COUNT(*) AS n FROM documents WHERE kind = 'handoff'").get()).toEqual({ n: 0 });
  });
});

describe("Handoff writer on its own", () => {
  it("drafts a cover note three days before time off, once, from its own budget", async () => {
    followUp({ text: "Send the synthetic sizing outline", owner_user_id: USER, due: day(3) });
    timeOff(5, 6);
    expect(coversDue()).toEqual([]);
    db().prepare("DELETE FROM calendar_events").run();
    timeOff(2, 4);
    expect(coversDue().map((c) => c.userId)).toEqual([USER]);
    expect(runHandoffWriter("schedule", null)).toMatchObject({ started: true });
    await vi.waitFor(() => expect(latestCoverDraft(USER, { from: day(2), to: day(4) })?.draft).not.toBeNull());
    expect(db().prepare("SELECT assistant FROM ai_runs WHERE kind = 'handoff_draft'").get()).toEqual({ assistant: "handoff_writer" });
    expect(coversDue()).toEqual([]);
    expect(runHandoffWriter("schedule", null)).toBeNull();
  });

  it("drafts once for a long absence, not again on each day of it", async () => {
    followUp({ text: "Send the synthetic sizing outline", owner_user_id: USER, due: day(9) });
    timeOff(2, 15);
    expect(runHandoffWriter("schedule", null)).toMatchObject({ started: true });
    await vi.waitFor(() => expect(db().prepare("SELECT status FROM ai_runs WHERE kind = 'handoff_draft'").get()).toEqual({ status: "done" }));
    // Every later day of the same stretch, the cover is already drafted.
    for (const n of [2, 3, 8, 14]) expect(coversDue(day(n))).toEqual([]);
  });
});

describe("handing follow-ups over", () => {
  it("makes the partner the owner, as the presser's own edit, and refuses a stale card", async () => {
    const id = followUp({ text: "Send the synthetic sizing outline", owner_user_id: USER, due: day(3) });
    const v = (db().prepare("SELECT updated_at FROM action_items WHERE id = ?").get(id) as { updated_at: number }).updated_at;
    expect(await handOverAction([{ id, accountId: seed.accountId, version: v }], "user-2")).toMatchObject({ ok: true, moved: 1 });
    expect(db().prepare("SELECT owner_user_id FROM action_items WHERE id = ?").get(id)).toEqual({ owner_user_id: "user-2" });
    expect(db().prepare("SELECT actor_user_id FROM change_log WHERE entity_id = ? AND field = 'owner_user_id'").get(id)).toEqual({ actor_user_id: USER });
    // Someone else moved it back meanwhile: the old card does not win.
    applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "update", entityId: id, payload: { owner_user_id: USER }, actorUserId: "user-2" });
    expect(await handOverAction([{ id, accountId: seed.accountId, version: v }], "user-2")).toMatchObject({ ok: false });
    expect(await handOverAction([{ id, accountId: seed.accountId, version: v }], "nobody")).toMatchObject({ ok: false });
  });
});
