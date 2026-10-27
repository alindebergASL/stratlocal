// "Since you last looked" on an account's Overview (DECISIONS #100): what
// changed on its records, the research kept, and what of this account is
// waiting in the Inbox, all since your last visit (lib/accounts/lastLooked.ts).
import { recentChanges, type RecentChange } from "../queries/today";
import { inboxSummary, type AccountChanges, type ResearchDraft } from "../inbox/query";
import type { BriefItem } from "../research/brief";
import { db } from "../db";

export type SinceLooked = {
  since: number | null;
  changes: RecentChange[];
  findings: BriefItem[];
  waiting: { changes: AccountChanges | null; research: ResearchDraft[] };
  /** Email kept for this account since then (DECISIONS #102). */
  mail: Array<{ id: string; subject: string; from: string; at: number }>;
};

export function sinceLooked(accountId: string, me: string, since: number | null, kept: BriefItem[]): SinceLooked {
  const inbox = inboxSummary(me);
  return {
    since,
    // A first visit has nothing to compare with: what is on file is the page.
    changes: since === null ? [] : recentChanges(since, 8, accountId),
    findings: since === null ? [] : kept.filter((k) => !!k.acceptedAt && Date.parse(k.acceptedAt) > since).slice(0, 5),
    waiting: { changes: inbox.changes.find((c) => c.accountId === accountId) ?? null, research: inbox.research.filter((r) => r.accountId === accountId) },
    mail: since === null ? [] : (db().prepare(`SELECT id, subject, COALESCE(from_name, from_addr) AS sender, received_at FROM mail_messages WHERE account_id = ? AND received_at > ? ORDER BY received_at DESC LIMIT 5`).all(accountId, since) as Array<{ id: string; subject: string; sender: string; received_at: number }>).map((m) => ({ id: m.id, subject: m.subject, from: m.sender, at: m.received_at })),
  };
}
