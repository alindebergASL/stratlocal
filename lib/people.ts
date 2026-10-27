// One human, at more than one account.
//
// `contacts.account_id` is NOT NULL and stays that way. Each account keeps its
// own row for a person, because their role, their title and what you have
// written about them genuinely are per-account — what you know about somebody
// at one customer is not what you know at another. What was missing was only
// the connection between the rows, and that is all this adds.
//
// The link is a group id: every row that is the same human shares one uuid.
// Linking adopts an id either side already has, so a third account joins the
// same group rather than starting a second one.
//
// **It never reaches a prompt or a handoff**, and that is a rule rather than
// an oversight. A context pack is built per account and a handoff is a
// document sent to another account team; naming this person's *other*
// customers in either is one customer's information leaking into another's.
// tests/personLink.test.ts reads the sources to hold that, the way
// tests/untrustedBoundary.test.ts holds the research boundary — so it survives
// somebody adding a field in the wrong place rather than depending on nobody
// doing it.
import { db, type ContactRow } from "./db";
import { newId } from "./ids";
import { ApplyError } from "./proposals/apply";
import { sameName } from "./format";

/** The other rows that are this same person, newest account first. Live only:
 *  an archived row is not somebody you are working with. */
export function otherAccountsFor(contact: Pick<ContactRow, "id" | "person_id">): Array<ContactRow & { account_name: string }> {
  if (!contact.person_id) return [];
  return db()
    .prepare(
      `SELECT c.*, a.name AS account_name
       FROM contacts c JOIN accounts a ON a.id = c.account_id
       WHERE c.person_id = ? AND c.id != ? AND c.archived_at IS NULL AND a.archived_at IS NULL
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all(contact.person_id, contact.id) as Array<ContactRow & { account_name: string }>;
}

/**
 * Say that two rows are the same human.
 *
 * Refuses two rows on one account: that is what `mergeContacts` is for, and
 * two ways to say the same thing with different results is how somebody ends
 * up with a linked pair they meant to merge.
 */
export function linkPeople(input: { aId: string; bId: string; actorUserId?: string | null }): { personId: string } {
  const conn = db();
  return conn.transaction((): { personId: string } => {
    const get = (id: string) => conn.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | undefined;
    const a = get(input.aId);
    const b = get(input.bId);
    if (!a) throw new ApplyError(`contact ${input.aId} not found`, "not_found");
    if (!b) throw new ApplyError(`contact ${input.bId} not found`, "not_found");
    if (a.id === b.id) throw new ApplyError("that is the same record", "validation");
    if (a.account_id === b.account_id) {
      throw new ApplyError("those are two people on one account — merge them instead of linking them", "validation");
    }
    // Adopt whichever id exists, so linking a third account joins the group
    // rather than splitting it. Both already grouped and differently: the
    // groups become one, which is what saying "these are the same person"
    // means.
    const personId = a.person_id ?? b.person_id ?? newId();
    const from = a.person_id && b.person_id && a.person_id !== b.person_id ? [a.person_id, b.person_id] : [];
    // Every row whose group this changes, read before it changes, so each one
    // gets its own history line on its own account.
    const touched = (
      from.length > 0
        ? (conn.prepare(`SELECT * FROM contacts WHERE person_id IN (?, ?) OR id IN (?, ?)`).all(from[0], from[1], a.id, b.id) as ContactRow[])
        : [a, b]
    ).filter((r) => r.person_id !== personId);
    if (from.length > 0) {
      conn.prepare(`UPDATE contacts SET person_id = ? WHERE person_id IN (?, ?)`).run(personId, from[0], from[1]);
    }
    conn.prepare(`UPDATE contacts SET person_id = ? WHERE id IN (?, ?)`).run(personId, a.id, b.id);
    recordLinkChange(conn, touched, "linked as the same person at another account", input.actorUserId ?? null);
    return { personId };
  })();
}

/** Take one row out of the group. The others stay linked to each other. */
export function unlinkPerson(contactId: string, actorUserId: string | null = null): void {
  const conn = db();
  conn.transaction(() => {
    const row = conn.prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId) as ContactRow | undefined;
    if (!row) throw new ApplyError(`contact ${contactId} not found`, "not_found");
    if (!row.person_id) return;
    const touched: ContactRow[] = [row];
    conn.prepare(`UPDATE contacts SET person_id = NULL WHERE id = ?`).run(contactId);
    // A group of one is not a group. Left behind, it would render "also at"
    // with nothing after it on the row that remains.
    const left = conn.prepare(`SELECT * FROM contacts WHERE person_id = ?`).all(row.person_id) as ContactRow[];
    if (left.length === 1) {
      conn.prepare(`UPDATE contacts SET person_id = NULL WHERE id = ?`).run(left[0]!.id);
      touched.push(left[0]!);
    }
    recordLinkChange(conn, touched, null, actorUserId);
  })();
}

// A link is a statement about who somebody is, and it used to be the one
// write in the app that left no trace: no history line, no actor, no new
// version. So Activity could not show it, the other of you could not tell it
// from "always so", and the Refresh notice did not move. Each row whose group
// changed now gets its version bumped and a line on its own account's
// history, in the same transaction as the change.
function recordLinkChange(conn: ReturnType<typeof db>, rows: ContactRow[], now: string | null, actorUserId: string | null) {
  const at = Date.now();
  const bump = conn.prepare(`UPDATE contacts SET updated_at = MAX(updated_at + 1, ?) WHERE id = ?`);
  const log = conn.prepare(
    `INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, created_at)
     VALUES (?, ?, 'contact', ?, 'person_link', ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    bump.run(at, r.id);
    log.run(newId(), r.account_id, r.id, JSON.stringify(r.person_id ? "linked as the same person at another account" : null), JSON.stringify(now), actorUserId, at);
  }
}

/**
 * Rows at *other* accounts that look like this person.
 *
 * The same two signals `likelyDuplicateContacts` uses within an account, and
 * for the same reason: this pre-fills a picker, and a guess here puts the wrong
 * human in front of somebody about to say they are the same. An address is near
 * certain; an exact name under `sameName` is the case that actually occurs,
 * because the report import creates your own colleagues fresh on every account.
 */
export function likelySamePerson(contact: ContactRow): Array<ContactRow & { account_name: string }> {
  const email = (contact.email ?? "").trim().toLowerCase();
  const rows = db()
    .prepare(
      `SELECT c.*, a.name AS account_name
       FROM contacts c JOIN accounts a ON a.id = c.account_id
       WHERE c.account_id != ? AND c.archived_at IS NULL AND a.archived_at IS NULL
         AND (c.person_id IS NULL OR c.person_id != COALESCE(?, ''))
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all(contact.account_id, contact.person_id ?? null) as Array<ContactRow & { account_name: string }>;
  return rows.filter((c) => (email !== "" && (c.email ?? "").trim().toLowerCase() === email) || sameName(c.name, contact.name));
}
