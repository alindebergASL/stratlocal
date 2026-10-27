// SYNTHETIC ONLY: invented people, notes and quotes. AI_FAKE replay only.
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { seedAccount, USER, type Seed } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { checkRecap, MAILTO_LIMIT, recapMailto, recapText, type MeetingRecap } from "@/lib/meetings/recap";
import { latestRecapRun } from "@/lib/meetings/run";
import { promiseDirection, splitPromises } from "@/lib/promises";
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requireUser: () => ({ id: "user-1" }) }));
import { POST } from "@/app/api/meetings/[id]/recap/route";

let seed: Seed;
beforeEach(() => {
  seed = seedAccount();
  vi.stubEnv("AI_FAKE", "1");
});

const NOTES = "Synthetic call notes.\nThe customer wants a revised depot sizing outline.\nWe agreed to send it next week.";

const draft: MeetingRecap = {
  to: ["Finley Example"],
  subject: "Thanks for today",
  greeting: "Hi Finley,",
  opening: "Thanks for the time today.",
  points: [{ text: "You want a revised depot sizing outline.", quote: "The customer wants a revised depot sizing outline." }],
  next_steps: [{ text: "We will send it by [pick a day].", quote: "We agreed to send it next week." }],
  closing: "Shout if I missed anything.",
};

it("accepts a draft whose recipients attended and whose every line quotes the notes", () => {
  expect(checkRecap(draft, { notes: NOTES, attendees: ["Finley Example"] })).toEqual([]);
});

it("refuses a recipient who was not there and a line the notes do not say", () => {
  const bad = { ...draft, to: ["Synthetic Stranger"], next_steps: [{ text: "Pricing is agreed.", quote: "Pricing was agreed at the call." }] };
  expect(checkRecap(bad, { notes: NOTES, attendees: ["Finley Example"] }).map((f) => f.path)).toEqual(["to[0]", "next_steps[0].quote"]);
});

it("signs the plain-text email with the sender's name, added by the app", () => {
  const text = recapText(draft, "Synthetic Seller");
  expect(text.startsWith("Hi Finley,")).toBe(true);
  expect(text).toContain("- You want a revised depot sizing outline.");
  expect(text).toContain("Next steps:");
  expect(text.endsWith("Best,\nSynthetic Seller")).toBe(true);
  expect(text).not.toMatch(/\n\n\n/);
});

async function post() {
  const res = await POST(new NextRequest("http://localhost/api/meetings/x/recap", { method: "POST" }), { params: Promise.resolve({ id: seed.meetingId }) });
  const json = await res.json();
  if (json.runId) await vi.waitFor(() => expect((db().prepare("SELECT status FROM ai_runs WHERE id=?").get(json.runId) as { status: string }).status).not.toBe("running"));
  return { status: res.status, json };
}

it("asks for notes before drafting, and starts no run without them", async () => {
  expect((await post()).status).toBe(400);
  expect(db().prepare("SELECT COUNT(*) n FROM ai_runs").get()).toEqual({ n: 0 });
});

it("drafts from the saved notes to the people who attended, and writes nothing to the account", async () => {
  applyEntityChange({ accountId: seed.accountId, entityType: "meeting", entityId: seed.meetingId, op: "update", payload: { raw_notes: NOTES }, actorUserId: USER });
  const before = db().prepare("SELECT COUNT(*) n FROM proposals").get();
  const res = await post();
  expect(res.status).toBe(200);
  const latest = latestRecapRun(seed.accountId, seed.meetingId);
  expect(latest?.id).toBe(res.json.runId);
  expect(latest?.recap?.to).toEqual(["Finley Example"]);
  expect(checkRecap(latest!.recap!, { notes: NOTES, attendees: ["Finley Example"] })).toEqual([]);
  expect(db().prepare("SELECT COUNT(*) n FROM proposals").get()).toEqual(before);
});

it("reads a follow-up as ours or theirs from who owns it", () => {
  const users = [{ name: "Synthetic Seller" }];
  expect(promiseDirection({ owner: null, ownerUserId: "user-1" })).toBe("ours");
  expect(promiseDirection({ owner: "We", ownerUserId: null })).toBe("ours");
  expect(promiseDirection({ owner: "Synthetic", ownerUserId: null }, users)).toBe("ours");
  expect(promiseDirection({ owner: "Finley Example", ownerUserId: null }, users)).toBe("theirs");
  expect(promiseDirection({ owner: "  ", ownerUserId: null })).toBe("unowned");
  // A customer who shares a first name with one of us: a bare first name can
  // no longer be told apart, and their full name is theirs.
  expect(promiseDirection({ owner: "Synthetic", ownerUserId: null }, users, ["Synthetic Buyer"])).toBe("unowned");
  expect(promiseDirection({ owner: "Synthetic Buyer", ownerUserId: null }, users, ["Synthetic Buyer"])).toBe("theirs");
  expect(promiseDirection({ owner: "Synthetic Seller", ownerUserId: null }, users, ["Synthetic Buyer"])).toBe("ours");
  const split = splitPromises([
    { owner: "Finley Example", ownerUserId: null },
    { owner: null, ownerUserId: "user-1" },
    { owner: null, ownerUserId: null },
  ]);
  expect([split.ours.length, split.theirs.length, split.unowned.length]).toEqual([1, 1, 1]);
});

it("leaves a long draft's body out of the mail link rather than lose the link", () => {
  const short = recapMailto(["finley@example.com"], "Thanks", "A short note.");
  expect(short).toEqual({ href: "mailto:finley%40example.com?subject=Thanks&body=A%20short%20note.", withBody: true });
  const long = recapMailto(["finley@example.com"], "Thanks", "word ".repeat(MAILTO_LIMIT));
  expect(long).toEqual({ href: "mailto:finley%40example.com?subject=Thanks", withBody: false });
});
