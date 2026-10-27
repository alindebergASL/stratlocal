// Synthetic data only. The living account page (DECISIONS #100).
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { whereItStands, type StandsInput } from "@/lib/accounts/whereItStands";
import { accountSince, markAccountSeen, ACCOUNT_PAUSE_MS } from "@/lib/accounts/lastLooked";
import { sinceLooked } from "@/lib/accounts/sinceLooked";
import { nextToWatch, setWatched, watchEstimate, watchPace, watchedAccounts } from "@/lib/assistants/accountWatch";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, display_name: "Synthetic Me", email: "me@example.test" }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const base: StandsInput = { accountId: "a", today: "2026-10-26", openDeals: 0, pipelineUsd: 0, biggest: null, withoutNextStep: 0, lastMeeting: null, nextMeeting: null, livePlays: 0, topPlay: null, thesis: false, lead: null };
const text = (s: ReturnType<typeof whereItStands>) => s.map((x) => x.map((c) => c.text).join("")).join(" ");

it("says where an account stands in counted sentences, each clause linked to its record", () => {
  expect(text(whereItStands(base))).toBe("No open deals. No meeting on file yet; nothing booked. No plan yet.");
  const full = whereItStands({
    ...base,
    openDeals: 3,
    pipelineUsd: 2_400_000,
    biggest: { id: "D-1", name: "Synthetic platform", stage: "Stage 4", closeDate: "2027-01-29", nextStep: null, waived: false },
    withoutNextStep: 2,
    lastMeeting: { id: "m1", title: "Synthetic discovery", date: "2026-10-10" },
    livePlays: 2,
    topPlay: { id: "p1", title: "Synthetic records modernisation" },
    lead: { label: "Why now", text: "A synthetic capital plan was approved.", href: "/accounts/a/research?note=n&finding=0" },
  });
  const t = text(full);
  expect(t).toContain("open across 3 deals; the biggest, Synthetic platform is at Stage 4, closing");
  expect(t).toContain("with no next step agreed. 2 open deals without a next step.");
  expect(t).toContain("2 live plays, led by Synthetic records modernisation. Why now: A synthetic capital plan was approved.");
  expect(full.flat().filter((c) => c.href).map((c) => c.href)).toContain("/accounts/a/deals/D-1");
  expect(full.flat().filter((c) => c.href).map((c) => c.href)).toContain("/accounts/a/deals?next=none");
});

it("remembers when you last looked, holds through a reload, and moves on after a pause", () => {
  const { accountId } = seedAccount({ name: "Synthetic Looked", dealId: "SYN-LOOKED-1" });
  const t0 = 1_800_000_000_000;
  expect(accountSince(USER, accountId, t0)).toBeNull();
  markAccountSeen(USER, accountId, t0);
  expect(accountSince(USER, accountId, t0 + 60_000)).toBeNull();
  markAccountSeen(USER, accountId, t0 + 60_000);
  const later = t0 + 60_000 + ACCOUNT_PAUSE_MS + 1;
  expect(accountSince(USER, accountId, later)).toBe(t0 + 60_000);
  markAccountSeen(USER, accountId, later);
  // A reload a minute later still compares with the visit before.
  expect(accountSince(USER, accountId, later + 60_000)).toBe(t0 + 60_000);
  // Reading never writes.
  const before = db().prepare("SELECT total_changes() n").get();
  accountSince(USER, accountId, later + 120_000);
  expect(db().prepare("SELECT total_changes() n").get()).toEqual(before);
});

it("lists what changed since then and this account's waiting changes, nobody else's", async () => {
  const { accountId, dealId, meetingId } = seedAccount({ name: "Synthetic Since", dealId: "SYN-SINCE-1" });
  const other = seedAccount({ name: "Synthetic Elsewhere", dealId: "SYN-ELSEWHERE-1" });
  await new Promise((r) => setTimeout(r, 5));
  const since = Date.now() - 1;
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { stage: 5 }, actorUserId: USER });
  createProposalBatch(accountId, { kind: "meeting", id: meetingId, aiRunId: null }, [{ entity_type: "action_item", op: "create", payload: { text: "Synthetic send it" }, rationale: "agreed" }]);
  createProposalBatch(other.accountId, { kind: "meeting", id: other.meetingId, aiRunId: null }, [{ entity_type: "action_item", op: "create", payload: { text: "Synthetic not ours" }, rationale: "agreed" }]);
  const s = sinceLooked(accountId, USER, since, []);
  expect(s.changes.map((c) => c.kind === "edit" && c.changes.map((f) => f.field))).toEqual([["stage"]]);
  expect(s.waiting.changes).toMatchObject({ accountId, total: 1, quick: 1 });
  expect(sinceLooked(accountId, USER, null, []).changes).toEqual([]);

  const { AccountSince } = await import("@/components/AccountSince");
  const doc = parseHTML(renderToStaticMarkup(AccountSince({ view: s, accountId, labels: {}, names: new Map(), now: Date.now() })!)).document;
  expect(doc.querySelector('[data-testid="since-waiting"]')?.textContent).toContain("1 change waiting");
  expect(doc.querySelector('[data-testid="inbox-accept-quick"]')).not.toBeNull();
  expect(doc.querySelector('[data-testid="since-changes"]')?.textContent).toContain("Stage 3 → 5");
});

it("watches each account at its own pace, and estimates the month from the paces", () => {
  const daily = seedAccount({ name: "Synthetic Daily", dealId: "SYN-DAILY-1" });
  const fortnight = seedAccount({ name: "Synthetic Fortnight", dealId: "SYN-FORT-1" });
  for (const w of watchedAccounts()) setWatched(w.id, false, USER);
  setWatched(daily.accountId, true, USER, 1);
  setWatched(fortnight.accountId, true, USER, 14);
  expect(watchPace(daily.accountId)).toBe(1);
  expect(watchPace(fortnight.accountId)).toBe(14);
  // Both looked at three days ago: only the daily one is due.
  const now = Date.now();
  const look = (accountId: string, at: number) =>
    db().prepare(`INSERT INTO ai_runs (id, account_id, kind, provider, model, status, created_by, started_at, assistant) VALUES (?, ?, 'research', 'fake', 'fake', 'done', ?, ?, 'account_watch')`).run(`look-${accountId}`, accountId, USER, at);
  look(daily.accountId, now - 3 * 86400_000);
  look(fortnight.accountId, now - 3 * 86400_000);
  expect(nextToWatch(now)?.id).toBe(daily.accountId);
  const est = watchEstimate([{ everyDays: 1 }, { everyDays: 14 }]);
  expect(est.looksPerMonth).toBe(Math.round(365 / 12 + 365 / 12 / 14));
  expect(() => setWatched(daily.accountId, true, USER, 2 as 1)).toThrow();
  setWatched(daily.accountId, false, USER);
  expect(watchPace(daily.accountId)).toBeNull();
});
