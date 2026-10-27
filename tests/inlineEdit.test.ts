// Synthetic data only.
import { expect, it, vi } from "vitest";
import { seedAccount, USER } from "./helpers";
import { getDeal } from "@/lib/queries/accounts";
import { applyEntityChange } from "@/lib/proposals/apply";
import { commandsFor } from "@/lib/commands/registry";
import { ALL_DESTINATIONS, PRIMARY } from "@/lib/nav/destinations";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, display_name: "Synthetic Me", email: "me@example.test" }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

it("edits one listed field in place, parsed like its form, and refuses the rest", async () => {
  const { updateField } = await import("@/app/actions");
  const { accountId, dealId } = seedAccount();
  const v0 = getDeal(dealId)!.updated_at;
  const money = await updateField(accountId, "deal", dealId, "tcv_usd", "1.2M", v0);
  expect(money).toMatchObject({ ok: true });
  expect(getDeal(dealId)!.tcv_usd).toBe(1_200_000);
  const v1 = (money as { version: number }).version;

  expect(await updateField(accountId, "deal", dealId, "close_date", "2027-02-30", v1)).toMatchObject({ ok: false, error: expect.stringContaining("real date") });
  expect(await updateField(accountId, "deal", dealId, "name", "   ", v1)).toMatchObject({ ok: false, error: "Name cannot be empty." });
  expect(await updateField(accountId, "deal", dealId, "stage", "9", v1)).toMatchObject({ ok: false });
  expect(await updateField(accountId, "deal", dealId, "deal_id", "SYN-X", v1)).toMatchObject({ ok: false, error: "That field cannot be edited here." });
  expect(await updateField(accountId, "deal", dealId, "account_id", "x", v1)).toMatchObject({ ok: false });
  // Clearing an optional field is allowed.
  expect(await updateField(accountId, "deal", dealId, "next_step", "", v1)).toMatchObject({ ok: true });
  expect(getDeal(dealId)!.next_step).toBeNull();
});

it("a partner's newer edit comes back as a conflict, not an overwrite", async () => {
  const { updateField } = await import("@/app/actions");
  const { accountId, dealId } = seedAccount();
  const seen = getDeal(dealId)!.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: dealId, payload: { close_date: "2027-05-01" }, actorUserId: "someone-else", baseVersion: seen });
  const r = await updateField(accountId, "deal", dealId, "close_date", "2027-06-01", seen);
  expect(r).toMatchObject({ ok: false, conflict: { changes: [expect.objectContaining({ field: "close_date" })] } });
  expect(getDeal(dealId)!.close_date).toBe("2027-05-01");
});

it("one list of places: five daily, the rest in More, and commands that fit the page", () => {
  expect(PRIMARY.map((d) => d.label)).toEqual(["Today", "Accounts", "Pipeline", "Inbox", "Ask"]);
  expect(new Set(ALL_DESTINATIONS.map((d) => d.href)).size).toBe(ALL_DESTINATIONS.length);
  expect(ALL_DESTINATIONS.map((d) => d.label)).toContain("What changed");
  const keys = ALL_DESTINATIONS.flatMap((d) => (d.key ? [d.key] : []));
  expect(new Set(keys).size).toBe(keys.length);
  expect(commandsFor("/pipeline").map((c) => c.id)).toEqual(["cmd-task", "cmd-account"]);
  expect(commandsFor("/accounts/abc/deals").find((c) => c.id === "cmd-research")?.href).toBe("/accounts/abc/research?again=1");
});
