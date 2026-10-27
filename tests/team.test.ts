// Synthetic people only.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSession, listTeam, listUsers, login, resetLoginAttempts, resolveSession } from "@/lib/auth";
import { addMember, changeOwnPassword, setActive, setMember, teamPhrase } from "@/lib/team/members";
import { branding, deckStyle, saveBranding } from "@/lib/team/branding";

vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); }, redirect: () => { throw Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const ADMIN = "user-admin";
function seedAdmin() {
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at, updated_at) VALUES (?, 'lead@example.test', ?, 'Synthetic Lead', 1, 0, 0)").run(ADMIN, hashPassword("synthetic-pass-123"));
}

it("adds people of any number, with roles, and only an admin can", () => {
  seedAdmin();
  const se = addMember({ email: "Engineer@Example.test", name: "Synthetic Engineer", password: "synthetic-pass-456", role: "se", isAdmin: false }, ADMIN);
  const third = addMember({ email: "third@example.test", name: "Synthetic Third", password: "synthetic-pass-789", role: "partner", isAdmin: false }, ADMIN);
  expect(listUsers().map((u) => u.display_name)).toEqual(["Synthetic Lead", "Synthetic Engineer", "Synthetic Third"]);
  expect(listTeam().find((m) => m.id === se)).toMatchObject({ email: "engineer@example.test", role: "se", isAdmin: false, active: true });
  expect(() => addMember({ email: "x@example.test", name: "X", password: "synthetic-pass-000", role: null, isAdmin: false }, se)).toThrow(/Only an admin/);
  expect(() => addMember({ email: "engineer@example.test", name: "Again", password: "synthetic-pass-000", role: null, isAdmin: false }, ADMIN)).toThrow(/already on the team/);
  expect(() => addMember({ email: "short@example.test", name: "Short", password: "short", role: null, isAdmin: false }, ADMIN)).toThrow(/at least 12/);
  setMember(third, { role: "manager", isAdmin: true }, ADMIN);
  expect(listTeam().find((m) => m.id === third)).toMatchObject({ role: "manager", isAdmin: true });
  expect(teamPhrase(3).all).toBe("the team");
  expect(teamPhrase(2).all).toBe("the two of you");
});

it("turns off someone who has left: signed out, cannot sign in, name kept for history", () => {
  seedAdmin();
  resetLoginAttempts();
  const leaver = addMember({ email: "leaver@example.test", name: "Synthetic Leaver", password: "synthetic-pass-456", role: null, isAdmin: false }, ADMIN);
  const session = createSession(leaver);
  expect(login("leaver@example.test", "synthetic-pass-456").ok).toBe(true);
  expect(() => setActive(ADMIN, false, ADMIN)).toThrow(/your own account/);
  setActive(leaver, false, ADMIN);
  expect(resolveSession(session.id)).toBeNull();
  expect(login("leaver@example.test", "synthetic-pass-456")).toMatchObject({ ok: false, status: 401, error: "Invalid email or password" });
  expect(listUsers().some((u) => u.id === leaver)).toBe(false);
  expect(listUsers({ includeInactive: true }).find((u) => u.id === leaver)?.display_name).toBe("Synthetic Leaver");
  setActive(leaver, true, ADMIN);
  expect(login("leaver@example.test", "synthetic-pass-456").ok).toBe(true);
});

it("never leaves the team without an admin who can sign in", () => {
  seedAdmin();
  const other = addMember({ email: "other@example.test", name: "Synthetic Other", password: "synthetic-pass-456", role: null, isAdmin: true }, ADMIN);
  setMember(ADMIN, { isAdmin: false }, other);
  expect(() => setMember(other, { isAdmin: false }, other)).toThrow(/at least one admin/);
  expect(() => setActive(other, false, ADMIN)).toThrow(/Only an admin/);
});

it("changes your own password only with the current one", () => {
  seedAdmin();
  resetLoginAttempts();
  expect(() => changeOwnPassword(ADMIN, "wrong", "synthetic-new-pass-1")).toThrow(/current password/);
  changeOwnPassword(ADMIN, "synthetic-pass-123", "synthetic-new-pass-1");
  expect(login("lead@example.test", "synthetic-new-pass-1").ok).toBe(true);
});

it("names the app for the team, on the header and on decks", async () => {
  seedAdmin();
  expect(branding()).toMatchObject({ appName: "Strategy", teamName: null, logo: null });
  saveBranding({ appName: "Synthetic Desk", teamName: "Synthetic West Team", accent: "#1a2b3c", logo: "data:image/png;base64,iVBORw0KGgo=" }, ADMIN);
  expect(branding()).toMatchObject({ appName: "Synthetic Desk", accent: "1A2B3C" });
  expect(deckStyle()).toMatchObject({ accent: "1A2B3C", footer: "Synthetic West Team" });
  expect(() => saveBranding({ logo: "data:text/html;base64,PGgxPg==" }, ADMIN)).toThrow();
  expect(() => saveBranding({ accent: "red" }, ADMIN)).toThrow();
  const { Nav } = await import("@/components/Nav");
  const doc = parseHTML(renderToStaticMarkup(Nav({ user: { id: ADMIN, email: "lead@example.test", display_name: "Synthetic Lead" } }))).document;
  expect(doc.querySelector('[data-testid="brand-name"]')?.textContent).toBe("Synthetic Desk");
  expect(doc.querySelector('[data-testid="brand-logo"]')?.getAttribute("src")).toMatch(/^data:image\/png/);
});
