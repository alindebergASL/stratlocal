// Three synthetic people only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { personPage, teamRows } from "@/lib/queries/team";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, display_name: "Synthetic Me", email: "me@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const ALEX = "user-alex";
const BLAIR = "user-blair";
const addUser = (id: string, name: string, at: number) =>
  db().prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,'unused',?,?,?)").run(id, `${id}@example.test`, name, at, at);

it("each person's numbers, and a page for each", async () => {
  addUser(USER, "Synthetic Me", 1);
  addUser(ALEX, "Synthetic Alex", 2);
  addUser(BLAIR, "Synthetic Blair", 3);
  const now = new Date();
  const fq = currentFiscalQuarter(now).label;
  const mine = seedAccount({ name: "Synthetic Mine Co", dealId: "SYN-MINE-0001" });
  const alexs = seedAccount({ name: "Synthetic Alex Co", dealId: "SYN-ALEX-0001" });
  applyEntityChange({ accountId: mine.accountId, entityType: "account", op: "update", entityId: mine.accountId, payload: { owner_user_id: USER }, actorUserId: USER });
  applyEntityChange({ accountId: alexs.accountId, entityType: "account", op: "update", entityId: alexs.accountId, payload: { owner_user_id: ALEX }, actorUserId: USER });
  // Alex's deal closes this quarter with no next step; mine has one.
  applyEntityChange({ accountId: alexs.accountId, entityType: "deal", op: "update", entityId: alexs.dealId, payload: { fiscal_quarter: fq, next_step: null }, actorUserId: ALEX });
  applyEntityChange({ accountId: mine.accountId, entityType: "deal", op: "update", entityId: mine.dealId, payload: { fiscal_quarter: fq, next_step: "Synthetic call" }, actorUserId: USER });
  // An overdue follow-up Alex owes, and a deal I won.
  applyEntityChange({ accountId: alexs.accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic overdue", owner_user_id: ALEX, due: "2020-01-01" }, actorUserId: USER });
  applyEntityChange({ accountId: mine.accountId, entityType: "deal", op: "update", entityId: mine.dealId, payload: { status: "won" }, actorUserId: USER });

  const rows = new Map(teamRows(now).map((r) => [r.member.id, r]));
  expect(rows.get(USER)).toMatchObject({ accounts: 1, livePlays: 1, overdue: 0, bareThisQuarter: 0, openPipelineUsd: 0 });
  expect(rows.get(ALEX)).toMatchObject({ accounts: 1, livePlays: 1, overdue: 1, bareThisQuarter: 1, openPipelineUsd: 1000 });
  expect(rows.get(BLAIR)).toMatchObject({ accounts: 0, livePlays: 0, overdue: 0, bareThisQuarter: 0 });
  expect(rows.get(USER)!.week.dealsMoved).toBe(1);

  const me = personPage(USER, now)!;
  expect(me.wonThisMonth.map((w) => w.dealId)).toEqual(["SYN-MINE-0001"]);
  expect(me.plays.map((p) => p.accountName)).toEqual(["Synthetic Mine Co"]);
  expect(personPage("nobody", now)).toBeNull();

  const { default: Team } = await import("@/app/team/page");
  const team = parseHTML(renderToStaticMarkup(await Team())).document;
  const cards = [...team.querySelectorAll('[data-testid="team-person"]')];
  expect(cards[0]?.textContent).toContain("Synthetic Me (you)");
  // Then whoever needs a hand most.
  expect(cards[1]?.textContent).toContain("Synthetic Alex");
  expect(cards[1]?.querySelector('[data-testid="team-help"]')?.textContent).toBe(`1 overdue follow-up · 1 deal closing ${fq} with no next step`);

  const { default: Person } = await import("@/app/team/[userId]/page");
  const alex = parseHTML(renderToStaticMarkup(await Person({ params: Promise.resolve({ userId: ALEX }) }))).document;
  expect(alex.querySelector('[data-testid="person-follow-ups"]')?.textContent).toContain("Synthetic overdue");
  expect(alex.querySelector('[data-testid="person-accounts"]')?.textContent).toContain("Synthetic Alex Co");
  const mePage = parseHTML(renderToStaticMarkup(await Person({ params: Promise.resolve({ userId: USER }) }))).document;
  expect(mePage.querySelector('[data-testid="person-wins"]')?.textContent).toContain("Won");
});
