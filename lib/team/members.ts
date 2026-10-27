// A team of any size. Admins add people, set roles and turn off the account
// of someone who has left; everyone can change their own password. There is
// always at least one admin who can sign in, so nobody can lock the team out.
import { db, type UserRow } from "../db";
import { newId } from "../ids";
import { hashPassword, verifyPassword } from "../password";
import { ApplyError } from "../proposals/apply";
import { findUserByEmail, findUserById } from "../auth";

export const MIN_PASSWORD = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireAdmin(byUserId: string): UserRow {
  const by = findUserById(byUserId);
  if (!by || by.deactivated_at || !by.is_admin) throw new ApplyError("Only an admin can change the team.", "state");
  return by;
}

const activeAdmins = () => (db().prepare(`SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND deactivated_at IS NULL`).get() as { n: number }).n;

export function addMember(input: { email: string; name: string; password: string; role: string | null; isAdmin: boolean }, byUserId: string): string {
  requireAdmin(byUserId);
  const email = input.email.trim().toLowerCase();
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!EMAIL.test(email)) throw new ApplyError("That is not an email address.", "validation");
  if (!name) throw new ApplyError("Give their name as the team will see it.", "validation");
  if (input.password.length < MIN_PASSWORD) throw new ApplyError(`The first password needs at least ${MIN_PASSWORD} characters.`, "validation");
  if (findUserByEmail(email)) throw new ApplyError("Someone with that email is already on the team.", "conflict");
  const id = newId();
  const now = Date.now();
  db()
    .prepare(`INSERT INTO users (id, email, password_hash, display_name, is_admin, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, email, hashPassword(input.password), name, input.isAdmin ? 1 : 0, input.role?.trim() || null, now, now);
  return id;
}

export function setMember(userId: string, patch: { role?: string | null; isAdmin?: boolean; name?: string }, byUserId: string) {
  requireAdmin(byUserId);
  const user = findUserById(userId);
  if (!user) throw new ApplyError("No such person.", "not_found");
  db().transaction(() => {
    if (patch.isAdmin === false && user.is_admin && !user.deactivated_at && activeAdmins() <= 1) throw new ApplyError("The team needs at least one admin.", "state");
    const name = patch.name?.replace(/\s+/g, " ").trim().slice(0, 80);
    db()
      .prepare(`UPDATE users SET role = ?, is_admin = ?, display_name = ?, updated_at = ? WHERE id = ?`)
      .run(patch.role === undefined ? (user.role ?? null) : patch.role?.trim() || null, patch.isAdmin === undefined ? (user.is_admin ?? 0) : patch.isAdmin ? 1 : 0, name || user.display_name, Date.now(), userId);
  })();
}

export function setActive(userId: string, active: boolean, byUserId: string) {
  requireAdmin(byUserId);
  if (userId === byUserId && !active) throw new ApplyError("You cannot turn off your own account; ask another admin.", "state");
  const user = findUserById(userId);
  if (!user) throw new ApplyError("No such person.", "not_found");
  db().transaction(() => {
    if (!active && user.is_admin && activeAdmins() <= 1) throw new ApplyError("The team needs at least one admin who can sign in.", "state");
    db().prepare(`UPDATE users SET deactivated_at = ?, updated_at = ? WHERE id = ?`).run(active ? null : Date.now(), Date.now(), userId);
    // Signed out everywhere at once.
    if (!active) db().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  })();
}

export function changeOwnPassword(userId: string, current: string, next: string) {
  const user = findUserById(userId);
  if (!user || !verifyPassword(current, user.password_hash)) throw new ApplyError("The current password is not right.", "validation");
  if (next.length < MIN_PASSWORD) throw new ApplyError(`The new password needs at least ${MIN_PASSWORD} characters.`, "validation");
  db().prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(hashPassword(next), Date.now(), userId);
}

/** "the two of you" for two people, "the team" for any other number. */
export function teamPhrase(count: number): { all: string; others: string } {
  return count === 2 ? { all: "the two of you", others: "your partner" } : { all: "the team", others: "your teammates" };
}
