import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { USER } from "./helpers";
import { layoutFixture, LONG_TITLE, FULL_SUMMARY, ORIGINAL_NOTES } from "./layoutFixtures";
import { ResearchUpdates } from "@/app/accounts/[id]/research/ResearchUpdates";
import { db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
async function account(id: string) {
  const { default: Page } = await import("@/app/accounts/[id]/page");
  return parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }))).document;
}
async function tab(name: "meetings" | "plays", id: string) {
  const { default: Page } = name === "meetings" ? await import("@/app/accounts/[id]/meetings/page") : await import("@/app/accounts/[id]/plays/page");
  return parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }))).document;
}
it("keeps empty work anchors, counts and add controls, and each record kind on its own tab", async () => {
  const f = layoutFixture(USER);
  const empty = await account(f.emptyId);
  expect(empty.querySelector("#follow-ups h2")?.textContent).toBe("Follow-ups");
  expect(empty.querySelector("#follow-ups")?.textContent).toContain("No open follow-ups.");
  expect(empty.querySelector(`#follow-ups a[href="/accounts/${f.emptyId}/follow-ups"]`)?.textContent).toBe("Add →");
  const emptyMeetings = await tab("meetings", f.emptyId);
  expect(emptyMeetings.querySelector("#meetings h2")?.textContent).toBe("Meetings");
  expect(emptyMeetings.querySelector("#meetings button")).not.toBeNull();

  const rich = await account(f.accountId);
  expect(rich.querySelector("#follow-ups")?.textContent).toContain("Keep the nonempty follow-up visible");
  // The Overview, in reading order: what needs you, then our work and our
  // plan, then the deals, the day's work, and their side beside the research.
  const landmarks = [...rich.querySelectorAll("#needs-you, #our-work, #top-deals, #plan-glance, #follow-ups, #people-glance, #research")].map((el) => el.id);
  expect(landmarks).toEqual(["needs-you", "our-work", "plan-glance", "top-deals", "follow-ups", "people-glance", "research"]);
  // A drafted plan is a link to review, never rendered inline.
  expect(rich.querySelector('[data-testid="proposal-row"]')).toBeNull();
  expect(rich.querySelector('[data-testid="plan-draft-link"]')?.getAttribute("href")).toBe(`/inbox?kind=changes&account=${f.accountId}`);

  const plan = await tab("plays", f.accountId);
  expect(plan.querySelectorAll('[data-testid="play-scan-row"]')).toHaveLength(6);
  expect(plan.querySelector("#plan")?.textContent).toContain("Keep the complete account thesis in view.");
  expect(plan.querySelector('[data-testid="proposal-row"]')).toBeNull();
  expect(plan.querySelector('[data-testid="plan-draft-waiting"] a')?.getAttribute("href")).toBe(`/inbox?kind=changes&account=${f.accountId}`);

  const meetings = await tab("meetings", f.accountId);
  const row = meetings.querySelector('[data-testid="account-meeting-row"]')!;
  expect(row.querySelector('[data-testid="meeting-row-title"]')?.textContent).toBe(LONG_TITLE);
  expect(row.textContent).toMatch(/brief.*notes.*summary.*Archive/);
  expect(row.querySelector("a button")).toBeNull();
});
it("suggests pending review with notes first, preserves complete notes and discloses the full summary", async () => {
  const f = layoutFixture(USER);
  const { default: Page } = await import("@/app/accounts/[id]/meetings/[mid]/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: f.accountId, mid: f.meetingId }) }))).document;
  expect(doc.querySelector('[data-testid="meeting-workspace"]')?.firstElementChild?.id).toBe("notes");
  expect(doc.querySelector('textarea[name="raw_notes"]')?.textContent).toBe(ORIGINAL_NOTES);
  expect(doc.querySelector('summary textarea')).toBeNull();
  expect(doc.querySelector('#meeting-summary')?.hasAttribute("open")).toBe(false);
  expect(doc.querySelector('#meeting-summary p')?.textContent).toBe(FULL_SUMMARY);
  expect(doc.querySelector('[data-testid="meeting-nav"] a[href="#review"]')?.textContent).toBe("Review (1 pending)");
  expect(doc.querySelector('#review [data-testid="change-deck"]')).not.toBeNull();
  expect(doc.querySelectorAll('#notes')).toHaveLength(1);
});
it("puts draft review before generation while a truly empty research page starts with its form", async () => {
  const f = layoutFixture(USER);
  const { default: Page } = await import("@/app/accounts/[id]/research/page");
  for (const [id, first] of [[f.accountId, "research-review"], [f.emptyId, "research-run"]]) {
    const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: id! }), searchParams: Promise.resolve({}) }))).document;
    expect(doc.querySelector('section[id^="research-"]')?.id).toBe(first);
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    // Every in-page link in the briefing lands on a section that exists.
    for (const a of doc.querySelectorAll('[data-testid="research-briefing"] a[href^="#"]')) expect(doc.querySelector(a.getAttribute("href")!)).not.toBeNull();
  }
});
it("puts the actual pending research review before setup and last-run history", () => {
  const html = renderToStaticMarkup(createElement(ResearchUpdates, { accountId: "synthetic", included: 1, total: 1, pending: 2 }));
  expect(html.indexOf('data-testid="research-updates-review"')).toBeLessThan(html.indexOf('data-testid="research-updates-what"'));
  expect(html).toContain("Review 2 pending suggestions");
  expect(renderToStaticMarkup(createElement(ResearchUpdates, { accountId: "synthetic", included: 1, total: 1, pending: 0 }))).not.toContain('data-testid="research-updates-review"');
});
it("keeps Today to the work, gives the accounts their own page, and keeps quiet wording scoped", async () => {
  const f = layoutFixture(USER);
  // Leave only the quiet account in Home's active scope, with a research draft.
  db().prepare("UPDATE accounts SET archived_at='2026-09-22' WHERE id=?").run(f.accountId);
  db().prepare("UPDATE documents SET account_id=? WHERE id=?").run(f.emptyId, f.noteId);
  applyEntityChange({ accountId: f.emptyId, entityType: "account", entityId: f.emptyId, op: "update", payload: { region: "Synthetic region" }, actorUserId: USER });
  const { default: Home } = await import("@/app/page");
  const doc = parseHTML(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))).document;
  const headings = [...doc.querySelectorAll("h2")].map(h => h.textContent);
  // The account table and the activity feed moved to /accounts and /activity.
  expect(headings).not.toContain("Accounts");
  expect(headings).not.toContain("Recent activity");
  expect(doc.querySelector('[data-testid="home-quiet"]')?.textContent).toContain("in this account scope");
  // A research draft is waiting, so "nothing to review" would be false.
  expect(doc.querySelector("main")?.textContent).not.toContain("nothing to review");
  expect(headings).not.toContain("Clear");
  const name = (db().prepare("SELECT name FROM accounts WHERE id=?").get(f.emptyId) as { name: string }).name;
  const { default: Accounts } = await import("@/app/accounts/page");
  const list = parseHTML(renderToStaticMarkup(await Accounts({ searchParams: Promise.resolve({}) }))).document;
  expect(list.querySelector('[data-testid="accounts-list"]')?.textContent).toContain(name);
  expect(list.querySelector('[data-testid="account-new-open"]')).not.toBeNull();
});

it("keeps sensible defaults without a saved brief", async () => {
  const f = layoutFixture(USER);
  const { default: Page } = await import("@/app/accounts/[id]/meetings/[mid]/page");
  db().prepare("UPDATE proposals SET status='rejected' WHERE account_id=?").run(f.accountId);
  for (const [date, first] of [["2020-01-01", "notes"], ["2099-01-01", "brief"]]) {
    db().prepare("UPDATE meetings SET brief_json=NULL, held_at=? WHERE id=?").run(date!, f.meetingId);
    const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: f.accountId, mid: f.meetingId }) }))).document;
    expect(doc.querySelector('[data-testid="meeting-workspace"]')?.firstElementChild?.id).toBe(first);
    expect(doc.querySelectorAll('textarea[name="raw_notes"]')).toHaveLength(1);
  }
});
