// The compact picture of an account that every meeting prompt reads. It
// carries ids so the model can cite what it used, and nothing else: no raw
// notes from other meetings, no credentials. A brief's pack also lists recent
// email by id and date, and what moved on the deals since the last meeting;
// the notes and email text go in wrapped (briefReadingForPrompt). Customer documents appear here
// by id and file name only; their text goes in wrapped, beside the research.
import { db, type DocumentRow } from "../db";
import { parseJsonArray } from "../format";
import { latestInstallBase, listContacts, listDeals, listPlays, getAccount } from "../queries/accounts";
import { listActionItems, recentSummarized } from "../queries/meetings";
import { researchSelection, noteTitle } from "../research/notes";
import { customerDocsInPrompt } from "../documents/customer";
import { wrapUntrusted } from "../ai/prompts";

export type PackDeal = {
  deal_id: string;
  name: string;
  stage: number | null;
  stage_label: string | null;
  close_date: string | null;
  fiscal_quarter: string | null;
  tcv_usd: number | null;
  competitor: string | null;
  partner: string | null;
  owner: string | null;
  next_step: string | null;
  status: string;
};

export type PackPlay = {
  id: string;
  title: string;
  status: string;
  owner: string | null;
  next_step: string | null;
  next_step_due: string | null;
  deal_ids: string[];
};

export type PackContact = {
  id: string;
  name: string;
  title: string | null;
  org: string;
  role: string | null;
};
export type PackActionItem = {
  id: string;
  text: string;
  owner: string | null;
  due: string | null;
};
export type PackMeeting = {
  id: string;
  title: string;
  held_at: string;
  summary: string | null;
};
// Deliberately just an id and a label. The findings are web-derived text and
// do not belong in a struct the prompts treat as our own data.
export type PackResearch = { id: string; title: string };
export type PackDocument = { id: string; title: string };
/** An email by id and day only: its subject and body are untrusted, and go in wrapped. */
export type PackEmail = { id: string; received_on: string };
export type PackDealMove = { deal_id: string; field: string; from: string | null; to: string | null; on: string };

export type ContextPack = {
  account: {
    id: string;
    name: string;
    region: string | null;
    segment: string | null;
    thesis: string | null;
  };
  install_base: Array<{
    product_family: string;
    value_usd: number | null;
    share_pct: number | null;
  }>;
  deals: PackDeal[];
  plays: PackPlay[];
  contacts: PackContact[];
  open_action_items: PackActionItem[];
  recent_meetings: PackMeeting[];
  research: PackResearch[];
  /** Optional so a pack stored before customer documents still reads. */
  documents?: PackDocument[];
  /** A brief's pack only. */
  emails?: PackEmail[];
  deal_moves?: PackDealMove[];
};

export type EvidenceKind = "deal" | "play" | "contact" | "action_item" | "meeting" | "research" | "document" | "account" | "email";
export type EvidenceEntry = { kind: EvidenceKind; label: string };

export const BRIEF_EMAILS = 5;
export const BRIEF_NOTES = 2;
const MOVED_FIELDS = ["stage", "stage_label", "close_date", "tcv_usd", "next_step", "status"];
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `forBrief`: the pack a meeting brief reads, as of the meeting's date. */
export function buildContextPack(accountId: string, opts: { excludeMeetingId?: string; meetingLimit?: number; forBrief?: { heldAt: string } } = {}): ContextPack {
  const account = getAccount(accountId);
  if (!account) throw new Error(`account ${accountId} not found`);
  // Every list this pack is built from already hides archived rows. The one
  // place an archived id could still leak is a play's stored deal_ids, which
  // evidenceIndex would not index — the model would see an id it is then
  // forbidden to cite, costing a retry for nothing.
  const liveDealIds = new Set(listDeals(accountId).map((d) => d.deal_id));
  // Ids and titles only. A research note's text came off the public web, and
  // this pack is handed to prompts as trusted data — it is also read by
  // meeting extraction, whose output becomes proposals. The content goes in
  // separately, wrapped as untrusted: see researchForPrompt in
  // lib/research/notes.ts. Archived notes are excluded, or a note someone
  // retracted would keep feeding every prompt forever.
  const research = db()
    .prepare(
      `SELECT * FROM documents
       WHERE account_id = ? AND kind = 'research_note' AND status = 'accepted' AND archived_at IS NULL
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all(accountId) as DocumentRow[];

  const brief = opts.forBrief ? briefExtras(accountId, opts.excludeMeetingId ?? null, opts.forBrief.heldAt) : null;

  return {
    account: {
      id: account.id,
      name: account.name,
      region: account.region,
      segment: account.segment,
      thesis: account.thesis,
    },
    install_base: latestInstallBase(accountId).rows.map((r) => ({
      product_family: r.product_family,
      value_usd: r.value_usd,
      share_pct: r.share_pct,
    })),
    deals: listDeals(accountId).map((d) => ({
      deal_id: d.deal_id,
      name: d.name,
      stage: d.stage,
      stage_label: d.stage_label,
      close_date: d.close_date,
      fiscal_quarter: d.fiscal_quarter,
      tcv_usd: d.tcv_usd,
      competitor: d.competitor,
      partner: d.partner,
      owner: d.owner,
      next_step: d.next_step,
      status: d.status,
    })),
    plays: listPlays(accountId).map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      owner: p.owner,
      next_step: p.next_step,
      next_step_due: p.next_step_due,
      deal_ids: parseJsonArray(p.deal_ids_json).filter((id) => liveDealIds.has(id)),
    })),
    contacts: listContacts(accountId).map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      org: c.org,
      role: c.role,
    })),
    open_action_items: listActionItems(accountId, { status: "open" }).map((a) => ({ id: a.id, text: a.text, owner: a.owner, due: a.due })),
    recent_meetings: recentSummarized(accountId, opts.meetingLimit ?? 3, opts.excludeMeetingId, opts.forBrief?.heldAt).map((m) => ({
      id: m.id,
      title: m.title,
      held_at: m.held_at,
      summary: m.summary,
    })),
    research: researchSelection(accountId).included.map((e) => ({
      id: e.id,
      title: `Retained ${e.finding.topic} finding`,
    })),
    documents: customerDocsInPrompt(accountId),
    ...(brief ? { emails: brief.emails, deal_moves: brief.moves } : {}),
  };
}

type BriefMail = { id: string; from_addr: string; from_name: string | null; subject: string; received_at: number; body_text: string | null };
type BriefNotes = { id: string; title: string; held_at: string; raw_notes: string };

function briefMail(accountId: string, before: number): BriefMail[] {
  return db()
    .prepare(`SELECT id, from_addr, from_name, subject, received_at, body_text FROM mail_messages WHERE account_id = ? AND received_at < ? ORDER BY received_at DESC LIMIT ?`)
    .all(accountId, before, BRIEF_EMAILS) as BriefMail[];
}

function briefNotes(accountId: string, excludeId: string | null, heldAt: string): BriefNotes[] {
  return db()
    .prepare(
      `SELECT id, title, held_at, raw_notes FROM meetings
       WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL AND id <> COALESCE(?, '') AND held_at < ?
         AND raw_notes IS NOT NULL AND trim(raw_notes) <> ''
       ORDER BY held_at DESC LIMIT ?`,
    )
    .all(accountId, excludeId, heldAt, BRIEF_NOTES) as BriefNotes[];
}

// The day after the meeting, so mail from the meeting's own day counts.
const cutoff = (heldAt: string) => Date.parse(`${heldAt}T00:00:00Z`) + 86400_000;

function briefExtras(accountId: string, excludeId: string | null, heldAt: string): { emails: PackEmail[]; moves: PackDealMove[] } {
  const emails = briefMail(accountId, cutoff(heldAt)).map((m) => ({ id: m.id, received_on: day(m.received_at) }));
  // What moved on the deals since the last meeting held before this one
  // (or the last 30 days when there was none): our own records, from history.
  const last = db()
    .prepare(`SELECT held_at FROM meetings WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL AND id <> COALESCE(?, '') AND held_at < ? ORDER BY held_at DESC LIMIT 1`)
    .get(accountId, excludeId, heldAt) as { held_at: string } | undefined;
  const since = last ? Date.parse(`${last.held_at}T00:00:00Z`) : cutoff(heldAt) - 31 * 86400_000;
  const moves = (
    db()
      .prepare(
        `SELECT c.entity_id, c.field, c.old_value, c.new_value, c.created_at FROM change_log c
         JOIN deals d ON d.deal_id = c.entity_id AND d.account_id = c.account_id AND d.archived_at IS NULL
         WHERE c.account_id = ? AND c.entity_type = 'deal' AND c.field IN (${MOVED_FIELDS.map(() => "?").join(",")}) AND c.created_at >= ? AND c.created_at < ?
         ORDER BY c.created_at DESC LIMIT 20`,
      )
      .all(accountId, ...MOVED_FIELDS, since, cutoff(heldAt)) as Array<{ entity_id: string; field: string; old_value: string | null; new_value: string | null; created_at: number }>
  ).map((c) => ({ deal_id: c.entity_id, field: c.field, from: c.old_value, to: c.new_value, on: day(c.created_at) }));
  return { emails, moves };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
export const BRIEF_NOTES_CHARS = 2500;
export const BRIEF_EMAIL_CHARS = 1500;

/**
 * What a brief reads beyond the records: the last meetings' own notes and the
 * account's recent email, each clipped and wrapped as untrusted. Customer
 * words, however they arrived, are material to read, never instructions.
 */
export function briefReadingForPrompt(accountId: string, meetingId: string | null, heldAt: string): string {
  const notes = briefNotes(accountId, meetingId, heldAt).map((m) =>
    wrapUntrusted("meeting_notes", clip(m.raw_notes, BRIEF_NOTES_CHARS), { meeting_id: m.id, title: m.title, held_at: m.held_at }),
  );
  const mail = briefMail(accountId, cutoff(heldAt)).map((m) =>
    wrapUntrusted(
      "email",
      `From: ${m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr}\nSubject: ${m.subject}\n\n${m.body_text === null ? "(body deleted after 30 days)" : clip(m.body_text, BRIEF_EMAIL_CHARS)}`,
      { email_id: m.id, received_on: day(m.received_at) },
    ),
  );
  return [
    notes.length ? `Notes from the last meetings before this one (cite a note by its meeting_id, as a meeting):\n${notes.join("\n")}` : null,
    mail.length ? `Recent email on this account (cite an email by its email_id, as an email):\n${mail.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Every id the model is allowed to cite, with what to call it when rendering.
export function evidenceIndex(pack: ContextPack): Map<string, EvidenceEntry> {
  const index = new Map<string, EvidenceEntry>();
  index.set(pack.account.id, { kind: "account", label: pack.account.name });
  for (const d of pack.deals) index.set(d.deal_id, { kind: "deal", label: d.name });
  for (const p of pack.plays) index.set(p.id, { kind: "play", label: p.title });
  for (const c of pack.contacts) index.set(c.id, { kind: "contact", label: c.name });
  for (const a of pack.open_action_items) index.set(a.id, { kind: "action_item", label: a.text.slice(0, 60) });
  for (const m of pack.recent_meetings) index.set(m.id, { kind: "meeting", label: `${m.title} (${m.held_at})` });
  for (const r of pack.research) index.set(r.id, { kind: "research", label: r.title });
  for (const d of pack.documents ?? []) index.set(d.id, { kind: "document", label: d.title });
  for (const e of pack.emails ?? []) index.set(e.id, { kind: "email", label: `Email (${e.received_on})` });
  return index;
}

export function evidenceIds(pack: ContextPack): Set<string> {
  return new Set(evidenceIndex(pack).keys());
}

// Compact JSON for a prompt. This is our own data, so it is not wrapped as
// untrusted; only the pasted notes are.
export function packForPrompt(pack: ContextPack): string {
  return JSON.stringify(pack, null, 1);
}
