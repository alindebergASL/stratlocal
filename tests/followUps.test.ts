// A follow-up you can write down, owned by a person.
//
// Until now the only way to create one was: make a meeting, paste notes, pay
// for an extraction, accept a proposal. Four steps and a model call to record
// one line — and extraction is told to set a date only when the notes gave
// one, while every attention surface requires `due IS NOT NULL`. So the common
// case was a follow-up invisible to Home forever, with no form anywhere to
// give it a date.
//
// And "who owns it" was free text, so "what do I owe across every account"
// could not be asked. That is what owner_user_id is for; `owner` stays,
// because a follow-up can belong to someone at the customer and because the
// notes say whatever they say.
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { listActionItems, listOpenFollowUps } from "@/lib/queries/meetings";
import { listAttention } from "@/lib/queries/attention";
import { diffMeetingExtraction } from "@/lib/meetings/diffMeeting";
import { buildContextPack } from "@/lib/meetings/contextPack";
import { seedAccount, USER, type Seed } from "./helpers";

const THEM = "user-2";
const US = [
  { id: USER, name: "Alex Calloway" },
  { id: THEM, name: "Jamie Okafor" },
];

let seed: Seed;
beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

function write(payload: Record<string, unknown>, accountId = seed.accountId) {
  return applyEntityChange({
    accountId,
    entityType: "action_item",
    op: "create",
    payload: { status: "open", ...payload },
    actorUserId: USER,
  }).entityId;
}

describe("writing one down", () => {
  it("takes a due date, which is the whole reason Home can see it", () => {
    write({ text: "Send the sizing document", due: "2020-01-01", owner_user_id: USER });
    const items = listActionItems(seed.accountId, { status: "open" });
    expect(items).toHaveLength(1);
    expect(items[0]?.due).toBe("2020-01-01");
    // Every attention query requires a date. An extracted follow-up often has
    // none, and before this there was no form to add one.
    const overdue = listAttention().filter((a) => a.text.includes("Send the sizing document"));
    expect(overdue.length).toBeGreaterThan(0);
  });

  it("can belong to nobody here, and keeps what the notes called them", () => {
    write({ text: "Their security team to review", owner: "Finley Example", owner_user_id: null });
    const item = listActionItems(seed.accountId, { status: "open" })[0]!;
    expect(item.owner).toBe("Finley Example");
    expect(item.owner_user_id ?? null).toBeNull();
    // Not mine, not theirs — and it still has to be findable.
    expect(listOpenFollowUps({ ownerUserId: USER })).toHaveLength(0);
    expect(listOpenFollowUps({ unowned: true }).map((i) => i.text)).toEqual(["Their security team to review"]);
  });
});

describe("everything I owe", () => {
  it("crosses accounts and is filtered by person", () => {
    const other = applyEntityChange({
      accountId: "",
      entityType: "account",
      op: "create",
      payload: { name: "Fabrikam Health" },
      actorUserId: USER,
    }).entityId;
    write({ text: "Mine, here", owner_user_id: USER });
    write({ text: "Mine, over there", owner_user_id: USER }, other);
    write({ text: "Theirs", owner_user_id: THEM });

    const mine = listOpenFollowUps({ ownerUserId: USER });
    expect(mine.map((i) => i.text).sort()).toEqual(["Mine, here", "Mine, over there"]);
    // The account's name comes with it, because the list is grouped by
    // account and a follow-up without one is not actionable.
    expect(new Set(mine.map((i) => i.account_name))).toEqual(new Set(["Synthetic Orchard Lab", "Fabrikam Health"]));
    expect(listOpenFollowUps({ ownerUserId: THEM }).map((i) => i.text)).toEqual(["Theirs"]);
  });

  it("puts the dated ones first and the undated ones last", () => {
    write({ text: "No date", owner_user_id: USER });
    write({ text: "Later", due: "2027-03-01", owner_user_id: USER });
    write({ text: "Soon", due: "2026-01-01", owner_user_id: USER });
    // Undated last on purpose: they are the ones nothing else in the app will
    // ever remind you about, so they belong where you stop reading.
    expect(listOpenFollowUps({ ownerUserId: USER }).map((i) => i.text)).toEqual(["Soon", "Later", "No date"]);
  });

  it("leaves out what is done, archived, or on an archived account", () => {
    const done = write({ text: "Finished", owner_user_id: USER });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "update",
      entityId: done,
      payload: { status: "done" },
      actorUserId: USER,
    });
    write({ text: "Still open", owner_user_id: USER });
    expect(listOpenFollowUps({ ownerUserId: USER }).map((i) => i.text)).toEqual(["Still open"]);
  });
});

describe("what the notes said, and who that is", () => {
  const extraction = (owner: string | null) => ({
    summary: "",
    action_items: [{ text: "Send the sizing document", owner, due: null, quote: "I will send the sizing document" }],
    deal_updates: [],
    play_updates: [],
    contact_updates: [],
  });

  const diff = (owner: string | null) =>
    diffMeetingExtraction(extraction(owner) as never, buildContextPack(seed.accountId), {
      meetingId: seed.meetingId,
      currentSummary: null,
      users: US,
    })[0]!.payload as Record<string, unknown>;

  it("files it under the person when the name is one of ours", () => {
    expect(diff("Alex")).toMatchObject({ owner: "Alex", owner_user_id: USER });
    expect(diff("Jamie Okafor")).toMatchObject({ owner_user_id: THEM });
    expect(diff("alex calloway")).toMatchObject({ owner_user_id: USER });
  });

  it("does not guess", () => {
    // A customer's name is not one of us, and neither is a blank.
    expect(diff("Finley Example")).toMatchObject({ owner: "Finley Example", owner_user_id: null });
    expect(diff(null)).toMatchObject({ owner_user_id: null });
    // An ambiguous first name would file someone else's work under your name,
    // which is worse than leaving it unassigned.
    const twoAlexs = diffMeetingExtraction(extraction("Alex") as never, buildContextPack(seed.accountId), {
      meetingId: seed.meetingId,
      currentSummary: null,
      users: [
        { id: USER, name: "Alex Calloway" },
        { id: THEM, name: "Alex Okafor" },
      ],
    })[0]!.payload as Record<string, unknown>;
    expect(twoAlexs.owner_user_id).toBeNull();
  });
});
