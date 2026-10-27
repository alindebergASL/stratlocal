// SYNTHETIC ONLY: invented accounts, people and dates.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { addDays, todayISO } from "@/lib/clock";
import { listBacklog } from "@/lib/queries/attention";
import { clearedToday, partnerDigest } from "@/lib/queries/today";
import { greeting, planToday, RECENT_OVERDUE_DAYS, TODAY_LIMIT, todaySentence } from "@/lib/today";
import type { AttentionItem } from "@/lib/queries/attention";
import type { UpcomingMeeting } from "@/lib/queries/today";
import { USER } from "./helpers";

const TODAY = "2026-10-21";
const TOMORROW = "2026-10-22";

function meeting(id: string, heldAt: string, heldTime: string | null, extra: Partial<UpcomingMeeting> = {}): UpcomingMeeting {
  return { id, title: `Synthetic call ${id}`, heldAt, heldTime, inProgress: false, accountId: "acc", accountName: "Synthetic Account", hasBrief: false, hasNotes: false, attendees: 0, href: `/accounts/acc/meetings/${id}`, ...extra };
}
function work(kind: AttentionItem["kind"], due: string, n: number, unit: "follow-up" | "play" = "follow-up"): AttentionItem {
  return { kind, accountId: "acc", accountName: "Synthetic Account", text: `Synthetic work ${n}`, detail: null, unit, due, href: `/accounts/acc#action-${n}` };
}

it("orders by the printed rule, caps at five and never repeats the Next-up item", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [meeting("a", TODAY, "09:00"), meeting("b", TODAY, "15:00"), meeting("c", TOMORROW, "10:00"), meeting("d", TOMORROW, "11:00", { hasBrief: true })],
    notes: [meeting("n1", addDays(TODAY, -1), "09:00")],
    attention: [
      work("due_today", TODAY, 1),
      work("overdue", addDays(TODAY, -2), 2),
      work("overdue", addDays(TODAY, -1), 3),
      work("overdue", addDays(TODAY, -30), 4),
      work("overdue", addDays(TODAY, -40), 5, "play"),
      { kind: "proposals", accountId: "acc", accountName: "Synthetic Account", text: "3 proposed changes", detail: null, count: 3, href: "/accounts/acc/review" },
    ],
    partners: [],
    primaryHref: "/accounts/acc/meetings/a#brief",
  });
  // The Next-up meeting is not repeated; a meeting that already has a brief needs no preparation.
  expect(plan.items.map((i) => i.key)).toEqual([
    "prepare-b",
    "prepare-c",
    "due-/accounts/acc#action-1",
    // Most recent slip first.
    "late-/accounts/acc#action-3",
    "late-/accounts/acc#action-2",
  ]);
  expect(plan.items).toHaveLength(TODAY_LIMIT);
  expect(plan.found).toBe(7);
  expect(plan.backlog).toEqual({ followUps: 1, plays: 1 });
  expect(plan.meetingsToday).toBe(2);
  expect(plan.laterToday.map((m) => m.id)).toEqual(["b"]);
  expect(plan.items[0]!.why).toBe("today at 15:00");
  expect(plan.items[3]!.why).toBe("1 day late");
});

it("keeps the boundary between a recent slip and the backlog at exactly a week", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [],
    notes: [],
    attention: [work("overdue", addDays(TODAY, -RECENT_OVERDUE_DAYS), 1), work("overdue", addDays(TODAY, -RECENT_OVERDUE_DAYS - 1), 2)],
    partners: [],
    primaryHref: null,
  });
  expect(plan.items.map((i) => i.title)).toEqual(["Synthetic work 1"]);
  expect(plan.backlog.followUps).toBe(1);
});

it("says the day in one counted sentence and greets by the app's clock", () => {
  const none = { followUps: 0, plays: 0 };
  expect(todaySentence({ meetingsToday: 2, found: 3, backlog: none }, false)).toBe("Two meetings today, three things to clear. Nothing is overdue.");
  expect(todaySentence({ meetingsToday: 0, found: 0, backlog: none }, false)).toBe("No meetings today, nothing waiting on you. Nothing is overdue.");
  // An old backlog is not "nothing waiting": it is shown below, and the sentence does not deny it.
  expect(todaySentence({ meetingsToday: 0, found: 0, backlog: { followUps: 4, plays: 0 } }, true)).toBe("No meetings today, nothing new to clear.");
  expect(todaySentence({ meetingsToday: 1, found: 12, backlog: none }, true)).toBe("One meeting today. Here are the five that matter most.");
  expect(greeting("08:10", "Alex Example")).toBe("Good morning, Alex.");
  expect(greeting("13:00", "Alex")).toBe("Good afternoon, Alex.");
  expect(greeting("17:40", undefined)).toBe("Good evening.");
});

function seedUsers() {
  const insert = db().prepare("INSERT OR IGNORE INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)");
  insert.run(USER, "alex@example.test", "unused", "Alex");
  insert.run("user-2", "jamie@example.test", "unused", "Jamie");
}

it("digests the other person's recent changes per account and leaves out your own", () => {
  seedUsers();
  const a = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic Digest A" }, actorUserId: "user-2" }).entityId;
  const b = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic Digest B" }, actorUserId: "user-2" }).entityId;
  applyEntityChange({ accountId: a, entityType: "account", entityId: a, op: "update", payload: { region: "West" }, actorUserId: "user-2" });
  applyEntityChange({ accountId: b, entityType: "action_item", op: "create", payload: { text: "Synthetic partner task", status: "open" }, actorUserId: "user-2" });
  applyEntityChange({ accountId: b, entityType: "account", entityId: b, op: "update", payload: { region: "East" }, actorUserId: USER });
  const digest = partnerDigest(new Date(), USER);
  expect(digest).toHaveLength(1);
  expect(digest[0]!.actorName).toBe("Jamie");
  // One record on each account. Creating an account is logged before it has
  // an id to file under, so the digest counts what was done inside them.
  expect(digest[0]!.records).toBe(2);
  expect(digest[0]!.accounts.map((x) => x.name).sort()).toEqual(["Synthetic Digest A", "Synthetic Digest B"]);
  expect(partnerDigest(new Date(), "user-2").map((d) => d.actorName)).toEqual(["Alex"]);
});

it("counts what you cleared today from history: done follow-ups and decided proposals", () => {
  seedUsers();
  const acc = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic Cleared" }, actorUserId: USER }).entityId;
  const item = applyEntityChange({ accountId: acc, entityType: "action_item", op: "create", payload: { text: "Synthetic follow-up", status: "open" }, actorUserId: USER }).entityId;
  expect(clearedToday(new Date(), USER)).toBe(0);
  applyEntityChange({ accountId: acc, entityType: "action_item", entityId: item, op: "update", payload: { status: "done" }, actorUserId: USER });
  expect(clearedToday(new Date(), USER)).toBe(1);
  expect(clearedToday(new Date(), "user-2")).toBe(0);
  createProposalBatch(acc, { kind: "plan_draft", id: null, aiRunId: null }, [{ entity_type: "action_item", op: "create", payload: { text: "Synthetic proposal" } }]);
  db().prepare("UPDATE proposals SET status='rejected', decided_by=?, decided_at=? WHERE account_id=?").run(USER, Date.now(), acc);
  expect(clearedToday(new Date(), USER)).toBe(2);
});

it("lists the backlog oldest first, bounded, with the version a new date must carry", () => {
  const today = todayISO();
  const acc = applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic Backlog" }, actorUserId: USER }).entityId;
  const old = applyEntityChange({ accountId: acc, entityType: "action_item", op: "create", payload: { text: "Synthetic oldest", status: "open", due: addDays(today, -60) }, actorUserId: USER }).entityId;
  applyEntityChange({ accountId: acc, entityType: "action_item", op: "create", payload: { text: "Synthetic older", status: "open", due: addDays(today, -10) }, actorUserId: USER });
  applyEntityChange({ accountId: acc, entityType: "action_item", op: "create", payload: { text: "Synthetic recent", status: "open", due: addDays(today, -3) }, actorUserId: USER });
  applyEntityChange({ accountId: acc, entityType: "action_item", op: "create", payload: { text: "Synthetic done", status: "done", due: addDays(today, -90) }, actorUserId: USER });
  const { items, total } = listBacklog(new Date(), undefined, RECENT_OVERDUE_DAYS);
  expect(total).toBe(2);
  expect(items.map((i) => i.text)).toEqual(["Synthetic oldest", "Synthetic older"]);
  const version = (db().prepare("SELECT updated_at FROM action_items WHERE id=?").get(old) as { updated_at: number }).updated_at;
  expect(items[0]!.version).toBe(version);
});

it("puts Promise keeper's questions in as one item, and its reminders after notes without repeating Today's own rows", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [],
    notes: [meeting("n1", addDays(TODAY, -1), "09:00")],
    attention: [work("due_today", TODAY, 1)],
    partners: [],
    promises: {
      questions: [{ accountName: "Synthetic Account" }, { accountName: "Synthetic Other" }],
      soon: [
        { key: "p1", title: "Synthetic outline", accountName: "Synthetic Account", why: "You promised this for Thu 22 Oct", href: "/accounts/acc#action-9" },
        // Already on Today as due today: not twice.
        { key: "p2", title: "Synthetic work 1", accountName: "Synthetic Account", why: "Finley promised this for Wed 21 Oct", href: "/accounts/acc#action-1" },
      ],
    },
    primaryHref: null,
  });
  expect(plan.items.map((i) => i.kind)).toEqual(["due", "question", "notes", "promise"]);
  const q = plan.items[1]!;
  expect([q.title, q.accountName, q.href]).toEqual(["2 customer promises with no date", "Synthetic Account and Synthetic Other", "/inbox?kind=promise"]);
  expect(plan.items[3]!.title).toBe("Synthetic outline");
});

it("offers the calendar's meetings as one item after reviews, and the other person's time off as news", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [],
    notes: [],
    attention: [{ kind: "proposals", accountId: "acc", accountName: "Synthetic Account", text: "1 proposed change", detail: null, count: 1, href: "/accounts/acc/review" }],
    partners: [],
    calendar: { toAdd: 3, questions: 1 },
    timeOff: [{ name: "Jamie", when: "Fri 30 Oct – Mon 2 Nov" }],
    primaryHref: null,
  });
  expect(plan.items.map((i) => [i.kind, i.title])).toEqual([
    ["review", "Review 1 proposed change"],
    ["calendar", "Add 3 meetings from the calendar"],
    ["fyi", "Jamie is off Fri 30 Oct – Mon 2 Nov"],
  ]);
  expect(plan.items[1]!.why).toBe("matched by who is invited; 1 more need an account");
});

it("carries Account watch's notes after the calendar, one line per account that opens that account's review", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [],
    notes: [],
    attention: [],
    partners: [],
    calendar: { toAdd: 1, questions: 0 },
    news: [
      { accountName: "Synthetic Orchard", findings: 3, touching: 1, href: "/accounts/a/research#research-review" },
      { accountName: "Synthetic Juniper", findings: 2, touching: 0, href: "/accounts/b/research#research-review" },
      { accountName: "Synthetic Alder", findings: 4, touching: 1, signals: 2, href: "/accounts/c/research#research-review" },
    ],
    primaryHref: null,
  });
  expect(plan.items.map((i) => [i.kind, i.title, i.accountName, i.why, i.href])).toEqual([
    ["calendar", "Add 1 meeting from the calendar", "Calendar", "matched by who is invited", expect.any(String)],
    ["news", "3 news items to keep or drop", "Synthetic Orchard", "1 touches a play", "/accounts/a/research#research-review"],
    ["news", "2 news items to keep or drop", "Synthetic Juniper", "none touches a play", "/accounts/b/research#research-review"],
    ["news", "4 news items to keep or drop", "Synthetic Alder", "2 reasons to act, 1 touches a play", "/accounts/c/research#research-review"],
  ]);
});

it("carries Plan keeper's questions as one item after the customer promises", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [],
    notes: [],
    attention: [],
    partners: [],
    promises: { questions: [{ accountName: "Synthetic Account" }], soon: [] },
    planQuestions: [{ accountName: "Synthetic Orchard" }, { accountName: "Synthetic Orchard" }, { accountName: "Synthetic Juniper" }],
    primaryHref: null,
  });
  expect(plan.items.map((i) => [i.kind, i.title, i.href])).toEqual([
    ["question", "1 customer promise with no date", "/inbox?kind=promise"],
    ["question", "3 questions about the plan", "/inbox?kind=plan"],
  ]);
  expect(plan.items[1]!.accountName).toBe("Synthetic Orchard and Synthetic Juniper");
});

it("puts your own coming time off after reviews, and links the other person's to their cover sheet", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [],
    notes: [],
    attention: [],
    partners: [],
    myTimeOff: { when: "Fri 23 Oct", things: 4 },
    timeOff: [{ name: "Jamie", when: "Mon 26 Oct", href: "/handoff?for=user-2" }],
    primaryHref: null,
  });
  expect(plan.items.map((i) => [i.kind, i.title, i.why, i.href])).toEqual([
    ["handoff", "You are off Fri 23 Oct", "4 things to hand over", "/handoff"],
    ["fyi", "Jamie is off Mon 26 Oct", "from their calendar", "/handoff?for=user-2"],
  ]);
});

it("hides only the Next-up follow-up, not the rest of its account's", () => {
  const plan = planToday({
    today: TODAY,
    tomorrow: TOMORROW,
    upcoming: [],
    notes: [],
    attention: [work("due_today", TODAY, 1), work("overdue", addDays(TODAY, -1), 2), work("overdue", addDays(TODAY, -2), 3)],
    partners: [],
    primaryHref: "/accounts/acc#action-1",
  });
  expect(plan.items.map((i) => i.key)).toEqual(["late-/accounts/acc#action-2", "late-/accounts/acc#action-3"]);
  expect(plan.found).toBe(2);
});
