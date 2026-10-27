// The facts an account's Where it stands is written from (DECISIONS #106):
// the counted sentences' facts, the open deals, live plays, the next and last
// meeting and the top research lead, one citable key each. Only these move
// the fingerprint, so it is rewritten only when the account's records move.
import { db } from "../db";
import { fmtDay, fmtMoneyShort, stageText } from "../format";
import type { Fact } from "./core";

export const accountKey = (accountId: string) => `account:${accountId}`;

export function accountFacts(accountId: string, today: string, lead: { label: string; text: string; href: string } | null): Fact[] {
  const conn = db();
  const base = `/accounts/${accountId}`;
  const account = conn.prepare(`SELECT name, thesis FROM accounts WHERE id = ? AND archived_at IS NULL`).get(accountId) as { name: string; thesis: string | null } | undefined;
  if (!account) return [];
  const facts: Fact[] = [];
  const deals = conn
    .prepare(`SELECT deal_id, name, stage, stage_label, tcv_usd, close_date, next_step FROM deals WHERE account_id = ? AND archived_at IS NULL AND status = 'open' ORDER BY COALESCE(tcv_usd, 0) DESC LIMIT 6`)
    .all(accountId) as Array<{ deal_id: string; name: string; stage: number | null; stage_label: string | null; tcv_usd: number | null; close_date: string | null; next_step: string | null }>;
  for (const d of deals)
    facts.push({
      key: `deal:${d.deal_id}`,
      label: d.name,
      href: `${base}/deals/${encodeURIComponent(d.deal_id)}`,
      facts: [stageText(d.stage, d.stage_label), d.tcv_usd != null ? fmtMoneyShort(d.tcv_usd) : "no value", d.close_date ? `closes ${fmtDay(d.close_date)}` : "no close date", d.next_step?.trim() ? `next step: ${d.next_step.trim()}` : "no next step agreed"].join("; "),
    });
  const plays = conn.prepare(`SELECT id, title, status, next_step FROM plays WHERE account_id = ? AND archived_at IS NULL AND status IN ('active','proposed','stalled') ORDER BY sort_order DESC, created_at LIMIT 4`).all(accountId) as Array<{ id: string; title: string; status: string; next_step: string | null }>;
  for (const p of plays) facts.push({ key: `play:${p.id}`, label: p.title, href: `${base}/plays/${p.id}`, facts: `${p.status}${p.next_step ? `; next: ${p.next_step}` : ""}` });
  const meetings = conn.prepare(`SELECT id, title, held_at FROM meetings WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL ORDER BY held_at DESC LIMIT 12`).all(accountId) as Array<{ id: string; title: string; held_at: string }>;
  const last = meetings.find((m) => m.held_at <= today);
  const next = [...meetings].reverse().find((m) => m.held_at > today);
  if (last) facts.push({ key: `meeting:${last.id}`, label: last.title, href: `${base}/meetings/${last.id}`, facts: `last met ${fmtDay(last.held_at)}` });
  if (next) facts.push({ key: `meeting:${next.id}`, label: next.title, href: `${base}/meetings/${next.id}`, facts: `next meeting ${fmtDay(next.held_at)}` });
  if (!next) facts.push({ key: "no-meeting", label: "Meetings", href: `${base}/meetings`, facts: "nothing booked" });
  if (account.thesis?.trim()) facts.push({ key: "thesis", label: "Account thesis", href: `${base}/plays`, facts: account.thesis.trim().slice(0, 400) });
  if (lead) facts.push({ key: "lead", label: lead.label, href: lead.href, facts: lead.text.slice(0, 300) });
  return facts;
}

export const ACCOUNT_TASK = `Write where this account stands: two or three sentences a seller would say about it, covering the deal that matters most and its next step, when the team last spoke and next speaks, and the plan or outside reason to act. Lead with what most needs attention.`;
