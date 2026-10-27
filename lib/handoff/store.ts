// Storing a handoff, and the link that lets somebody without a login read it.
//
// The link is the part worth being careful about: it carries a customer's
// pipeline, and anyone holding the URL can read it. Four things make that a
// considered decision rather than an accident.
//
//  - The token is 32 bytes from the system CSPRNG, base64url. It is the whole
//    address — there is no account id in the URL and nothing to enumerate.
//  - It expires. The form makes the person choose how long, and there is no
//    "never": a link that outlives the reason for it is the failure mode.
//  - It is revocable, immediately, from the account page.
//  - The page it serves is a stored snapshot, so what the other team reads is
//    what was reviewed and sent. Nothing that happens on the account
//    afterwards changes it, and nothing on it links back into the app.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, type DocumentRow } from "../db";
import { newId } from "../ids";
import { HandoffReport } from "./schema";
import { hashPassword, verifyPassword } from "../password";

/** How long a link may live. No "forever" — see the note above. */
export const SHARE_DAYS = [7, 14, 30, 90] as const;
export const DEFAULT_SHARE_DAYS = 30;

export class HandoffError extends Error {}

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export type StoredHandoff = { doc: DocumentRow; report: HandoffReport };

/** meta_json is parsed, never cast — the same rule a research note follows. */
export function parseHandoff(doc: DocumentRow): StoredHandoff | null {
  if (doc.kind !== "handoff" || !doc.meta_json) return null;
  try {
    const parsed = HandoffReport.safeParse(JSON.parse(doc.meta_json));
    return parsed.success ? { doc, report: parsed.data } : null;
  } catch {
    return null;
  }
}

/** At least this many characters, or it is not worth the step it adds. */
export const MIN_PASSPHRASE = 8;

export function hashPassphrase(raw: string | null | undefined): string | null {
  const phrase = (raw ?? "").trim();
  if (!phrase) return null;
  if (phrase.length < MIN_PASSPHRASE) {
    throw new HandoffError(`The passphrase needs at least ${MIN_PASSPHRASE} characters. Leave it blank for a link that opens with no word at all.`);
  }
  return hashPassword(phrase);
}

export function storeHandoff(input: {
  accountId: string;
  userId: string;
  report: HandoffReport;
  shareDays: number;
  /** Plain text, hashed here and never stored. Blank means no passphrase. */
  passphrase?: string | null;
  now?: Date;
}): StoredHandoff {
  const days = (SHARE_DAYS as readonly number[]).includes(input.shareDays) ? input.shareDays : DEFAULT_SHARE_DAYS;
  const now = (input.now ?? new Date()).getTime();
  const id = newId();
  const meta = JSON.stringify(input.report);
  const filename = `handoff-${input.report.generated_at}.html`;
  // Hashed before the INSERT so a passphrase too short to be worth having
  // fails while the person is still on the form, rather than leaving a
  // handoff stored with a link they did not mean to issue.
  const passphraseHash = hashPassphrase(input.passphrase);
  db()
    .prepare(
      `INSERT INTO documents (id, account_id, kind, filename, mime, byte_size, meta_json, status, created_by, created_at, share_token, share_expires_at, share_passphrase_hash)
       VALUES (?, ?, 'handoff', ?, 'text/html', ?, ?, 'accepted', ?, ?, ?, ?, ?)`,
    )
    .run(id, input.accountId, filename, Buffer.byteLength(meta), meta, input.userId, now, newShareToken(), now + days * 86_400_000, passphraseHash);
  return parseHandoff(db().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow)!;
}

export function listHandoffs(accountId: string): StoredHandoff[] {
  return (
    db()
      .prepare(`SELECT * FROM documents WHERE account_id = ? AND kind = 'handoff' AND archived_at IS NULL ORDER BY created_at DESC`)
      .all(accountId) as DocumentRow[]
  )
    .map(parseHandoff)
    .filter((h): h is StoredHandoff => h !== null);
}

/**
 * The document a share token addresses, or null.
 *
 * Four things make it null and they are deliberately indistinguishable to the
 * reader: no such token, the link was revoked, the link expired, or the
 * handoff was archived. Telling a stranger which of those it is tells them a
 * token was once valid, which is the only thing they could learn here.
 */
export function handoffByToken(token: string, now = Date.now()): StoredHandoff | null {
  const doc = sharedByToken(token, now);
  return doc ? parseHandoff(doc) : null;
}

// What a share link may address: a handoff, or a report Ask wrote
// (lib/ask/report.ts). Both are stored snapshots that link nowhere.
const SHAREABLE = `(kind = 'handoff' OR (kind = 'other' AND json_valid(meta_json) AND json_extract(meta_json, '$.type') = 'ask_report'))`;

/** The shared document a token addresses, or null — on the same four terms as above. */
export function sharedByToken(token: string, now = Date.now()): DocumentRow | null {
  if (!token) return null;
  const doc = db()
    .prepare(`SELECT * FROM documents WHERE share_token = ? AND ${SHAREABLE} AND archived_at IS NULL`)
    .get(token) as DocumentRow | undefined;
  if (!doc) return null;
  if (doc.share_expires_at === null || doc.share_expires_at === undefined || doc.share_expires_at <= now) return null;
  return doc;
}

/** Stops the link working, now. The document stays — DECISIONS #8. */
export function revokeShare(documentId: string): void {
  db()
    .prepare(`UPDATE documents SET share_token = NULL, share_expires_at = NULL, share_passphrase_hash = NULL WHERE id = ? AND ${SHAREABLE}`)
    .run(documentId);
}

/** A new token for a handoff or report: its first link, or one revoked or run out. */
export function reshare(documentId: string, shareDays: number, now = Date.now(), passphrase?: string | null): string {
  const days = (SHARE_DAYS as readonly number[]).includes(shareDays) ? shareDays : DEFAULT_SHARE_DAYS;
  const doc = db().prepare(`SELECT * FROM documents WHERE id = ? AND ${SHAREABLE}`).get(documentId) as DocumentRow | undefined;
  if (!doc || doc.archived_at) throw new HandoffError("That is not available to share.");
  const token = newShareToken();
  // The old hash never carries over. A new address with the previous word on
  // it would mean the two could drift apart, and somebody who had been told
  // the old passphrase would still hold half of the new link.
  const passphraseHash = hashPassphrase(passphrase);
  db()
    .prepare(`UPDATE documents SET share_token = ?, share_expires_at = ?, share_passphrase_hash = ? WHERE id = ?`)
    .run(token, now + days * 86_400_000, passphraseHash, documentId);
  return token;
}

export function shareState(doc: DocumentRow, now = Date.now()): "live" | "expired" | "revoked" {
  if (!doc.share_token) return "revoked";
  return (doc.share_expires_at ?? 0) > now ? "live" : "expired";
}
