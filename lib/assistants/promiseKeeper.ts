// Promise keeper: reads the open follow-ups and leaves a notice or a question
// where a promise needs one. It reads structured records only, so no model
// reads anything and it costs nothing (DECISIONS #27). It never changes a
// follow-up: a question is answered by a person, through the same save every
// other edit uses.
//
// The rules, all of them:
// - Something we promised is due in one or two days: a notice for its owner.
//   (Due today and late are already on Today.)
// - Something the customer promised is due today or in the next two days: a
//   notice, so it can be expected or chased.
// - Something the customer promised has no date: a question, "when did they
//   say?", asked once.
import { db, OWN_WORK_ACCOUNT_ID, type AssistantNoticeRow } from "../db";
import { addDays, todayISO } from "../clock";
import { fmtDay } from "../format";
import { newId } from "../ids";
import { listUsers } from "../auth";
import { promiseDirection } from "../promises";
import { otherSideNames } from "../queries/accounts";
import { beginAssistantRun, endAssistantRun, NOTICE_VISIBLE_SQL, type RunTrigger } from "./runs";
import { assistantMode } from "./settings";

export const PROMISE_LOOKAHEAD_DAYS = 2;

export type PromiseRow = {
  id: string;
  account_id: string;
  account_name: string;
  account_owner: string | null;
  text: string;
  owner: string | null;
  owner_user_id: string | null;
  due: string | null;
};

export type PromiseFinding = {
  kind: "notify" | "question";
  actionItemId: string;
  accountId: string;
  forUserId: string | null;
  text: string;
  dedupeKey: string;
};

// The key carries the date the notice was about, so a promise whose date
// moves gets a fresh notice and the old one stops showing.
export function promiseKey(rule: "ours-soon" | "theirs-soon" | "theirs-undated", actionItemId: string, due: string | null): string {
  return `promise:${rule}:${actionItemId}:${due ?? "none"}`;
}

export function findPromises(rows: readonly PromiseRow[], users: readonly { name: string }[], today: string, contacts: ReadonlyMap<string, readonly string[]> = new Map()): PromiseFinding[] {
  const out: PromiseFinding[] = [];
  const horizon = addDays(today, PROMISE_LOOKAHEAD_DAYS);
  for (const r of rows) {
    const way = promiseDirection({ owner: r.owner, ownerUserId: r.owner_user_id }, users, contacts.get(r.account_id));
    const base = { actionItemId: r.id, accountId: r.account_id };
    if (way === "ours" && r.due && r.due > today && r.due <= horizon) {
      out.push({ ...base, kind: "notify", forUserId: r.owner_user_id, text: `You promised this for ${fmtDay(r.due)}`, dedupeKey: promiseKey("ours-soon", r.id, r.due) });
    } else if (way === "theirs" && r.due && r.due >= today && r.due <= horizon) {
      out.push({ ...base, kind: "notify", forUserId: r.account_owner, text: `${r.owner} promised this for ${fmtDay(r.due)}`, dedupeKey: promiseKey("theirs-soon", r.id, r.due) });
    } else if (way === "theirs" && !r.due) {
      out.push({ ...base, kind: "question", forUserId: r.account_owner, text: `${r.owner} promised this with no date. When did they say?`, dedupeKey: promiseKey("theirs-undated", r.id, null) });
    }
  }
  return out;
}

export function openPromiseRows(): PromiseRow[] {
  return db()
    .prepare(
      `SELECT ai.id, ai.account_id, a.name AS account_name, a.owner_user_id AS account_owner, ai.text, ai.owner, ai.owner_user_id, ai.due
       FROM action_items ai JOIN accounts a ON a.id = ai.account_id
       WHERE ai.status = 'open' AND ai.archived_at IS NULL AND a.archived_at IS NULL AND a.id != ?
       ORDER BY ai.due IS NULL, ai.due, ai.id`,
    )
    .all(OWN_WORK_ACCOUNT_ID) as PromiseRow[];
}

export type PromiseKeeperResult = { checked: number; found: number; added: number };

export function runPromiseKeeper(trigger: RunTrigger, userId: string | null, today = todayISO()): { runId: string } & PromiseKeeperResult {
  const runId = beginAssistantRun("promise_keeper", trigger, userId);
  try {
    const rows = openPromiseRows();
    const findings = findPromises(rows, listUsers().map((u) => ({ name: u.display_name })), today, otherSideNames());
    const insert = db().prepare(
      `INSERT OR IGNORE INTO assistant_notices (id, assistant, kind, account_id, action_item_id, for_user_id, text, dedupe_key, run_id, created_at)
       VALUES (?, 'promise_keeper', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    const now = Date.now();
    db().transaction(() => {
      for (const f of findings) added += insert.run(newId(), f.kind, f.accountId, f.actionItemId, f.forUserId, f.text, f.dedupeKey, runId, now).changes;
    })();
    const result = { checked: rows.length, found: findings.length, added };
    endAssistantRun(runId, { status: "done", summary: promiseSummary(result), result });
    return { runId, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    endAssistantRun(runId, { status: "failed", summary: "Could not read the follow-ups.", error: message });
    throw e;
  }
}

export function promiseSummary(r: PromiseKeeperResult): string {
  const looked = `Checked ${r.checked} open follow-up${r.checked === 1 ? "" : "s"}`;
  if (r.added === 0) return `${looked}; nothing new.`;
  return `${looked}; ${r.added} new reminder${r.added === 1 ? "" : "s"} or question${r.added === 1 ? "" : "s"}.`;
}

// ---- reading what it left --------------------------------------------------

export type OpenNotice = AssistantNoticeRow & { item_text: string; item_due: string | null; item_owner: string | null; account_name: string; for_user_name: string | null };


// A notice is shown only while it is still true: the follow-up is open, its
// date is the one the notice was about, a "due soon" date has not yet
// arrived, and a question about a missing date still has no date. So nothing
// stale needs cleaning up, and finishing the follow-up quietly ends it.
export function stillTrue(n: Pick<AssistantNoticeRow, "kind" | "dedupe_key">, item: { due: string | null }, today: string): boolean {
  const [, rule, , due] = n.dedupe_key.split(":");
  if ((item.due ?? "none") !== due) return false;
  if (rule === "theirs-undated") return item.due == null;
  if (!item.due) return false;
  return rule === "ours-soon" ? item.due > today : item.due >= today;
}

// `everyone` is the Promises page, which lists both of yours and says whose;
// Today shows only what is for you.
export function openNotices(me: string, today = todayISO(), opts: { everyone?: boolean } = {}): OpenNotice[] {
  // Switched off means quiet, including what it left before.
  if (assistantMode("promise_keeper") === "off") return [];
  const rows = db()
    .prepare(
      `SELECT n.*, ai.text AS item_text, ai.due AS item_due, ai.owner AS item_owner, a.name AS account_name, u.display_name AS for_user_name
       FROM assistant_notices n
       JOIN action_items ai ON ai.id = n.action_item_id
       JOIN accounts a ON a.id = n.account_id
       LEFT JOIN users u ON u.id = n.for_user_id
       WHERE n.resolved_at IS NULL AND (? OR ${NOTICE_VISIBLE_SQL})
         AND ai.status = 'open' AND ai.archived_at IS NULL AND a.archived_at IS NULL
       ORDER BY n.kind = 'notify', ai.due IS NULL, ai.due, n.created_at
       LIMIT 200`,
    )
    .all(opts.everyone ? 1 : 0, me) as OpenNotice[];
  return rows.filter((n) => stillTrue(n, { due: n.item_due }, today));
}

export class NoticeError extends Error {}

export function resolveNotice(id: string, userId: string, resolution: "dismissed" | "answered") {
  const r = db()
    .prepare(`UPDATE assistant_notices SET resolved_at = ?, resolved_by = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL`)
    .run(Date.now(), userId, resolution, id);
  if (r.changes === 0) throw new NoticeError("That was already dealt with.");
}

export function getNotice(id: string): AssistantNoticeRow | null {
  return (db().prepare(`SELECT * FROM assistant_notices WHERE id = ?`).get(id) as AssistantNoticeRow | undefined) ?? null;
}
