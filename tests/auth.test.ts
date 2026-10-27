// Who gets in, and for how long.
//
// This is 155 lines standing between the internet and every customer name in
// the app, and it had no test at all — not by oversight so much as by
// construction: seedUsers only writes a user when USER1_EMAIL and
// USER1_PASSWORD are set, vitest never set them, so every test ran against a
// database with nobody in it. There was no subject to test against.
//
// The users are seeded here rather than in vitest.config.mts because hashing
// two passwords with scrypt costs more than most of these tests do, and every
// test in the suite would have paid it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDbForTests } from "@/lib/db";
import { createSession, deleteSession, findUserByEmail, listUsers, login, resetLoginAttempts, resolveSession, trackedSourceCount } from "@/lib/auth";

const EMAIL = "alex@test.local";
const PASSWORD = "test-password-one";
const DAY = 86_400_000;

beforeEach(() => {
  // Stubbed, not assigned. Vitest isolates module registries per file but
  // reuses worker processes, so plain assignment leaked these into every later
  // file in the same worker — where seedUsers would then scrypt-hash two
  // passwords on every reset and hand each test a database with two users it
  // did not ask for. Ordering-dependent, worker-count-dependent, and exactly
  // the flake tests/setup.ts exists to prevent.
  vi.stubEnv("USER1_EMAIL", EMAIL);
  vi.stubEnv("USER1_PASSWORD", PASSWORD);
  vi.stubEnv("USER1_NAME", "Alex");
  vi.stubEnv("USER2_EMAIL", "jamie@test.local");
  vi.stubEnv("USER2_PASSWORD", "test-password-two");
  vi.stubEnv("USER2_NAME", "Jamie");
  resetDbForTests();
  resetLoginAttempts();
  // Forces initDb, and with it the seed.
  listUsers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signing in", () => {
  it("lets the right password through and issues a session", () => {
    const r = login(EMAIL, PASSWORD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user.email).toBe(EMAIL);
    expect(r.user.display_name).toBe("Alex");
    // The session resolves to the same person, which is the only thing the
    // cookie is good for.
    expect(resolveSession(r.sessionId)?.id).toBe(r.user.id);
  });

  it("does not say which half was wrong", () => {
    const wrongPassword = login(EMAIL, "not-the-password");
    const noSuchUser = login("nobody@test.local", PASSWORD);
    expect(wrongPassword.ok).toBe(false);
    expect(noSuchUser.ok).toBe(false);
    // Identical, deliberately: a different message for an unknown address
    // tells anyone asking which addresses exist.
    expect(wrongPassword.ok === false && wrongPassword.error).toBe(noSuchUser.ok === false && noSuchUser.error);
  });

  it("is not case-sensitive about the address", () => {
    expect(login(EMAIL.toUpperCase(), PASSWORD).ok).toBe(true);
  });

  it("counts failures and eventually stops answering", () => {
    for (let i = 0; i < 4; i += 1) expect(login(EMAIL, "wrong").ok).toBe(false);
    expect(findUserByEmail(EMAIL)?.failed_login_count).toBe(4);
    // Still only a 401 at four: the lock is at five.
    expect(login(EMAIL, "wrong")).toMatchObject({ ok: false, status: 401 });

    const locked = login(EMAIL, PASSWORD);
    expect(locked).toMatchObject({ ok: false, status: 429 });
    // The right password does not get you in while it is locked, which is the
    // point — and it says how long rather than just refusing.
    expect(locked.ok === false && locked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("forgets the failures once you get in", () => {
    for (let i = 0; i < 3; i += 1) login(EMAIL, "wrong");
    expect(findUserByEmail(EMAIL)?.failed_login_count).toBe(3);
    expect(login(EMAIL, PASSWORD).ok).toBe(true);
    expect(findUserByEmail(EMAIL)?.failed_login_count).toBe(0);
    expect(findUserByEmail(EMAIL)?.locked_until).toBeNull();
  });
});

describe("sessions", () => {
  it("stops resolving once it has expired, and cleans itself up", () => {
    const session = createSession(findUserByEmail(EMAIL)!.id);
    db().prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(Date.now() - 1000, session.id);
    expect(resolveSession(session.id)).toBeNull();
    expect(db().prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(session.id)).toBeUndefined();
  });

  it("slides the expiry when it is close, so daily use never logs you out", () => {
    const session = createSession(findUserByEmail(EMAIL)!.id);
    const soon = Date.now() + 2 * DAY;
    db().prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(soon, session.id);
    expect(resolveSession(session.id)).not.toBeNull();
    const after = (db().prepare(`SELECT expires_at FROM sessions WHERE id = ?`).get(session.id) as { expires_at: number }).expires_at;
    expect(after).toBeGreaterThan(soon);
  });

  it("does not slide one that is nowhere near expiring", () => {
    const session = createSession(findUserByEmail(EMAIL)!.id);
    const before = (db().prepare(`SELECT expires_at FROM sessions WHERE id = ?`).get(session.id) as { expires_at: number }).expires_at;
    resolveSession(session.id);
    const after = (db().prepare(`SELECT expires_at FROM sessions WHERE id = ?`).get(session.id) as { expires_at: number }).expires_at;
    expect(after).toBe(before);
  });

  it("resolves nothing for a missing, unknown or signed-out session", () => {
    expect(resolveSession(undefined)).toBeNull();
    expect(resolveSession("not-a-session")).toBeNull();
    const session = createSession(findUserByEmail(EMAIL)!.id);
    deleteSession(session.id);
    expect(resolveSession(session.id)).toBeNull();
  });

  it("drops a session whose user is gone", () => {
    const user = findUserByEmail(EMAIL)!;
    const session = createSession(user.id);
    db().prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
    expect(resolveSession(session.id)).toBeNull();
    expect(db().prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(session.id)).toBeUndefined();
  });
});

describe("who is on file", () => {
  it("seeds the two of them, and never the password", () => {
    const users = listUsers();
    expect(users.map((u) => u.email).sort()).toEqual(["alex@test.local", "jamie@test.local"]);
    // publicUser is what reaches a page. A hash is not a secret worth
    // leaking either.
    for (const u of users) expect(Object.keys(u).sort()).toEqual(["display_name", "email", "id"]);
  });

  it("does not seed again over an existing user", () => {
    listUsers();
    expect(listUsers()).toHaveLength(2);
  });
});

describe("guessing at an address that does not exist", () => {
  beforeEach(() => resetLoginAttempts());

  it("is throttled too, which the per-user lockout could never do", () => {
    // The lockout lives on the users row and was only incremented when the
    // address matched one, so enumeration was completely unmetered: an
    // attacker who knew an address got five tries, one who did not got
    // infinite. Both are counted now, by source.
    for (let i = 0; i < 5; i += 1) {
      expect(login(`nobody${i}@test.local`, "guess", "10.0.0.9")).toMatchObject({ ok: false, status: 401 });
    }
    expect(login("nobody@test.local", "guess", "10.0.0.9")).toMatchObject({ ok: false, status: 429 });
    // Even with the right credentials, because the source is what is locked.
    expect(login(EMAIL, PASSWORD, "10.0.0.9")).toMatchObject({ ok: false, status: 429 });
  });

  it("does not punish anyone else for it", () => {
    for (let i = 0; i < 6; i += 1) login(`nobody${i}@test.local`, "guess", "10.0.0.9");
    expect(login(EMAIL, PASSWORD, "10.0.0.10").ok).toBe(true);
  });

  it("cannot be grown without limit by rotating the header", () => {
    // The source is X-Forwarded-For. The proxy overwrites it rather than
    // appending (deploy/Caddyfile), so it says who connected — but a Map keyed
    // on anything arriving from outside needs a ceiling regardless, or a
    // rotating value is an out-of-memory on a small box.
    for (let i = 0; i < 6_000; i += 1) login("nobody@test.local", "guess", `10.1.${(i >> 8) & 255}.${i & 255}`);
    expect(trackedSourceCount()).toBeLessThanOrEqual(5_000);
  });

  it("evicts the sources that went quiet, not the one still knocking", () => {
    // Insertion order is eviction order, so a bucket that keeps failing has to
    // move to the back each time it is written. Without that, the attacker's
    // own bucket is the one evicted and the lockout never lands.
    for (let i = 0; i < 5; i += 1) login("nobody@test.local", "guess", "10.9.9.9");
    expect(login("nobody@test.local", "guess", "10.9.9.9")).toMatchObject({ ok: false, status: 429 });
    for (let i = 0; i < 4_999; i += 1) login("nobody@test.local", "guess", `10.2.${(i >> 8) & 255}.${i & 255}`);
    // Still locked: the persistent one survived five thousand others.
    expect(login(EMAIL, PASSWORD, "10.9.9.9")).toMatchObject({ ok: false, status: 429 });
  });

  it("forgets a source once it gets in", () => {
    for (let i = 0; i < 3; i += 1) login(EMAIL, "wrong", "10.0.0.11");
    expect(login(EMAIL, PASSWORD, "10.0.0.11").ok).toBe(true);
    for (let i = 0; i < 4; i += 1) login("nobody@test.local", "guess", "10.0.0.11");
    // Four failures from a clean slate is still under the limit.
    expect(login("nobody@test.local", "guess", "10.0.0.11")).toMatchObject({ ok: false, status: 401 });
  });
});
