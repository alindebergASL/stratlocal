// Drafts a person reads and sends one at a time (DECISIONS #103): an email
// or a calendar invite, from their own mailbox, to contacts on file or an
// address they typed. Nothing here sends; lib/outbound/send.ts does, and only
// when a person presses Send on a page.
import { db } from "../db";
import { newId } from "../ids";

export type Recipient = { email: string; name: string | null; contactId: string | null; typed?: boolean };
export type DraftKind = "email" | "invite";
export type DraftSource = "recap" | "promise" | "ask" | "meeting" | "manual";
export type DraftStatus = "draft" | "sending" | "sent" | "failed" | "unknown" | "discarded";

export type OutboundDraft = {
  id: string;
  userId: string;
  accountId: string;
  kind: DraftKind;
  source: DraftSource;
  sourceId: string | null;
  to: Recipient[];
  cc: Recipient[];
  subject: string;
  body: string;
  /** Invites: local date and time in the app's zone, "YYYY-MM-DDTHH:MM". */
  startsAt: string | null;
  minutes: number | null;
  location: string | null;
  status: DraftStatus;
  providerId: string | null;
  error: string | null;
  createdAt: number;
  sentAt: number | null;
};

export const MAX_RECIPIENTS = 10;
export const MAX_BODY = 20_000;

export class DraftError extends Error {}

type Row = {
  id: string; user_id: string; account_id: string; kind: DraftKind; source: DraftSource; source_id: string | null; to_json: string; cc_json: string;
  subject: string; body: string; starts_at: string | null; minutes: number | null; location: string | null; status: DraftStatus;
  provider_id: string | null; error: string | null; created_at: number; sent_at: number | null;
};

const fromRow = (r: Row): OutboundDraft => ({
  id: r.id, userId: r.user_id, accountId: r.account_id, kind: r.kind, source: r.source, sourceId: r.source_id,
  to: JSON.parse(r.to_json), cc: JSON.parse(r.cc_json), subject: r.subject, body: r.body, startsAt: r.starts_at, minutes: r.minutes,
  location: r.location, status: r.status, providerId: r.provider_id, error: r.error, createdAt: r.created_at, sentAt: r.sent_at,
});

export function getDraft(id: string): OutboundDraft | null {
  const r = db().prepare(`SELECT * FROM outbound_drafts WHERE id = ?`).get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** A person's drafts: waiting ones first, then the latest outcomes. */
export function listDrafts(userId: string, opts: { accountId?: string; open?: boolean } = {}): OutboundDraft[] {
  const where = ["user_id = ?"];
  const args: unknown[] = [userId];
  if (opts.accountId) {
    where.push("account_id = ?");
    args.push(opts.accountId);
  }
  if (opts.open) where.push("status IN ('draft','failed','unknown')");
  else where.push("status != 'discarded'");
  return (db().prepare(`SELECT * FROM outbound_drafts WHERE ${where.join(" AND ")} ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'unknown' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, created_at DESC LIMIT 50`).all(...args) as Row[]).map(fromRow);
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * Each recipient must be a live contact on the account, with that address, or
 * an address the person typed themselves. Checked when a draft is saved and
 * again at the moment it is sent.
 */
export function checkRecipients(accountId: string, list: Recipient[]): Recipient[] {
  if (list.length === 0) throw new DraftError("Add at least one recipient.");
  if (list.length > MAX_RECIPIENTS) throw new DraftError(`At most ${MAX_RECIPIENTS} recipients.`);
  const contacts = db()
    .prepare(`SELECT id, name, lower(email) AS email FROM contacts WHERE account_id = ? AND archived_at IS NULL AND email IS NOT NULL AND email != ''`)
    .all(accountId) as Array<{ id: string; name: string; email: string }>;
  const seen = new Set<string>();
  return list.flatMap((r): Recipient[] => {
    const email = r.email.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new DraftError(`"${r.email}" is not an email address.`);
    if (seen.has(email)) return [];
    seen.add(email);
    const contact = contacts.find((c) => c.email === email);
    if (contact) return [{ email, name: contact.name, contactId: contact.id }];
    if (r.typed) return [{ email, name: r.name, contactId: null, typed: true }];
    throw new DraftError(`${r.name ?? email} is not a contact on this account. Type the address yourself to send to them.`);
  });
}

export function createDraft(input: {
  userId: string; accountId: string; kind: DraftKind; source: DraftSource; sourceId?: string | null;
  to: Recipient[]; cc?: Recipient[]; subject: string; body: string; startsAt?: string | null; minutes?: number | null; location?: string | null;
}): OutboundDraft {
  const subject = input.subject.trim().slice(0, 300);
  if (!subject) throw new DraftError("A subject is needed.");
  if (input.body.length > MAX_BODY) throw new DraftError(`At most ${MAX_BODY.toLocaleString()} characters.`);
  const to = checkRecipients(input.accountId, input.to);
  const cc = input.cc?.length ? checkRecipients(input.accountId, input.cc) : [];
  if (input.kind === "invite" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.startsAt ?? "")) throw new DraftError("An invite needs a date and time.");
  const id = newId();
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO outbound_drafts (id, user_id, account_id, kind, source, source_id, to_json, cc_json, subject, body, starts_at, minutes, location, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .run(id, input.userId, input.accountId, input.kind, input.source, input.sourceId ?? null, JSON.stringify(to), JSON.stringify(cc), subject, input.body, input.startsAt ?? null, input.kind === "invite" ? (input.minutes ?? 30) : null, input.location ?? null, now, now);
  return getDraft(id)!;
}

/** Edits before sending: only your own, only while it is a draft (or after a failure). */
export function updateDraft(id: string, userId: string, patch: { to?: Recipient[]; subject?: string; body?: string; startsAt?: string | null; minutes?: number | null }): OutboundDraft {
  const d = getDraft(id);
  if (!d || d.userId !== userId) throw new DraftError("That draft is not yours.");
  if (!["draft", "failed"].includes(d.status)) throw new DraftError(d.status === "unknown" ? "Whether this was sent is not known. Check your Sent folder; reopen it to send again." : `This is ${d.status}.`);
  const to = patch.to ? checkRecipients(d.accountId, patch.to) : d.to;
  const subject = (patch.subject ?? d.subject).trim().slice(0, 300);
  const body = patch.body ?? d.body;
  if (!subject) throw new DraftError("A subject is needed.");
  if (body.length > MAX_BODY) throw new DraftError(`At most ${MAX_BODY.toLocaleString()} characters.`);
  const startsAt = patch.startsAt !== undefined ? patch.startsAt : d.startsAt;
  if (d.kind === "invite" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt ?? "")) throw new DraftError("An invite needs a date and time.");
  db()
    .prepare(`UPDATE outbound_drafts SET to_json = ?, subject = ?, body = ?, starts_at = ?, minutes = ?, status = 'draft', error = NULL, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(to), subject, body, startsAt, d.kind === "invite" ? (patch.minutes ?? d.minutes ?? 30) : null, Date.now(), id);
  return getDraft(id)!;
}

export function discardDraft(id: string, userId: string): void {
  const d = getDraft(id);
  if (!d || d.userId !== userId) throw new DraftError("That draft is not yours.");
  if (d.status === "sent" || d.status === "sending") throw new DraftError("It has already gone.");
  db().prepare(`UPDATE outbound_drafts SET status = 'discarded', updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

/** After an unknown outcome, once the person has checked: back to a draft they may send again. */
export function reopenDraft(id: string, userId: string): void {
  const d = getDraft(id);
  if (!d || d.userId !== userId || d.status !== "unknown") throw new DraftError("Only a draft whose outcome is unknown can be reopened.");
  db().prepare(`UPDATE outbound_drafts SET status = 'draft', error = NULL, updated_at = ? WHERE id = ?`).run(Date.now(), id);
}
