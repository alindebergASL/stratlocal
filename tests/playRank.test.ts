// Synthetic plays only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { listPlays } from "@/lib/queries/accounts";
import { movePlay, rankedPlays } from "@/lib/plays/rank";
import { runPlanLook } from "@/lib/assistants/planKeeper";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const play = (accountId: string, title: string, status = "active") =>
  applyEntityChange({ accountId, entityType: "play", op: "create", payload: { title, status }, actorUserId: USER }).entityId;

it("the plays table takes the new statuses after its rebuild, with its rows and columns intact", () => {
  const cols = (db().prepare("PRAGMA table_info(plays)").all() as Array<{ name: string }>).map((c) => c.name);
  expect(cols).toEqual(expect.arrayContaining(["merged_into", "phase", "archived_at", "sort_order"]));
  const { accountId } = seedAccount();
  const id = play(accountId, "Synthetic info play", "info_only");
  expect(listPlays(accountId).find((p) => p.id === id)?.status).toBe("info_only");
  expect(() => db().prepare("UPDATE plays SET status = 'nonsense' WHERE id = ?").run(id)).toThrow(/CHECK/);
});

it("ranks live plays as the team orders them, and keeps the rest below", async () => {
  const { accountId, playId: seeded } = seedAccount();
  const a = play(accountId, "Synthetic A");
  const b = play(accountId, "Synthetic B");
  const info = play(accountId, "Synthetic background", "info_only");
  const na = play(accountId, "Synthetic not ours", "not_applicable");
  expect(rankedPlays(listPlays(accountId)).map((p) => p.id)).toEqual([seeded, a, b, info, na]);
  movePlay(accountId, b, -1, USER);
  movePlay(accountId, b, -1, USER);
  expect(rankedPlays(listPlays(accountId)).map((p) => p.id)).toEqual([b, seeded, a, info, na]);
  expect(listPlays(accountId).find((p) => p.id === b)?.sort_order).toBe(1);
  const history = db().prepare("SELECT COUNT(*) AS n FROM change_log WHERE field = 'sort_order'").get() as { n: number };
  expect(history.n).toBeGreaterThan(0);

  const { default: Page } = await import("@/app/accounts/[id]/plays/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId }) }))).document;
  expect([...doc.querySelectorAll('[data-testid="play-scan-list"] [data-testid="play-rank"]')].map((n) => n.textContent)).toEqual(["#1", "#2", "#3"]);
  expect(doc.querySelector('[data-testid="play-section-info"]')?.textContent).toContain("Synthetic background");
  expect(doc.querySelector('[data-testid="play-section-closed"]')?.textContent).toContain("not applicable");

  const { default: Overview } = await import("@/app/accounts/[id]/page");
  const ov = parseHTML(renderToStaticMarkup(await Overview({ params: Promise.resolve({ id: accountId }), searchParams: Promise.resolve({}) } as never))).document;
  expect(ov.querySelector('[data-testid="play-top"]')?.parentElement?.textContent).toContain("Synthetic B");
});

it("Plan keeper does not ask about information-only or not-applicable plays", () => {
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, 'u@example.test', 'x', 'Synthetic', 0, 0)").run(USER);
  const { accountId, playId } = seedAccount();
  applyEntityChange({ accountId, entityType: "play", op: "update", entityId: playId, payload: { next_step: null }, actorUserId: USER });
  const before = runPlanLook("manual", USER);
  expect(before.added).toBeGreaterThan(0);
  db().exec("DELETE FROM assistant_notices");
  applyEntityChange({ accountId, entityType: "play", op: "update", entityId: playId, payload: { status: "info_only" }, actorUserId: USER });
  expect(runPlanLook("manual", USER).added).toBe(0);
});
