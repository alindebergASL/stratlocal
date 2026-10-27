// What the top of the meeting page shows, worked out from the stored brief.
//
// Two kinds of brief arrive here. One was written after the conversation view
// existed and carries it. The other was written before, and has only the long
// sections — so this selects from what that brief actually says and marks the
// result as selected. It never invents a purpose, a hypothesis or an
// uncertainty for a brief that has none: the page says the brief does not
// record one, which is true, and the whole of the old brief is still one
// disclosure away.
import type { Claim, EvidenceRef, MeetingBrief } from "./briefSchema";

export type FactView = { text: string; refs: EvidenceRef[] };

export type ConversationView = {
  /** True when the brief itself carried the conversation view. */
  written: boolean;
  purpose: string | null;
  facts: FactView[];
  /** True when the facts were selected from the long sections rather than written as facts. */
  factsSelected: boolean;
  hypothesis: { text: string; unknown: string; refs: EvidenceRef[] } | null;
  questions: FactView[];
  questionsSelected: boolean;
  connection: FactView | null;
  connectionSelected: boolean;
  uncertainty: string | null;
  nextStep: MeetingBrief["proposed_next_step"];
};

const MAX_FACTS = 3;
const MAX_QUESTIONS = 3;

function claimView(c: Claim): FactView {
  return { text: c.text, refs: c.source_refs };
}

// Selection, not invention: a claim the brief already makes, which already
// carries at least one citation. Order is the order a person reads them in —
// where we stand, then the deals, then what moved, then what could go wrong.
function selectFacts(brief: MeetingBrief): FactView[] {
  const seen = new Set<string>();
  const out: FactView[] = [];
  for (const claim of [...brief.situation, ...brief.deals_in_play, ...brief.changes_since_last, ...brief.risks]) {
    if (out.length >= MAX_FACTS) break;
    if (claim.source_refs.length === 0) continue;
    const key = claim.text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(claimView(claim));
  }
  return out;
}

function selectConnection(brief: MeetingBrief): FactView | null {
  const supported = brief.deals_in_play.find((c) => c.source_refs.some((r) => r.kind === "deal" || r.kind === "play"));
  return supported ? claimView(supported) : null;
}

export function conversationView(brief: MeetingBrief): ConversationView {
  const written = brief.conversation ?? null;
  if (written) {
    return {
      written: true,
      purpose: written.purpose,
      facts: written.facts.slice(0, MAX_FACTS).map((f) => ({ text: f.text, refs: f.source_refs })),
      factsSelected: false,
      hypothesis: written.hypothesis ? { text: written.hypothesis.text, unknown: written.hypothesis.unknown, refs: written.hypothesis.based_on } : null,
      questions: written.questions.slice(0, MAX_QUESTIONS).map((text) => ({ text, refs: [] })),
      questionsSelected: false,
      connection: written.connection ? { text: written.connection.text, refs: written.connection.source_refs } : null,
      connectionSelected: false,
      uncertainty: written.uncertainty,
      nextStep: brief.proposed_next_step,
    };
  }
  return {
    written: false,
    // No purpose was recorded. The page says so rather than deriving one from
    // the meeting's title, which would be the app putting words in the
    // brief's mouth.
    purpose: null,
    facts: selectFacts(brief),
    factsSelected: true,
    hypothesis: null,
    questions: brief.questions.slice(0, MAX_QUESTIONS).map(claimView),
    questionsSelected: true,
    connection: selectConnection(brief),
    connectionSelected: true,
    uncertainty: null,
    nextStep: brief.proposed_next_step,
  };
}

/** Every ref the brief cites anywhere, so one resolver pass covers the page. */
export function briefRefs(brief: MeetingBrief): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const c = brief.conversation;
  if (c) {
    for (const f of c.facts) refs.push(...f.source_refs);
    if (c.hypothesis) refs.push(...c.hypothesis.based_on);
    if (c.connection) refs.push(...c.connection.source_refs);
  }
  for (const key of ["situation", "deals_in_play", "changes_since_last", "questions", "risks"] as const) {
    for (const claim of brief[key]) refs.push(...claim.source_refs);
  }
  for (const a of brief.attendees) refs.push(...a.source_refs);
  return refs;
}

/**
 * Roughly how long this takes to read, said in the honest direction: the whole
 * conversation view, at the speed people read a screen standing up.
 */
export function readingMinutes(view: ConversationView): number {
  const words = [
    view.purpose ?? "",
    ...view.facts.map((f) => f.text),
    view.hypothesis ? `${view.hypothesis.text} ${view.hypothesis.unknown}` : "",
    ...view.questions.map((q) => q.text),
    view.connection?.text ?? "",
    view.uncertainty ?? "",
    view.nextStep.action,
    view.nextStep.concern,
  ]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 180));
}

/** Missing entry fields only; never a quality score or an inferred finding. */
export function briefEntryGaps(view: ConversationView): string[] {
  return [!view.purpose && "purpose", !view.facts.length && "cited facts", !view.hypothesis && "hypothesis", !view.questions.length && "questions", !view.connection && "deal or play connection", !view.uncertainty && "uncertainty note"].filter((v): v is string => typeof v === "string");
}
