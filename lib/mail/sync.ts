// Reading each person's mailbox (DECISIONS #102). Only a message whose
// people match exactly one account is kept, with its body clipped; internal
// mail, newsletters and anything that matches nobody or more than one account
// is never stored, only counted. Bodies are emptied after 30 days.
import { createHash } from "node:crypto";
import { db } from "../db";
import { newId } from "../ids";
import { matchIndex } from "../calendar/sync";
import { matchEvent } from "../calendar/match";
import { graphMail } from "./providers/graph";
import { gmailMail } from "./providers/gmail";
import { fakeMail } from "./providers/fake";
import { MailError, type MailKind, type MailMessage, type MailProvider } from "./types";

export const FIRST_READ_DAYS = 14;
export const BODY_KEPT_DAYS = 30;
export const BODY_CHARS = 20_000;

export type MailSource = { userId: string; kind: MailKind; mailbox: string; enabled: boolean; lastReadAt: number | null; lastError: string | null; skipped: number; canSend: boolean };

const PROVIDERS: Record<MailKind, MailProvider> = { graph: graphMail, gmail: gmailMail, fake: fakeMail };

type Row = { user_id: string; kind: MailKind; mailbox: string; enabled: number; last_read_at: number | null; last_error: string | null; skipped: number; can_send: number };
const fromRow = (r: Row): MailSource => ({ userId: r.user_id, kind: r.kind, mailbox: r.mailbox, enabled: !!r.enabled, lastReadAt: r.last_read_at, lastError: r.last_error, skipped: r.skipped, canSend: !!r.can_send });

export function mailSource(userId: string): MailSource | null {
  const r = db().prepare(`SELECT * FROM mail_sources WHERE user_id = ?`).get(userId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function mailSources(): MailSource[] {
  return (db().prepare(`SELECT * FROM mail_sources WHERE enabled = 1 ORDER BY created_at`).all() as Row[]).map(fromRow);
}

export function connectMail(userId: string, kind: MailKind, mailbox: string): void {
  const box = mailbox.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(box)) throw new MailError("That is not an email address.");
  db()
    .prepare(
      `INSERT INTO mail_sources (user_id, kind, mailbox, enabled, last_read_at, last_error, skipped, created_at) VALUES (?, ?, ?, 1, NULL, NULL, 0, ?)
       ON CONFLICT (user_id) DO UPDATE SET kind = excluded.kind, mailbox = excluded.mailbox, enabled = 1, last_error = NULL`,
    )
    .run(userId, kind, box, Date.now());
}

/** Stops reading. What was kept stays until its 30 days are up, like everything else. */
export function disconnectMail(userId: string): void {
  db().prepare(`UPDATE mail_sources SET enabled = 0 WHERE user_id = ?`).run(userId);
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Keeps what matches one account; returns how many were kept and skipped. Pure of the network. */
export function storeMail(userId: string, mailbox: string, messages: MailMessage[], now = Date.now()): { kept: number; skipped: number } {
  const index = matchIndex();
  const insert = db().prepare(
    `INSERT OR IGNORE INTO mail_messages (id, user_id, provider_id, account_id, thread_key, from_addr, from_name, to_json, subject, received_at, body_text, body_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let kept = 0;
  let skipped = 0;
  db().transaction(() => {
    for (const m of messages) {
      if (now - m.receivedAt > BODY_KEPT_DAYS * 86400_000) {
        skipped++;
        continue;
      }
      const match = matchEvent({ attendees: [...m.to, ...m.cc], organizer: m.from }, index, [mailbox]);
      if (match.kind !== "account") {
        skipped++;
        continue;
      }
      const body = m.body.slice(0, BODY_CHARS);
      const r = insert.run(newId(), userId, m.id, match.accountId, `${userId}:${m.thread}`, m.from.email, m.from.name, JSON.stringify([...m.to, ...m.cc].map((p) => p.email)), m.subject.slice(0, 300), m.receivedAt, body, hash(body), now);
      if (r.changes) kept++;
    }
  })();
  return { kept, skipped };
}

/** Reads one person's mailbox since the last read (the first time, two weeks). */
export async function readMailbox(userId: string, now = Date.now()): Promise<{ kept: number; skipped: number } | null> {
  const source = mailSource(userId);
  if (!source || !source.enabled) return null;
  const since = source.lastReadAt ?? now - FIRST_READ_DAYS * 86400_000;
  try {
    const messages = await PROVIDERS[source.kind].list(source.mailbox, since);
    const result = storeMail(userId, source.mailbox, messages, now);
    db().prepare(`UPDATE mail_sources SET last_read_at = ?, last_error = NULL, skipped = skipped + ? WHERE user_id = ?`).run(now, result.skipped, userId);
    return result;
  } catch (e) {
    db().prepare(`UPDATE mail_sources SET last_error = ? WHERE user_id = ?`).run((e instanceof Error ? e.message : "Could not read").slice(0, 300), userId);
    throw e;
  }
}

/** Empties bodies older than BODY_KEPT_DAYS; the subject, people and date stay. */
export function purgeMailBodies(now = Date.now()): number {
  return db()
    .prepare(`UPDATE mail_messages SET body_text = NULL, purged_at = ? WHERE purged_at IS NULL AND received_at < ?`)
    .run(now, now - BODY_KEPT_DAYS * 86400_000).changes;
}

export type MailRow = { id: string; user_id: string; provider_id: string; account_id: string; thread_key: string; from_addr: string; from_name: string | null; subject: string; received_at: number; body_text: string | null; extracted_at: number | null };

/** Threads with mail not yet read for changes, oldest first, at most `limit`. */
export function threadsToRead(limit = 5): Array<{ accountId: string; threadKey: string; messages: MailRow[] }> {
  const keys = db()
    .prepare(`SELECT account_id, thread_key FROM mail_messages WHERE extracted_at IS NULL AND body_text IS NOT NULL GROUP BY account_id, thread_key ORDER BY MIN(received_at) LIMIT ?`)
    .all(limit) as Array<{ account_id: string; thread_key: string }>;
  return keys.map((k) => ({
    accountId: k.account_id,
    threadKey: k.thread_key,
    messages: db().prepare(`SELECT * FROM mail_messages WHERE account_id = ? AND thread_key = ? AND extracted_at IS NULL AND body_text IS NOT NULL ORDER BY received_at`).all(k.account_id, k.thread_key) as MailRow[],
  }));
}

export function markExtracted(ids: string[], now = Date.now()): void {
  const stmt = db().prepare(`UPDATE mail_messages SET extracted_at = ? WHERE id = ?`);
  db().transaction(() => ids.forEach((id) => stmt.run(now, id)))();
}

/** An account's recent mail, newest first: subjects, people and dates. */
export function accountMail(accountId: string, limit = 50): MailRow[] {
  return db().prepare(`SELECT * FROM mail_messages WHERE account_id = ? ORDER BY received_at DESC LIMIT ?`).all(accountId, limit) as MailRow[];
}

/** Sending from this mailbox (DECISIONS #103): off until the person turns it on. */
export function setCanSend(userId: string, on: boolean): void {
  db().prepare(`UPDATE mail_sources SET can_send = ? WHERE user_id = ?`).run(on ? 1 : 0, userId);
}
