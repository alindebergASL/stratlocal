// Synthetic people only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { weekSummary } from "@/lib/queries/ourWork";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, display_name: "Synthetic Me", email: "me@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const ALEX = "user-alex";
const BLAIR = "user-blair";
const addUser = (id: string, name: string, at: number) =>
  db().prepare("INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,'unused',?,?,?)").run(id, `${id}@example.test`, name, at, at);

it("counts what each person did this week, me first, from history", async () => {
  addUser(USER, "Synthetic Me", 1);
  addUser(ALEX, "Synthetic Alex", 2);
  addUser(BLAIR, "Synthetic Blair", 3);
  const today = new Date().toISOString().slice(0, 10);
  const { accountId, dealId } = seedAccount({ heldAt: today });
  const item = applyEntityChange({ accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic follow-up", owner_user_id: ALEX }, actorUserId: USER }).entityId;
  applyEntityChange({ accountId, entityType: "action_item", op: "update", entityId: item, payload: { status: "done" }, actorUserId: USER });
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { stage: 5 }, actorUserId: ALEX });
  // Older than the week: not counted.
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { stage: 6 }, actorUserId: BLAIR });
  db().prepare("UPDATE change_log SET created_at = ? WHERE actor_user_id = ?").run(Date.now() - 9 * 86_400_000, BLAIR);

  const week = weekSummary(USER);
  expect(week.map((p) => p.userId)).toEqual([USER, ALEX, BLAIR]);
  expect(week[0]!.counts).toMatchObject({ followUpsClosed: 1 });
  expect(week[1]!.counts).toMatchObject({ dealsMoved: 1, followUpsClosed: 0 });
  expect(week[2]!.total).toBe(0);

  const { default: Home } = await import("@/app/page");
  const doc = parseHTML(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))).document;
  const rows = [...doc.querySelectorAll('[data-testid="week-person"]')].map((r) => r.textContent);
  expect(rows[0]).toContain("You");
  expect(rows[0]).toContain("1 follow-up closed");
  expect(rows[1]).toContain("Synthetic Alex1 deal moved");

  // The account leads with our work, over two weeks: Blair's older move
  // counts here though not on Today.
  const { default: Overview } = await import("@/app/accounts/[id]/page");
  const ov = parseHTML(renderToStaticMarkup(await Overview({ params: Promise.resolve({ id: accountId }) } as never))).document;
  const html = ov.toString();
  expect(html.indexOf('data-testid="our-work"')).toBeGreaterThan(-1);
  expect(html.indexOf('id="our-work"')).toBeLessThan(html.indexOf('id="people-glance"'));
  expect(html.indexOf('id="plan-glance"')).toBeLessThan(html.indexOf('id="top-deals"'));
  expect([...ov.querySelectorAll('[data-testid="our-work-person"]')].map((r) => r.textContent?.slice(0, 14))).toEqual(["You1 follow-up", "Synthetic Alex", "Synthetic Blai"]);
  expect(ov.querySelector('[data-testid="our-meetings"]')?.textContent).toContain("Last meeting:");
});
