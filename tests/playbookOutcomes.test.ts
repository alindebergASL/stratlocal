// The neutral starter and synthetic closed deals only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { applyEntityChange } from "@/lib/proposals/apply";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { Playbook } from "@/lib/playbook/schema";
import { moveToStep } from "@/lib/playbook/lifecycle";
import { playbookOutcomes } from "@/lib/playbook/outcomes";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const playbook = Playbook.parse(STARTER_PLAYBOOK);
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

function account(name: string, archetype: string | null, setOn: string) {
  const { accountId, dealId } = seedAccount({ name, dealId: `SYN-${name}` });
  if (archetype) {
    applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: archetype }, actorUserId: USER });
    db().prepare(`UPDATE change_log SET created_at = ? WHERE entity_id = ? AND field = 'archetype_id'`).run(at(setOn), accountId);
  }
  return { accountId, dealId };
}
function close(accountId: string, dealId: string, status: "won" | "lost", day: string, usd: number, createdOn = "2026-03-01") {
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { status, close_date: day, tcv_usd: usd }, actorUserId: USER });
  db().prepare(`UPDATE deals SET created_at = ? WHERE deal_id = ?`).run(at(createdOn), dealId);
}

it("groups closed deals by the archetype the account had when each closed", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const a = account("A", "builder", "2026-01-10");
  close(a.accountId, a.dealId, "won", "2026-06-30", 100000);
  moveToStep(a.accountId, playbook, "readout", USER, at("2026-05-01"));
  const b = account("B", "builder", "2026-01-10");
  close(b.accountId, b.dealId, "lost", "2026-07-15", 40000);
  // Classified as exploring only after its deal closed: it counts as not
  // classified then, not as exploring.
  const c = account("C", "exploring", "2026-09-01");
  close(c.accountId, c.dealId, "won", "2026-08-01", 20000);
  // Older than a year: left out.
  const d = account("D", "builder", "2024-01-10");
  close(d.accountId, d.dealId, "won", "2025-06-01", 5000);

  const rows = playbookOutcomes(playbook, null, "2026-10-23");
  expect(rows.map((r) => [r.name, r.won, r.lost])).toEqual([["Building their own", 1, 1], ["Not classified when it closed", 1, 0]]);
  const builder = rows[0]!;
  expect(builder).toMatchObject({ wonUsd: 100000, lostUsd: 40000, winRate: null, typicalStep: "Outcome readout" });
  expect(builder.medianCycleDays).toBe(121);

  const { default: Page } = await import("@/app/settings/playbook/page");
  const doc = parseHTML(renderToStaticMarkup(await Page())).document;
  expect(doc.querySelector('[data-testid="playbook-outcome"][data-archetype="builder"]')?.textContent).toContain("Building their own");
});

it("shows a rate only from five closed deals", () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  for (const [i, s] of (["won", "won", "won", "lost", "lost"] as const).entries()) {
    const x = account(`E${i}`, "scaling", "2026-01-01");
    close(x.accountId, x.dealId, s, "2026-09-01", 1000);
  }
  expect(playbookOutcomes(playbook, null, "2026-10-23")[0]).toMatchObject({ name: "Scaling", won: 3, lost: 2, winRate: 60 });
});
