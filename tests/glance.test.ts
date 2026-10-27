import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { db } from "@/lib/db";
import { homeHref, nextAccountMeeting, parseHomeView } from "@/lib/glance";
import { USER } from "./helpers";
import { glanceFixture } from "./glanceFixtures";
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
async function home(query: { who?: string | string[]; view?: string | string[] } = {}) {
  const { default: Home } = await import("@/app/page");
  return parseHTML(renderToStaticMarkup(await Home({ searchParams: Promise.resolve(query) }))).document;
}
it("keeps quiet overview compact while explicit empty work views remain reachable", async () => {
  const { applyEntityChange } = await import("@/lib/proposals/apply");
  applyEntityChange({ accountId: "", entityType: "account", op: "create", payload: { name: "Synthetic quiet account", owner_user_id: USER }, actorUserId: USER });
  const quiet = await home({ who: "mine" });
  expect(quiet.querySelector('[data-testid="home-quiet"]')).not.toBeNull();
  expect(quiet.querySelector('[data-testid="agenda-primary"]')?.textContent).toContain("Nothing queued in this account scope");
  expect(quiet.querySelector('a[href="/accounts#new-account"]')).not.toBeNull();
  const empty = await home({ who: "mine", view: "review" });
  expect(empty.querySelector('[data-testid="glance-list"]')).not.toBeNull();
  expect(empty.querySelector('[data-testid="glance-list"]')?.textContent).toContain("Nothing in this view");
});
it("parses only exact single view parameters and round-trips every owner scope", () => {
  for (const raw of [undefined, "", "ALL", "review,notes", ["review"], ["review", "notes"]]) expect(parseHomeView(raw)).toBeNull();
  for (const who of ["all", "mine", "theirs", "shared"] as const) for (const view of ["upcoming", "notes", "review", "overdue", "due-today", "next-steps"] as const) {
    const u = new URL(homeHref(who, view), "https://example.test");
    expect(parseHomeView(u.searchParams.get("view")!)).toBe(view);
    expect(u.searchParams.get("who") ?? "all").toBe(who);
  }
});
it("uses the existing cutoff, including the in-progress hour, midnight and unknown times without mutating rows", () => {
  const rows = [{ id: "past", held_at: "2026-09-15", held_time: "09:00" }, { id: "now", held_at: "2026-09-15", held_time: "11:30" }, { id: "later", held_at: "2026-09-15", held_time: "16:00" }, { id: "unknown", held_at: "2026-09-15", held_time: null }];
  const before = JSON.stringify(rows);
  expect(nextAccountMeeting(rows, new Date("2026-09-15T19:00:00Z"))).toMatchObject({ id: "now", inProgress: true });
  expect(nextAccountMeeting(rows, new Date("2026-09-15T19:30:00Z"))).toMatchObject({ id: "later", inProgress: false });
  expect(nextAccountMeeting([rows[0]!], new Date("2026-09-15T19:00:00Z"))).toBeNull();
  expect(nextAccountMeeting([{ id: "midnight", held_at: "2026-09-16", held_time: "00:15" }], new Date("2026-09-16T07:30:00Z"))).toMatchObject({ id: "midnight", inProgress: true });
  expect(JSON.stringify(rows)).toBe(before);
});
it("bounds the actual Home render, names units, scopes overflow, and performs no writes", async () => {
  const f = glanceFixture(USER);
  const before = db().prepare("SELECT total_changes() n").get();
  const doc = await home({ who: "mine" });
  expect(doc.querySelectorAll('[data-testid="home-meeting-row"]')).toHaveLength(1);
  // At most five things, picked by a rule the page prints; the rest are counts.
  const picked = doc.querySelectorAll('[data-testid="today-item"]').length;
  expect(picked).toBeGreaterThan(0);
  expect(picked).toBeLessThanOrEqual(5);
  expect(doc.querySelector('[data-testid="today-list"]')?.textContent).toContain("How these were picked");
  expect(doc.querySelector('[data-testid="today-glance"]')?.textContent).toContain("8 changes across 4 accounts to review");
  expect(doc.querySelector('[data-testid="today-glance"]')?.textContent).toContain("3 follow-ups past due · 1 play past due");
  expect(doc.querySelector('[data-testid="today-glance"]')?.textContent).toContain("8 meetings missing notes");
  expect(doc.querySelector('[data-testid="today-glance"]')?.textContent).not.toContain("Synthetic shared review");
  for (const view of ["upcoming", "notes", "review", "overdue", "next-steps"] as const) {
    expect(doc.querySelector(`[data-testid="glance-all-${view}"]`)?.getAttribute("href")).toBe(homeHref("mine", view));
    const all = await home({ who: "mine", view });
    const list = all.querySelector('[data-testid="glance-list"]')!;
    expect(list.querySelectorAll("li")).toHaveLength({ upcoming: 12, notes: 8, review: 4, overdue: 4, "next-steps": 2 }[view]);
    expect(list.querySelector("a")?.getAttribute("href")).toBe("/?who=mine");
    expect(all.querySelector('[data-testid="today-glance"]')).toBeNull();
  }
  const shared = await home({ who: "shared", view: "review" });
  expect(shared.querySelector('[data-testid="glance-list"]')?.textContent).toContain("1 change across 1 account to review");
  expect(shared.querySelector(`a[href="/inbox?kind=changes&account=${f.accountId}"]`)).toBeNull();
  expect(db().prepare("SELECT total_changes() n").get()).toEqual(before);
});
