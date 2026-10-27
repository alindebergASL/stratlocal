// Cookie sessions for two known users. No signup, no reset, no roles.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest, NextResponse } from "next/server";
import { db, type SessionRow, type UserRow } from "./db";
import { randomSessionId } from "./ids";
import { verifyPassword } from "./password";

export const SESSION_COOKIE = "strategy_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_FAILS_BEFORE_LOCK = 5;
const LOCKOUT_MIN_MS = 60 * 1000;
const LOCKOUT_MAX_MS = 15 * 60 * 1000;

export type PublicUser = { id: string; email: string; display_name: string };
export type TeamMember = PublicUser & { isAdmin: boolean; role: string | null; active: boolean };

export function publicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, display_name: row.display_name };
}

export function teamMember(row: UserRow): TeamMember {
  return { ...publicUser(row), isAdmin: !!row.is_admin, role: row.role ?? null, active: !row.deactivated_at };
}

export function findUserByEmail(email: string): UserRow | null {
  const row = db()
    .prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`)
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return row ?? null;
}

export function findUserById(id: string): UserRow | null {
  return (db().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined) ?? null;
}

// The people who can sign in: everyone a picker, a scope or an assistant
// should see. Someone who has left is only in `includeInactive`, which is for
// putting a name on what they did.
export function listUsers(opts: { includeInactive?: boolean } = {}): PublicUser[] {
  return (db().prepare(`SELECT * FROM users ${opts.includeInactive ? "" : "WHERE deactivated_at IS NULL"} ORDER BY created_at`).all() as UserRow[]).map(publicUser);
}

export function listTeam(): TeamMember[] {
  return (db().prepare(`SELECT * FROM users ORDER BY deactivated_at IS NOT NULL, created_at`).all() as UserRow[]).map(teamMember);
}

export type LoginResult =
  | { ok: true; user: PublicUser; sessionId: string }
  | { ok: false; status: 401 | 429; error: string; retryAfterSeconds?: number };

// Failed attempts per source, for the half the per-user lockout cannot see.
//
// The lockout lives on the users row and is only incremented `if (user)`, so
// guessing against an address that does not exist was never slowed at all —
// and with two seeded accounts, an attacker who knows one address is throttled
// while one who is enumerating is not. In memory rather than a table because
// it is worth nothing after a restart and a restart is not something an
// attacker can cause; the durable half is still the per-user lock.
const attemptsBySource = new Map<string, { failed: number; lockedUntil: number }>();

// Bounded, because the key is a header.
//
// The source is X-Forwarded-For, and the proxy is configured to overwrite it
// rather than append (deploy/Caddyfile) — but a Map keyed on anything that
// reaches the process from outside has to have a ceiling, or a rotating value
// is an out-of-memory on a box with two gigabytes. Insertion order is eviction
// order: the oldest bucket goes, which is the one that has been quiet longest,
// and the durable half of the lockout is still the users row.
const MAX_TRACKED_SOURCES = 5_000;

function rememberSource(source: string, state: { failed: number; lockedUntil: number }) {
  // Delete first so a re-set moves the key to the end of the insertion order,
  // otherwise an actively-failing source could be evicted before an idle one.
  attemptsBySource.delete(source);
  attemptsBySource.set(source, state);
  while (attemptsBySource.size > MAX_TRACKED_SOURCES) {
    const oldest = attemptsBySource.keys().next();
    if (oldest.done) break;
    attemptsBySource.delete(oldest.value);
  }
}

function sourceState(source: string) {
  return attemptsBySource.get(source) ?? { failed: 0, lockedUntil: 0 };
}

function lockoutFor(failed: number): number {
  if (failed < MAX_FAILS_BEFORE_LOCK) return 0;
  return Math.min(LOCKOUT_MAX_MS, LOCKOUT_MIN_MS * 2 ** (failed - MAX_FAILS_BEFORE_LOCK));
}

function tooManyFrom(source: string, nowMs: number): LoginResult | null {
  const state = sourceState(source);
  if (state.lockedUntil <= nowMs) return null;
  const retryAfterSeconds = Math.ceil((state.lockedUntil - nowMs) / 1000);
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    ok: false,
    status: 429,
    error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    retryAfterSeconds,
  };
}

// Visible to tests: the ceiling is invisible from every screen and would
// otherwise only be discovered by running out of memory.
export function trackedSourceCount(): number {
  return attemptsBySource.size;
}

// Visible to tests, and to a restart.
export function resetLoginAttempts() {
  attemptsBySource.clear();
}

export function login(email: string, password: string, source = "unknown"): LoginResult {
  const nowMs = Date.now();
  // Before the user lookup, so an unknown address costs the same as a known
  // one — both in time and in how many tries you get.
  const throttled = tooManyFrom(source, nowMs);
  if (throttled) return throttled;
  const user = findUserByEmail(email);
  if (user?.locked_until && user.locked_until > nowMs) {
    const retryAfterSeconds = Math.ceil((user.locked_until - nowMs) / 1000);
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    return {
      ok: false,
      status: 429,
      error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSeconds,
    };
  }
  // Someone who has left fails like a wrong password: the page does not say
  // which addresses belong to people who used to be here.
  if (!user || user.deactivated_at || !verifyPassword(password, user.password_hash)) {
    // Counted whether or not the address exists, which is the whole point.
    const state = sourceState(source);
    const failed = state.failed + 1;
    const wait = lockoutFor(failed);
    rememberSource(source, { failed, lockedUntil: wait > 0 ? nowMs + wait : 0 });
    if (user) {
      const userFailed = user.failed_login_count + 1;
      const userWait = lockoutFor(userFailed);
      db()
        .prepare(`UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?`)
        .run(userFailed, userWait > 0 ? nowMs + userWait : null, nowMs, user.id);
    }
    return { ok: false, status: 401, error: "Invalid email or password" };
  }
  attemptsBySource.delete(source);
  db()
    .prepare(`UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`)
    .run(nowMs, user.id);
  const session = createSession(user.id);
  return { ok: true, user: publicUser(user), sessionId: session.id };
}

export function createSession(userId: string): SessionRow {
  const id = randomSessionId();
  const created = Date.now();
  const expires = created + SESSION_TTL_MS;
  db()
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(id, userId, created, expires);
  return { id, user_id: userId, created_at: created, expires_at: expires };
}

export function deleteSession(sessionId: string) {
  db().prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

// Resolves a session id to its user, sliding the expiry when it is close.
export function resolveSession(sessionId: string | undefined): PublicUser | null {
  if (!sessionId) return null;
  const session = db().prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
  if (!session) return null;
  const nowMs = Date.now();
  if (session.expires_at < nowMs) {
    deleteSession(sessionId);
    return null;
  }
  const user = findUserById(session.user_id);
  if (!user || user.deactivated_at) {
    deleteSession(sessionId);
    return null;
  }
  if (session.expires_at - nowMs < SESSION_REFRESH_WINDOW_MS) {
    db().prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(nowMs + SESSION_TTL_MS, sessionId);
  }
  return publicUser(user);
}

// ---- server components -----------------------------------------------------

export async function currentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

// Pages call this first. Unauthenticated visitors land on /login.
export async function requirePageUser(): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

// ---- route handlers --------------------------------------------------------

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: { error: string },
  ) {
    super(body.error);
  }
}

export function requireUser(req: NextRequest): PublicUser {
  const user = resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) throw new HttpError(401, { error: "Authentication required" });
  return user;
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production" && process.env.STRATEGY_LOCAL_ONLY !== "1",
});

export function setSessionCookie(res: NextResponse, sessionId: string) {
  res.cookies.set(SESSION_COOKIE, sessionId, { ...cookieOptions(), maxAge: Math.floor(SESSION_TTL_MS / 1000) });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
