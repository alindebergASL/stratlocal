// The team, person by person: what each of us owns, has in motion, did this
// week, and where they could use a hand. The numbers come from the same
// places as everywhere else (accounts.owner_user_id, change_log, the shared
// next-step rule), so a person's page and the team page agree with the lists
// they link to (DECISIONS #93).
import { db, type AccountRow, type MeetingRow, type PlayRow } from "../db";
import { listTeam, type TeamMember } from "../auth";
import { todayISO } from "../clock";
import { currentFiscalQuarter } from "../fiscal";
import { needsNextStepSql } from "../deals/nextStep";
import { rankedPlays } from "../plays/rank";
import { LIVE_PLAY_STATUSES } from "../tone";
import { listOpenFollowUps, type OpenFollowUp } from "./meetings";
import { workCounts, type WorkCounts } from "./ourWork";

const DAY = 86_400_000;
const live: readonly string[] = LIVE_PLAY_STATUSES;

export type TeamRow = {
  member: TeamMember;
  accounts: number;
  openPipelineUsd: number;
  livePlays: number;
  week: WorkCounts;
  overdue: number;
  /** Deals on their accounts closing this quarter with no next step and nothing acknowledged. */
  bareThisQuarter: number;
};

function ownedAccounts(userId: string): AccountRow[] {
  return db().prepare(`SELECT * FROM accounts WHERE owner_user_id = ? AND archived_at IS NULL AND kind = 'customer' ORDER BY name COLLATE NOCASE`).all(userId) as AccountRow[];
}

function pipelineOf(userId: string): number {
  return (db().prepare(`SELECT COALESCE(SUM(d.tcv_usd), 0) AS n FROM deals d JOIN accounts a ON a.id = d.account_id WHERE a.owner_user_id = ? AND a.archived_at IS NULL AND d.archived_at IS NULL AND d.status = 'open'`).get(userId) as { n: number }).n;
}

function bareThisQuarter(userId: string, now: Date): number {
  return (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM deals d JOIN accounts a ON a.id = d.account_id WHERE a.owner_user_id = ? AND a.archived_at IS NULL AND d.archived_at IS NULL AND d.fiscal_quarter = ? AND ${needsNextStepSql("d")}`)
      .get(userId, currentFiscalQuarter(now).label, todayISO(now)) as { n: number }
  ).n;
}

function livePlaysOn(accountIds: string[]): PlayRow[] {
  if (!accountIds.length) return [];
  return (db().prepare(`SELECT * FROM plays WHERE account_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL AND merged_into IS NULL`).all(JSON.stringify(accountIds)) as PlayRow[]).filter((p) => live.includes(p.status));
}

const isOverdue = (f: OpenFollowUp, today: string) => !!f.due && f.due < today;

export function teamRows(now = new Date()): TeamRow[] {
  const today = todayISO(now);
  return listTeam()
    .filter((m) => m.active)
    .map((member) => {
      const accounts = ownedAccounts(member.id);
      return {
        member,
        accounts: accounts.length,
        openPipelineUsd: pipelineOf(member.id),
        livePlays: livePlaysOn(accounts.map((a) => a.id)).length,
        week: workCounts(member.id, now.getTime() - 7 * DAY, null, now.getTime()),
        overdue: listOpenFollowUps({ ownerUserId: member.id }).filter((f) => isOverdue(f, today)).length,
        bareThisQuarter: bareThisQuarter(member.id, now),
      };
    });
}

export type PersonPage = {
  member: TeamMember;
  accounts: Array<AccountRow & { openPipelineUsd: number }>;
  /** Live plays on their accounts, each account's in its ranked order. */
  plays: Array<PlayRow & { accountName: string; rank: number }>;
  upcoming: Array<MeetingRow & { accountName: string }>;
  followUps: OpenFollowUp[];
  overdue: number;
  week: WorkCounts;
  month: WorkCounts;
  wonThisMonth: Array<{ dealId: string; name: string; accountId: string; accountName: string; tcvUsd: number | null }>;
  bareThisQuarter: number;
};

export function personPage(userId: string, now = new Date()): PersonPage | null {
  const member = listTeam().find((m) => m.id === userId);
  if (!member) return null;
  const today = todayISO(now);
  const conn = db();
  const accounts = ownedAccounts(userId).map((a) => ({
    ...a,
    openPipelineUsd: (conn.prepare(`SELECT COALESCE(SUM(tcv_usd), 0) AS n FROM deals WHERE account_id = ? AND status = 'open' AND archived_at IS NULL`).get(a.id) as { n: number }).n,
  }));
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const byAccount = new Map<string, PlayRow[]>();
  for (const p of livePlaysOn(accounts.map((a) => a.id))) byAccount.set(p.account_id, [...(byAccount.get(p.account_id) ?? []), p]);
  const plays = [...byAccount.entries()].flatMap(([accountId, rows]) => rankedPlays(rows).map((p, i) => ({ ...p, accountName: names.get(accountId) ?? "", rank: i + 1 })));
  plays.sort((a, b) => a.rank - b.rank || a.accountName.localeCompare(b.accountName));
  // Meetings on their accounts or put on file by them, from today on.
  const upcoming = conn
    .prepare(
      `SELECT m.*, a.name AS accountName FROM meetings m JOIN accounts a ON a.id = m.account_id
       WHERE m.archived_at IS NULL AND m.merged_into IS NULL AND a.archived_at IS NULL AND m.held_at >= ? AND (a.owner_user_id = ? OR m.created_by = ?)
       ORDER BY m.held_at, m.held_time LIMIT 10`,
    )
    .all(today, userId, userId) as Array<MeetingRow & { accountName: string }>;
  const followUps = listOpenFollowUps({ ownerUserId: userId });
  const wonThisMonth = conn
    .prepare(
      `SELECT DISTINCT d.deal_id AS dealId, d.name, d.account_id AS accountId, a.name AS accountName, d.tcv_usd AS tcvUsd
       FROM change_log c JOIN deals d ON d.deal_id = c.entity_id JOIN accounts a ON a.id = d.account_id
       WHERE c.entity_type = 'deal' AND c.field = 'status' AND c.new_value = '"won"' AND c.created_at >= ?
         AND (c.actor_user_id = ? OR a.owner_user_id = ?) AND d.status = 'won'`,
    )
    .all(now.getTime() - 30 * DAY, userId, userId) as PersonPage["wonThisMonth"];
  return {
    member,
    accounts,
    plays,
    upcoming,
    followUps,
    overdue: followUps.filter((f) => isOverdue(f, today)).length,
    week: workCounts(userId, now.getTime() - 7 * DAY, null, now.getTime()),
    month: workCounts(userId, now.getTime() - 30 * DAY, null, now.getTime()),
    wonThisMonth,
    bareThisQuarter: bareThisQuarter(userId, now),
  };
}
