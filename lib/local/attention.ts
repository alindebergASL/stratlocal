import { db } from "../db";
import { meetingCutoff, todayISO } from "../clock";
import { needsNextStepSql } from "../deals/nextStep";

export type LocalAccountAttention = {
  today: string;
  pending: number;
  overdue: number;
  dueToday: number;
  missingNextStep: number;
  followUps: { id: string; text: string; owner: string | null; due: string }[];
  nextMeeting: { id: string; title: string; held_at: string; held_time: string | null } | null;
};

/** Read saved work only. Research and generated drafts do not create tasks. */
export function localAccountAttention(accountId: string, now = new Date()): LocalAccountAttention {
  const conn = db();
  const today = todayISO(now);
  const cutoff = meetingCutoff(now);
  const counts = conn.prepare(`SELECT
    (SELECT COUNT(*) FROM proposals WHERE account_id=@id AND status='pending') AS pending,
    (SELECT COUNT(*) FROM action_items WHERE account_id=@id AND archived_at IS NULL AND status='open' AND due < @today) AS overdue,
    (SELECT COUNT(*) FROM action_items WHERE account_id=@id AND archived_at IS NULL AND status='open' AND due = @today) AS dueToday
  `).get({ id: accountId, today }) as Pick<LocalAccountAttention, "pending" | "overdue" | "dueToday">;
  const { missingNextStep } = conn.prepare(`SELECT COUNT(*) AS missingNextStep FROM deals
    WHERE account_id=? AND archived_at IS NULL AND merged_into IS NULL AND ${needsNextStepSql("")}
  `).get(accountId, today) as { missingNextStep: number };
  const followUps = conn.prepare(`SELECT a.id,a.text,COALESCE(u.display_name,a.owner) AS owner,a.due FROM action_items a
    LEFT JOIN users u ON u.id=a.owner_user_id
    WHERE a.account_id=? AND a.archived_at IS NULL AND a.status='open' AND a.due <= ?
    ORDER BY a.due,a.created_at,a.id LIMIT 5
  `).all(accountId, today) as LocalAccountAttention["followUps"];
  // Use the same one-hour meeting window as the rest of the app, so a call
  // in progress remains accessible while completed calls stop appearing.
  const nextMeeting = conn.prepare(`SELECT id,title,held_at,held_time FROM meetings
    WHERE account_id=? AND archived_at IS NULL AND merged_into IS NULL AND held_at >= ?
      AND NOT (held_at < ? OR (held_at = ? AND held_time IS NOT NULL AND held_time <= ?))
    ORDER BY held_at,held_time IS NULL,held_time,id LIMIT 1
  `).get(accountId, today, cutoff.day, cutoff.day, cutoff.time) as LocalAccountAttention["nextMeeting"] | undefined;
  return { today, ...counts, missingNextStep, followUps, nextMeeting: nextMeeting ?? null };
}
