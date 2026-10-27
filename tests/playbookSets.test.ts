// The neutral starter and synthetic accounts only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { createPlaybook, currentPlaybook, defaultSlug, listPlaybooks, playbookHistory, restorePlaybook, savePlaybook, setDefaultPlaybook } from "@/lib/playbook/store";
import { getTemplate } from "@/lib/ask/templates";
import { exportPack, applyPack } from "@/lib/team/pack";
import { hashPassword } from "@/lib/password";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

it("keeps several playbooks, each with its own history, and an account uses its own", async () => {
  const first = savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  expect(first.slug).toBe("default");
  const second = createPlaybook({ name: "Synthetic Commercial", from: { ...STARTER_PLAYBOOK, steps: STARTER_PLAYBOOK.steps!.slice(0, 3) }, userId: USER });
  expect(second.slug).toBe("synthetic-commercial");
  expect(() => createPlaybook({ name: "synthetic commercial", from: STARTER_PLAYBOOK, userId: USER })).toThrow(/already a playbook/);
  expect(listPlaybooks().map((p) => [p.name, p.isDefault])).toEqual([["AI outcome starter", true], ["Synthetic Commercial", false]]);

  // Saving against a version saves into that version's playbook.
  const edited = savePlaybook({ playbook: { ...second.playbook, summary: "Synthetic summary." }, userId: USER, basisId: second.id });
  expect(edited.slug).toBe("synthetic-commercial");
  expect(playbookHistory(5, "synthetic-commercial")).toHaveLength(2);
  expect(playbookHistory(5)).toHaveLength(1);
  expect(restorePlaybook(second.id, USER, edited.id).slug).toBe("synthetic-commercial");

  const { accountId: a } = seedAccount({ name: "Synthetic A", dealId: "SYN-A" });
  const { accountId: b } = seedAccount({ name: "Synthetic B", dealId: "SYN-B" });
  const { setAccountPlaybookAction } = await import("@/app/accounts/[id]/playbook/actions");
  const fd = new FormData();
  fd.set("playbook_slug", "synthetic-commercial");
  expect(await setAccountPlaybookAction(b, fd)).toEqual({ ok: true });
  expect(currentPlaybook({ accountId: a })?.slug).toBe("default");
  expect(currentPlaybook({ accountId: b })?.playbook.steps).toHaveLength(3);
  expect(getTemplate("playbook_intelligence_brief", b)).not.toBeNull();

  const { default: Page } = await import("@/app/accounts/[id]/playbook/page");
  const doc = parseHTML(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: b }) }))).document;
  expect(doc.querySelector('[data-testid="account-playbook-name"]')?.textContent).toBe("Synthetic Commercial");
  expect(doc.querySelectorAll('[data-testid="playbook-step"]')).toHaveLength(3);

  // Choosing the default stores null, so a new default carries the account with it.
  setDefaultPlaybook("synthetic-commercial", USER);
  expect(defaultSlug()).toBe("synthetic-commercial");
  expect(currentPlaybook({ accountId: a })?.slug).toBe("synthetic-commercial");
  fd.set("playbook_slug", "synthetic-commercial");
  await setAccountPlaybookAction(b, fd);
  expect((db().prepare("SELECT playbook_slug FROM accounts WHERE id = ?").get(b) as { playbook_slug: string | null }).playbook_slug).toBeNull();
});

it("moves every playbook in a team pack, adding others by name", () => {
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at, updated_at) VALUES (?, 'a@example.test', ?, 'Synthetic', 1, 0, 0)").run(USER, hashPassword("synthetic-pass-123"));
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  createPlaybook({ name: "Synthetic Commercial", from: STARTER_PLAYBOOK, userId: USER });
  const text = JSON.stringify(exportPack());
  expect(JSON.parse(text).others.map((o: { name: string }) => o.name)).toEqual(["Synthetic Commercial"]);
  db().exec("DELETE FROM playbooks");
  expect(applyPack(text, USER).applied.slice(0, 2)).toEqual(["playbook", "1 other playbook"]);
  expect(listPlaybooks().map((p) => p.name)).toEqual(["AI outcome starter", "Synthetic Commercial"]);
  expect(applyPack(text, USER).applied).not.toContain("1 other playbook");
});
