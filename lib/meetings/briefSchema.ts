import { z } from "zod";

export const EvidenceRef = z
  .object({
    kind: z.enum(["deal", "play", "contact", "action_item", "meeting", "research", "document", "account", "email"]),
    id: z.string().min(1),
  })
  .strict();
export type EvidenceRef = z.infer<typeof EvidenceRef>;

// Everything the brief asserts points at a record we gave the model. The refs
// are checked against the context pack before the brief is ever shown.
export const Claim = z
  .object({ text: z.string().min(1).max(700), source_refs: z.array(EvidenceRef).max(6) })
  .strict();
export type Claim = z.infer<typeof Claim>;

export const BriefAttendee = z
  .object({
    contact_id: z.string().nullable(),
    name: z.string().min(1).max(200),
    role_note: z.string().max(300).nullable(),
    last_position: z.string().max(500).nullable(),
    cares_about: z.string().max(500).nullable(),
    source_refs: z.array(EvidenceRef).max(6),
  })
  .strict();

export const ProposedNextStep = z
  .object({
    concern: z.string().min(1).max(500),
    action: z.string().min(1).max(500),
    owner: z.string().max(200).nullable(),
    target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    blocker: z.string().max(500).nullable(),
    evidence_ids: z.array(z.string()).max(10),
  })
  .strict();

// The part of the brief a person actually reads standing outside the room:
// why the meeting is happening, the few facts that bear on it, what we are
// only guessing, what to ask, and the one thing to land. It is optional and
// additive — every brief written before it exists parses and renders exactly
// as it did, and the long sections below are still where the detail lives.
export const ConversationFact = z
  .object({
    text: z.string().min(1).max(300),
    // A fact in this view is only here because a record supports it, so unlike
    // a legacy claim it cannot be written without one.
    source_refs: z.array(EvidenceRef).min(1).max(3),
  })
  .strict();
export type ConversationFact = z.infer<typeof ConversationFact>;

// Labelled as a guess in the schema, not only in the prose: `unknown` is what
// would settle it, and is required, so a hypothesis can never be stated as a
// finding with a softening adverb.
export const ConversationHypothesis = z
  .object({
    text: z.string().min(1).max(400),
    unknown: z.string().min(1).max(400),
    based_on: z.array(EvidenceRef).max(3),
  })
  .strict();
export type ConversationHypothesis = z.infer<typeof ConversationHypothesis>;

export const BriefConversation = z
  .object({
    purpose: z.string().min(1).max(300),
    facts: z.array(ConversationFact).max(3),
    hypothesis: ConversationHypothesis.nullable(),
    questions: z.array(z.string().min(1).max(300)).max(3),
    // The tie to a deal or a play, when the records carry one. Null is a real
    // answer and the page says so in words: no connection was established.
    connection: ConversationFact.nullable(),
    uncertainty: z.string().min(1).max(400).nullable(),
  })
  .strict();
export type BriefConversation = z.infer<typeof BriefConversation>;

export const MeetingBrief = z
  .object({
    conversation: BriefConversation.nullable().optional(),
    situation: z.array(Claim).max(5),
    deals_in_play: z.array(Claim).max(12),
    attendees: z.array(BriefAttendee).max(15),
    changes_since_last: z.array(Claim).max(8),
    questions: z.array(Claim).max(8),
    risks: z.array(Claim).max(8),
    proposed_next_step: ProposedNextStep,
  })
  .strict();

export type MeetingBrief = z.infer<typeof MeetingBrief>;

// The stored column, read back. A brief that will not parse — a hand-edited
// row, or one written by a schema this build no longer has — is `null`, the
// same answer as "no brief", and never an exception: three callers used to
// `JSON.parse` the column bare, and a corrupt row took a page or an action
// down with a SyntaxError that nothing upstream was written to catch.
export function readStoredBrief(json: string | null | undefined): MeetingBrief | null {
  if (!json) return null;
  try {
    const parsed = MeetingBrief.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Sections rendered in this order, with the label the page shows.
export const BRIEF_SECTIONS: Array<{ key: "situation" | "deals_in_play" | "changes_since_last" | "questions" | "risks"; label: string }> = [
  { key: "situation", label: "Where we stand" },
  { key: "deals_in_play", label: "Deals in play" },
  { key: "changes_since_last", label: "What changed since last time" },
  { key: "questions", label: "Questions to ask" },
  { key: "risks", label: "Risks" },
];
