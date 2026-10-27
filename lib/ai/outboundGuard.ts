// What may leave the box with a web search (DECISIONS #3, #101).
//
// A web search sends the account's public identity and the question a person
// typed, nothing else. This is the second check on that question, after
// WebResearchInput's own: it refuses anything that names what is ours rather
// than theirs (a deal, a person we know, an amount), so a question typed in
// the flow of work cannot carry the pipeline out with it.
import { db } from "../db";

export class OutboundRefused extends Error {}

const MONEY = /(\$|£|€|usd|eur|gbp)\s?\d|\d[\d,.]*\s?(k|m|mm|bn|million|thousand|billion)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const MAX = 300;

/** The question, if it may be sent with this account's public identity; otherwise why not. */
export function guardWebQuestion(question: string, accountId: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length < 3) throw new OutboundRefused("Ask a question to look up.");
  if (q.length > MAX) throw new OutboundRefused(`A web question is at most ${MAX} characters. Ask it more briefly.`);
  if (EMAIL.test(q)) throw new OutboundRefused("A web question cannot contain an email address.");
  if (MONEY.test(q)) throw new OutboundRefused("A web question cannot contain an amount. Ask in public terms.");
  const lower = q.toLowerCase();
  const conn = db();
  const deals = conn.prepare(`SELECT name FROM deals WHERE account_id = ? AND archived_at IS NULL`).all(accountId) as Array<{ name: string }>;
  const people = conn.prepare(`SELECT name, email FROM contacts WHERE account_id = ? AND archived_at IS NULL`).all(accountId) as Array<{ name: string; email: string | null }>;
  const named = (s: string | null) => !!s && s.trim().length >= 4 && lower.includes(s.trim().toLowerCase());
  if (deals.some((d) => named(d.name))) throw new OutboundRefused("A web question cannot name one of our deals. Ask in public terms.");
  if (people.some((p) => named(p.name) || named(p.email))) throw new OutboundRefused("A web question cannot name someone we know there. Ask about the organisation instead.");
  return q;
}
