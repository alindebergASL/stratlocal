// What about an account deserves attention, said the same way everywhere.
//
// Today and the account Overview already lead with what needs you; the
// Accounts list, the account header and the pipeline did not, so every row
// read the same. These are the few facts worth a mark, worked out in code
// from what is on file, in one pass for any number of accounts.
import { db, type DocumentRow } from "../db";
import { needsNextStepSql } from "../deals/nextStep";
import { dayOf, daysBetween, todayISO } from "../clock";
import { parseNote } from "../research/notes";
import { briefItemsOf, buildBrief } from "../research/brief";

export type AccountSignals = {
  /** The newest kept reason to act: a compelling event first, else a recent trigger. */
  reason: { kind: "compelling_event" | "trigger"; date: string | null; text: string; noteId: string; index: number } | null;
  overdue: number;
  review: number;
  noNextStep: number;
  /** Nobody has written anything down for three weeks or more, or ever. */
  quiet: boolean;
  /** Days since anything was written down; null when nothing ever was. */
  quietDays: number | null;
};

// An account nobody has written anything down about for this long (the
// Accounts list's long-standing rule).
export const QUIET_AFTER_DAYS = 21;

const EMPTY: AccountSignals = { reason: null, overdue: 0, review: 0, noNextStep: 0, quiet: false, quietDays: null };

export function accountSignals(accountIds: string[], now = new Date()): Map<string, AccountSignals> {
  const out = new Map<string, AccountSignals>(accountIds.map((id) => [id, { ...EMPTY }]));
  if (accountIds.length === 0) return out;
  const conn = db();
  const today = todayISO(now);
  const ids = JSON.stringify(accountIds);
  const IN = `account_id IN (SELECT value FROM json_each(?))`;
  const count = (sql: string, ...args: unknown[]) => conn.prepare(sql).all(...args) as Array<{ account_id: string; n: number }>;
  for (const r of count(`SELECT account_id, COUNT(*) AS n FROM action_items WHERE ${IN} AND archived_at IS NULL AND status = 'open' AND due IS NOT NULL AND due < ? GROUP BY account_id`, ids, today)) out.get(r.account_id)!.overdue = r.n;
  for (const r of count(`SELECT account_id, COUNT(*) AS n FROM proposals WHERE ${IN} AND status = 'pending' GROUP BY account_id`, ids)) out.get(r.account_id)!.review = r.n;
  for (const r of count(`SELECT account_id, COUNT(*) AS n FROM deals WHERE ${IN} AND archived_at IS NULL AND ${needsNextStepSql("")} GROUP BY account_id`, ids, today)) out.get(r.account_id)!.noNextStep = r.n;
  const last = conn.prepare(`SELECT a.value AS account_id, (SELECT MAX(created_at) FROM change_log c WHERE c.account_id = a.value) AS at FROM json_each(?) a`).all(ids) as Array<{ account_id: string; at: number | null }>;
  for (const r of last) {
    const days = r.at === null ? null : daysBetween(dayOf(r.at), today);
    out.get(r.account_id)!.quiet = days === null || days >= QUIET_AFTER_DAYS;
    out.get(r.account_id)!.quietDays = days;
  }
  // Reasons to act, from the research brief's own rules.
  const docs = conn.prepare(`SELECT * FROM documents WHERE ${IN} AND kind = 'research_note' AND status = 'accepted' AND archived_at IS NULL`).all(ids) as DocumentRow[];
  const byAccount = new Map<string, NonNullable<ReturnType<typeof parseNote>>[]>();
  for (const d of docs) {
    const n = parseNote(d);
    if (n) byAccount.set(d.account_id, [...(byAccount.get(d.account_id) ?? []), n]);
  }
  for (const [accountId, notes] of byAccount) {
    const brief = buildBrief(briefItemsOf(notes), [], null, today);
    const top = brief.events[0] ?? brief.triggers[0];
    if (top?.read?.signal) out.get(accountId)!.reason = { kind: top.read.signal, date: top.finding.date, text: top.finding.text, noteId: top.noteId, index: top.index };
  }
  return out;
}

/** How much an account needs you, for putting the ones that do first. */
export function attentionScore(s: AccountSignals): number {
  return (s.reason ? (s.reason.kind === "compelling_event" ? 8 : 4) : 0) + Math.min(s.overdue, 5) * 2 + (s.review ? 3 : 0) + (s.quiet ? 2 : 0) + (s.noNextStep ? 1 : 0);
}
