// The neutral starter and synthetic install-base lines only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { applyEntityChange } from "@/lib/proposals/apply";
import { getAccount } from "@/lib/queries/accounts";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { dossier } from "@/lib/playbook/dossier";
import { playbookForAsk } from "@/lib/playbook/forAsk";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const line = (accountId: string, product_family: string, value_usd: number, as_of: string) =>
  applyEntityChange({ accountId, entityType: "install_base", op: "create", payload: { product_family, value_usd, as_of }, actorUserId: USER });

it("puts the installed base, research and budget next to the first step", async () => {
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const { accountId } = seedAccount();
  expect(dossier(getAccount(accountId)!, "2026-10-23")).toMatchObject({ installBase: { asOf: null, lines: 0 }, research: { kept: 0 }, budget: { fiscalStart: null } });

  line(accountId, "Synthetic Switching", 400000, "2026-04-01");
  line(accountId, "Synthetic Storage", 100000, "2026-04-01");
  line(accountId, "Synthetic Switching", 450000, "2026-10-01");
  line(accountId, "Synthetic Wireless", 50000, "2026-10-01");
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { fiscal_year_start_month: 7 }, actorUserId: USER });

  const d = dossier(getAccount(accountId)!, "2026-10-23");
  expect(d.installBase).toMatchObject({ asOf: "2026-10-01", previousAsOf: "2026-04-01", totalUsd: 500000, lines: 2 });
  expect(d.installBase.top.find((r) => r.family === "Synthetic Switching")?.changeUsd).toBe(50000);
  expect(d.installBase.top.find((r) => r.family === "Synthetic Storage")?.gone).toBe(true);
  expect(d.budget.fiscalStart).toBe("2027-07-01");

  const forAsk = playbookForAsk(getAccount(accountId)!, "2026-10-23") as { installed_base: { total_usd: number } };
  expect(forAsk.installed_base.total_usd).toBe(500000);

  const { default: Page } = await import("@/app/accounts/[id]/playbook/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: accountId }) }))).document;
  const block = doc.querySelector('[data-testid="playbook-dossier"]')!;
  expect(block.querySelector('[data-testid="dossier-install-base"]')?.textContent).toBe("$500K · 2 lines");
  expect(block.textContent).toContain("Synthetic Storage · not in the latest report (was $100K)");
  expect(block.textContent).toContain("Next fiscal year 2027-07-01");
});
