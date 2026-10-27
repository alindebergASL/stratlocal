// Synthetic users and records only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/close", useSearchParams: () => new URLSearchParams() }));

async function render() {
  // Close the day is a view of Today now (DECISIONS #105).
  const { default: Home } = await import("@/app/page");
  return parseHTML(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ view: "close" }) }))).document;
}
const headings = (d: Document) => [...d.querySelectorAll("h2")].map((h) => h.textContent);

it("on a day with nothing changed in the app, leads with tomorrow and loose ends and offers to catch the rest", async () => {
  const doc = await render();
  expect(headings(doc).slice(0, 3)).toEqual(["Tomorrow", "Loose ends", "From today"]);
  expect(doc.querySelector('[data-testid="close-quiet"]')?.textContent).toContain("which is normal on a day of calls");
  expect(doc.querySelector('[data-testid="close-quiet"] [data-testid="planning-capture"]')).not.toBeNull();
  expect(doc.toString()).not.toContain("Nothing you changed today");
});

it("on a day with work in the app, opens on what you did", async () => {
  const { accountId } = seedAccount();
  applyEntityChange({ accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic thing done today", status: "open" }, actorUserId: USER });
  const doc = await render();
  expect(headings(doc)[0]).toBe("What you did");
  expect(doc.querySelector('[data-testid="close-quiet"]')).toBeNull();
});
