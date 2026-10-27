// Sending one draft (DECISIONS #103). Called only from a page, by the person
// who pressed Send (app/outbound/actions.ts); the scheduler and assistants
// never send (tests/outbound.test.ts checks the imports).
//
// The draft is checked and marked `sending` in one transaction, so a second
// press finds it no longer a draft. The outcome is recorded either way, and
// what went out is in the account's history.
import { db } from "../db";
import { newId } from "../ids";
import { listUsers } from "../auth";
import { mailSource } from "../mail/sync";
import { checkRecipients, DraftError, getDraft, type OutboundDraft } from "./drafts";
import { sendOutbound } from "./providers";

export const SENDS_PER_DAY = 20;

export function sentToday(userId: string, now = Date.now()): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM outbound_drafts WHERE user_id = ? AND status IN ('sent','sending','unknown') AND sent_at > ?`).get(userId, now - 24 * 3_600_000) as { n: number }).n;
}

export async function sendDraft(id: string, userId: string): Promise<OutboundDraft> {
  const now = Date.now();
  const claimed = db().transaction(() => {
    const d = getDraft(id);
    if (!d || d.userId !== userId) throw new DraftError("That draft is not yours.");
    if (d.status !== "draft" && d.status !== "failed") throw new DraftError(d.status === "unknown" ? "Whether this was sent is not known. Check your Sent folder first." : `This is already ${d.status}.`);
    const source = mailSource(userId);
    if (!source?.enabled || !source.canSend) throw new DraftError("Sending is not on for your mailbox. Turn it on under Settings → Connections.");
    if (sentToday(userId, now) >= SENDS_PER_DAY) throw new DraftError(`At most ${SENDS_PER_DAY} sends a day.`);
    // Recipients again, as they stand now: a contact archived since is not sent to.
    checkRecipients(d.accountId, d.to);
    if (d.cc.length) checkRecipients(d.accountId, d.cc);
    db().prepare(`UPDATE outbound_drafts SET status = 'sending', sent_at = ?, error = NULL, updated_at = ? WHERE id = ? AND status IN ('draft','failed')`).run(now, now, id);
    return { draft: d, source };
  }).immediate();

  const user = listUsers({ includeInactive: true }).find((u) => u.id === userId);
  const outcome = await sendOutbound(claimed.source.kind, claimed.source.mailbox, user?.display_name ?? "", claimed.draft);
  const at = Date.now();
  db().transaction(() => {
    if (outcome.status === "sent") {
      db().prepare(`UPDATE outbound_drafts SET status = 'sent', provider_id = ?, sent_at = ?, updated_at = ? WHERE id = ?`).run(outcome.providerId, at, at, id);
      const what = `${claimed.draft.kind === "invite" ? "Invite" : "Email"} to ${claimed.draft.to.map((r) => r.name ?? r.email).join(", ")}: ${claimed.draft.subject}`;
      db()
        .prepare(`INSERT INTO change_log (id, account_id, entity_type, entity_id, field, old_value, new_value, actor_user_id, proposal_id, source_ref_json, created_at) VALUES (?, ?, 'outbound', ?, 'sent', NULL, ?, ?, NULL, NULL, ?)`)
        .run(newId(), claimed.draft.accountId, id, JSON.stringify(what), userId, at);
    } else {
      db().prepare(`UPDATE outbound_drafts SET status = ?, error = ?, updated_at = ?${outcome.status === "failed" ? ", sent_at = NULL" : ""} WHERE id = ?`).run(outcome.status, outcome.error.slice(0, 300), at, id);
    }
  })();
  return getDraft(id)!;
}
