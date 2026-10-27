// Proving you know the passphrase, without giving you a session.
//
// A handoff link works for whoever it is forwarded to, which is the one
// deliberate exposure in this app. A passphrase closes it: the link gets you
// to a box, the word gets you the snapshot.
//
// The awkward part is the second page view. Asking again on every reload would
// make the feature unusable on a phone, and the obvious fix — a cookie saying
// "unlocked" — is worthless if the holder of the link can forge it. So the
// cookie carries an HMAC whose *key is the stored passphrase hash*. That hash
// is in the database and nowhere else: not in the URL, not in the page, not
// derivable from the token. Someone holding the link cannot compute it, and
// re-sharing changes it, so every previously issued proof dies with the old
// link rather than outliving it.
//
// It is deliberately not a session. It names no user, reaches no other route,
// and grants exactly one document.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DocumentRow } from "../db";
import { verifyPassword } from "../password";

/** Does this link ask for a word before it opens? */
export function needsPassphrase(doc: DocumentRow): boolean {
  return Boolean(doc.share_passphrase_hash);
}

/**
 * The value that proves this browser answered the box, for this link.
 *
 * Bound to the token as well as the document, so a proof cannot be carried
 * from one address to another if the same handoff is ever re-shared.
 */
export function unlockProof(doc: DocumentRow): string {
  const key = doc.share_passphrase_hash ?? "";
  return createHmac("sha256", key).update(`${doc.id}:${doc.share_token ?? ""}`).digest("base64url");
}

export function proofMatches(doc: DocumentRow, given: string | undefined | null): boolean {
  if (!given) return false;
  const expected = Buffer.from(unlockProof(doc));
  const actual = Buffer.from(given);
  // Length first: timingSafeEqual throws on a mismatch rather than returning
  // false, and a thrown error on a public page is a 500 someone can trigger.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** The cookie name for one link. Scoped to its own path, so it is sent nowhere else. */
export function unlockCookieName(doc: DocumentRow): string {
  return `handoff_${doc.id}`;
}

// Wrong answers per link.
//
// Keyed on the document rather than on a header: an unknown token is already a
// 404 before anything here runs, so only real handoffs can make a bucket and
// the map is bounded by how many have ever been shared. The ceiling is here
// anyway, on the same reasoning as lib/auth.ts — a map fed from outside gets a
// ceiling whether or not today's key can be rotated.
const MAX_TRACKED_LINKS = 1_000;
const MAX_FAILS_BEFORE_LOCK = 5;
const LOCKOUT_MIN_MS = 30_000;
const LOCKOUT_MAX_MS = 15 * 60_000;

const attempts = new Map<string, { failed: number; lockedUntil: number }>();

function remember(id: string, state: { failed: number; lockedUntil: number }) {
  attempts.delete(id);
  attempts.set(id, state);
  while (attempts.size > MAX_TRACKED_LINKS) {
    const oldest = attempts.keys().next();
    if (oldest.done) break;
    attempts.delete(oldest.value);
  }
}

export type UnlockResult =
  | { ok: true; proof: string }
  | { ok: false; error: string; retryAfterSeconds?: number };

/**
 * One attempt at the box.
 *
 * The wrong word and a locked-out attempt say different things, because the
 * person at the box is usually the person it was sent to and "you have the
 * wrong word" is what they need to hear. Neither says anything about the
 * account, and neither is reachable without a live token in the first place.
 */
export function tryUnlock(doc: DocumentRow, phrase: string, now = Date.now()): UnlockResult {
  const state = attempts.get(doc.id) ?? { failed: 0, lockedUntil: 0 };
  if (state.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((state.lockedUntil - now) / 1000);
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    return { ok: false, error: `Too many tries. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`, retryAfterSeconds };
  }
  if (!doc.share_passphrase_hash || !verifyPassword(phrase, doc.share_passphrase_hash)) {
    const failed = state.failed + 1;
    const lockedUntil =
      failed < MAX_FAILS_BEFORE_LOCK ? 0 : now + Math.min(LOCKOUT_MAX_MS, LOCKOUT_MIN_MS * 2 ** (failed - MAX_FAILS_BEFORE_LOCK));
    remember(doc.id, { failed, lockedUntil });
    return { ok: false, error: "That is not the passphrase for this link." };
  }
  attempts.delete(doc.id);
  return { ok: true, proof: unlockProof(doc) };
}

/** Visible to tests: the ceiling is invisible from every screen. */
export function trackedLinkCount(): number {
  return attempts.size;
}

export function resetUnlockAttemptsForTests(): void {
  attempts.clear();
}
