import { db, type DocumentRow } from "../db";
import { noteTitle } from "../research/notes";

// What to call each record when a proposal or a brief refers to it. Without
// this a review card shows a raw id, which tells the reader nothing.
export function entityLabels(accountId: string): Record<string, string> {
  const conn = db();
  const out: Record<string, string> = {};
  for (const r of conn.prepare(`SELECT deal_id AS id, name FROM deals WHERE account_id = ?`).all(accountId) as Array<{ id: string; name: string }>) {
    out[r.id] = r.name;
  }
  for (const r of conn.prepare(`SELECT id, title AS name FROM plays WHERE account_id = ?`).all(accountId) as Array<{ id: string; name: string }>) {
    out[r.id] = r.name;
  }
  for (const r of conn.prepare(`SELECT id, name FROM contacts WHERE account_id = ?`).all(accountId) as Array<{ id: string; name: string }>) {
    out[r.id] = r.name;
  }
  for (const r of conn.prepare(`SELECT id, title, held_at FROM meetings WHERE account_id = ?`).all(accountId) as Array<{ id: string; title: string; held_at: string }>) {
    out[r.id] = `${r.title} (${r.held_at.slice(0, 10)})`;
  }
  for (const r of conn.prepare(`SELECT id, text FROM action_items WHERE account_id = ?`).all(accountId) as Array<{ id: string; text: string }>) {
    out[r.id] = r.text.slice(0, 60);
  }
  for (const r of conn.prepare(`SELECT id, name FROM accounts WHERE id = ?`).all(accountId) as Array<{ id: string; name: string }>) {
    out[r.id] = r.name;
  }
  // Every document, not just research notes: "What moved" on Home renders a
  // change_log row's entity by this map, and an uploaded report landed there
  // as a bare uuid. `SELECT *` here pulled every document's content_text —
  // the whole extracted body of every uploaded report — to read two columns.
  for (const r of conn
    .prepare(`SELECT id, kind, filename, meta_json FROM documents WHERE account_id = ?`)
    .all(accountId) as Array<Pick<DocumentRow, "id" | "kind" | "filename" | "meta_json">>) {
    out[r.id] = r.kind === "research_note" ? noteTitle(r as DocumentRow) : r.filename;
  }
  // Install-base rows have no name of their own; the product family is what a
  // person would call them. Without this, Home printed a bare "install base".
  for (const r of conn
    .prepare(`SELECT id, product_family, as_of FROM install_base WHERE account_id = ?`)
    .all(accountId) as Array<{ id: string; product_family: string; as_of: string }>) {
    out[r.id] = `${r.product_family} (${r.as_of.slice(0, 10)})`;
  }
  // The two of us. Not an account's record, but an id that appears as a
  // *value* in change_log — a follow-up's owner since migration 007 and an
  // account's owner since 009 — and both rendered as a raw uuid in history
  // and on /activity, on the two fields whose entire purpose is naming a
  // person. Two rows, and the map is already keyed by id.
  for (const r of conn.prepare(`SELECT id, display_name FROM users`).all() as Array<{ id: string; display_name: string }>) {
    out[r.id] = r.display_name;
  }
  return out;
}
