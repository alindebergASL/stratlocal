// Pure: a sanitized extraction plus what the account already holds -> proposal
// drafts. No database access, so the mapping is exhaustively testable.
import type { ProposalDraft, SourceRef } from "../proposals/schema";
import type { ContextPack } from "./contextPack";
import type { MeetingExtraction } from "./extractSchema";

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return (a ?? null) === (b ?? null);
}

export type MeetingSource = {
  meetingId: string;
  currentSummary: string | null;
  // The two of us, so a follow-up the notes say is mine can be filed as mine
  // rather than as the string "Alex". Anything that is not one of us — a
  // customer's name, a first name shared by nobody here — leaves the link null
  // and keeps the text, which is what `owner` has always been for.
  users?: Array<{ id: string; name: string }>;
  /** The account's scorecard as it stands, when the team has a playbook. */
  qualification?: { accountId: string; rows: Array<{ element: string; field: string; label: string; status: string; evidence: string }> };
};

const RANK: Record<string, number> = { unknown: 0, partial: 1, confirmed: 2 };

// Only an unambiguous match counts. "Alex" against one Alex is a person;
// against two it is a guess, and a guess here silently files someone else's
// work under your name.
export function ownerUserId(owner: string | null, users: Array<{ id: string; name: string }>): string | null {
  const said = (owner ?? "").trim().toLowerCase();
  if (!said) return null;
  const hit = users.filter((u) => {
    const name = u.name.trim().toLowerCase();
    return name === said || name.split(/\s+/)[0] === said;
  });
  return hit.length === 1 ? hit[0]!.id : null;
}

export function diffMeetingExtraction(x: MeetingExtraction, pack: ContextPack, source: MeetingSource): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const ref = (quote: string): SourceRef => ({ kind: "meeting", id: source.meetingId, quote });

  if (x.summary.trim() && !same(x.summary, source.currentSummary)) {
    drafts.push({
      entity_type: "meeting",
      op: "update",
      entity_id: source.meetingId,
      payload: { summary: x.summary.trim() },
      rationale: "Summary of what happened, from the notes",
      source_ref: { kind: "meeting", id: source.meetingId },
    });
  }

  for (const a of x.action_items) {
    drafts.push({
      entity_type: "action_item",
      op: "create",
      payload: {
        text: a.text,
        owner: a.owner,
        owner_user_id: ownerUserId(a.owner, source.users ?? []),
        due: a.due,
        status: "open",
        meeting_id: source.meetingId,
        source_ref: ref(a.quote),
      },
      rationale: "Committed to in the meeting",
      source_ref: ref(a.quote),
    });
  }

  const dealById = new Map(pack.deals.map((d) => [d.deal_id, d]));
  for (const d of x.deal_updates) {
    const current = dealById.get(d.deal_id);
    if (!current) continue; // sanitize already dropped unknown ids; belt and braces
    const patch: Record<string, unknown> = {};
    if (d.stage !== null && !same(d.stage, current.stage)) patch.stage = d.stage;
    if (d.next_step !== null && !same(d.next_step, current.next_step)) patch.next_step = d.next_step;
    if (d.notes !== null && d.notes.trim()) patch.notes = d.notes;
    if (Object.keys(patch).length === 0) continue;
    drafts.push({
      entity_type: "deal",
      op: "update",
      entity_id: d.deal_id,
      payload: patch,
      rationale: `The notes change ${Object.keys(patch).join(", ")} on ${current.name}`,
      source_ref: ref(d.quote),
    });
  }

  const playById = new Map(pack.plays.map((p) => [p.id, p]));
  for (const p of x.play_updates) {
    const current = playById.get(p.play_id);
    if (!current) continue;
    const patch: Record<string, unknown> = {};
    if (p.status !== null && !same(p.status, current.status)) patch.status = p.status;
    if (p.next_step !== null && !same(p.next_step, current.next_step)) patch.next_step = p.next_step;
    if (Object.keys(patch).length === 0) continue;
    drafts.push({
      entity_type: "play",
      op: "update",
      entity_id: p.play_id,
      payload: patch,
      rationale: `The notes change ${Object.keys(patch).join(", ")} on "${current.title}"`,
      source_ref: ref(p.quote),
    });
  }

  const contactById = new Map(pack.contacts.map((c) => [c.id, c]));
  for (const c of x.contact_updates) {
    if (c.contact_id) {
      const current = contactById.get(c.contact_id);
      if (!current) continue;
      const patch: Record<string, unknown> = {};
      if (c.title && !same(c.title, current.title)) patch.title = c.title;
      if (c.role && !same(c.role, current.role)) patch.role = c.role;
      if (c.notes && c.notes.trim()) patch.notes = c.notes;
      if (Object.keys(patch).length === 0) continue;
      drafts.push({
        entity_type: "contact",
        op: "update",
        entity_id: c.contact_id,
        payload: patch,
        rationale: `The notes tell us more about ${current.name}`,
        source_ref: ref(c.quote),
      });
      continue;
    }
    // Someone the account has not met before. A person is the only record a
    // meeting may create besides a follow-up.
    drafts.push({
      entity_type: "contact",
      op: "create",
      payload: { name: c.name, title: c.title, role: c.role, org: c.org ?? "customer", notes: c.notes },
      rationale: "Mentioned in the meeting and not yet on the account",
      source_ref: ref(c.quote),
    });
  }

  // Qualification moves forward only: notes that merely point at something
  // already confirmed do not take it back to partial.
  if (source.qualification) {
    const rows = new Map(source.qualification.rows.map((r) => [r.element, r]));
    for (const q of x.qualification ?? []) {
      const row = rows.get(q.element);
      if (!row) continue;
      if (RANK[q.status]! < RANK[row.status]!) continue;
      if (q.status === row.status && same(q.evidence, row.evidence)) continue;
      drafts.push({
        entity_type: "account",
        op: "update",
        entity_id: source.qualification.accountId,
        payload: { [row.field]: { status: q.status, evidence: q.evidence.trim() } },
        rationale: `The notes bear on ${row.label}`,
        source_ref: ref(q.quote),
      });
    }
  }

  return drafts;
}
