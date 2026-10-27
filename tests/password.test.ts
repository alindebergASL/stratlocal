// Thirty-four lines that decide whether a password check means anything, and
// nothing tested them. A typo here that made verifyPassword return true for
// everything would have failed no test and broken no screen.
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("hashing", () => {
  it("round-trips the right password and refuses the wrong one", () => {
    const stored = hashPassword("test-password-one");
    expect(verifyPassword("test-password-one", stored)).toBe(true);
    expect(verifyPassword("test-password-two", stored)).toBe(false);
    // A near miss is still a miss.
    expect(verifyPassword("test-password-onE", stored)).toBe(false);
    expect(verifyPassword("test-password-one ", stored)).toBe(false);
  });

  it("never stores the password, and never the same hash twice", () => {
    const a = hashPassword("test-password-one");
    const b = hashPassword("test-password-one");
    expect(a).not.toContain("test-password-one");
    // Different salts, so two people with the same password do not look the
    // same on disk and a stolen table cannot be attacked once for both.
    expect(a).not.toBe(b);
    expect(verifyPassword("test-password-one", b)).toBe(true);
  });

  it("refuses a password too short to be worth hashing", () => {
    expect(() => hashPassword("short")).toThrow(/at least 8/);
    expect(() => hashPassword("")).toThrow();
  });

  it("says no to anything that is not one of its own hashes", () => {
    // Every one of these is a shape that could arrive from a corrupted row, a
    // half-finished migration, or a different hashing scheme — and every one
    // of them has to be false rather than throwing, because the caller is a
    // login form.
    for (const stored of [
      "",
      "not-a-hash",
      "scrypt$N=32768$onlythreeparts",
      "bcrypt$N=32768$c2FsdA==$aGFzaA==",
      "scrypt$N=32768$!!!not-base64!!!$aGFzaA==",
      "scrypt$N=32768$c2FsdA==$aGFzaA==",
    ]) {
      expect(verifyPassword("test-password-one", stored)).toBe(false);
    }
    expect(verifyPassword("", hashPassword("test-password-one"))).toBe(false);
  });
});
