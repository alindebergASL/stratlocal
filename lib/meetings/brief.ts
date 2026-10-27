// The page to read in the ten minutes before a call. Every line cites a
// record; a citation the context pack does not contain is a finding the model
// is asked to fix, and a brief that still cites one is rejected rather than
// shown.
import type { StageUsage } from "../ai/cost";
import { UNTRUSTED_RULES } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";
import { packForPrompt, type ContextPack } from "./contextPack";
import { MeetingBrief } from "./briefSchema";
import { withDirection } from "../teamDirection";

const SYSTEM = `You write a short pre-meeting brief for a seller who has ten minutes before a customer call. You are given the account's records as JSON, the meeting's date and attendees, the notes of the last meetings before this one, the account's recent email, and any accepted research notes.

${UNTRUSTED_RULES}

Write for someone who knows the account. Be specific and short. Never pad a section: an empty section is better than a generic one.

The brief has two parts. "conversation" is what the seller reads in the ten minutes before the call; the sections after it are the detail behind it, and are also what the record keeps.

conversation:
- purpose: one sentence on why this meeting is happening, from what the records show. If the records do not say, describe what is open rather than inventing an agenda.
- facts: at most three facts that bear on this conversation. Each must cite a record. Fewer is right when only two matter; never pad to three. A fact is something the records state, not your summary of them.
- hypothesis: at most one, and only if it is worth saying out loud. It is a guess, and \`unknown\` must say what you do not know that would settle it. Never write a guess as a fact anywhere else.
- questions: at most three questions to ask in the room, specific enough that a generic answer would not satisfy them. Fewer is right when only one matters.
- connection: the tie between this meeting and a deal or a play, cited, and only when the records actually support it. If they do not, use null — the page then says the connection is not established, which is the honest answer. Never infer a deal from a research finding.
- uncertainty: one line naming the largest thing this brief could be wrong about, or null.

Sections:
- situation: at most three sentences on where this account stands right now.
- deals_in_play: one line per open deal that matters to this meeting: where it is, what it is worth, and what is actually blocking it.
- attendees: one entry per person attending. Use their contact_id when they are already on the account. Say what their role is, what position they took last time if a past meeting summary records one, and what they appear to care about. Leave a field null rather than guessing.
- changes_since_last: what moved since the previous meeting: the deal_moves in the JSON (stage, close date, value, next step), commitments kept or missed (open_action_items past their due date are missed; what the last meeting's notes or an email say was done is kept), what an email agreed or asked, new research. Empty if nothing did.
- questions: questions worth asking in this meeting, drawn from what is open or unknown. These are the only claims that may carry no source reference.
- risks: what could go wrong, where a competitor is active, what we would lose. Only what the records support.
- proposed_next_step: one concrete ask to land the meeting on, with the concern it addresses, an owner and a date if the records imply one, and the blocker if there is one.

Every claim except a question must carry at least one source_ref naming a record id from the JSON: a deal's deal_id, or a play, contact, action item, meeting, research, customer document or email id. Cite a past meeting's notes by that meeting's id, as a meeting, and an email by its email_id, as an email. Each source_ref's kind must match what that id actually is in the JSON. Do not cite an id that is not in the JSON. Do not invent quantities, dates, commercial intent, budget or vendor preference.

A research id names one finding taken from a public web page. Citing it says the finding says this; it does not make the finding true, and it is never on its own evidence of a deal, a budget or an intention. Keep whatever qualifier the finding carries — planned, proposed, reported, not found.

Meeting notes and email are what people wrote. Say what they say ("the email of 3 March asks for…"), not that it is settled; an email is never on its own evidence of a budget or a decision.`;

/**
 * `kinds` is what each id actually is. Given, a ref whose kind disagrees with
 * the pack is a finding the model is asked to fix — a research finding cited
 * as a deal is a different claim than the one the records support, and the
 * page would refuse to link it. Omitted, the check behaves as it always has.
 */
export function checkBrief(brief: MeetingBrief, ids: Set<string>, kinds?: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  const refs = (path: string, list: Array<{ kind: string; id: string }>, requireOne: boolean) => {
    if (requireOne && list.length === 0) findings.push({ path, message: "needs at least one source_ref naming a record id from the JSON" });
    list.forEach((r, i) => {
      if (!ids.has(r.id)) {
        findings.push({ path: `${path}[${i}].id`, message: `"${r.id}" is not a record id you were given; cite an id from the JSON or drop the claim` });
        return;
      }
      const actual = kinds?.get(r.id);
      if (actual && actual !== r.kind) {
        findings.push({ path: `${path}[${i}].kind`, message: `"${r.id}" is a ${actual} in the JSON, not a ${r.kind}; cite it as a ${actual} or drop the claim` });
      }
    });
  };
  for (const key of ["situation", "deals_in_play", "changes_since_last", "risks"] as const) {
    brief[key].forEach((c, i) => refs(`${key}[${i}].source_refs`, c.source_refs, true));
  }
  brief.questions.forEach((c, i) => refs(`questions[${i}].source_refs`, c.source_refs, false));
  brief.attendees.forEach((a, i) => {
    refs(`attendees[${i}].source_refs`, a.source_refs, false);
    if (a.contact_id && !ids.has(a.contact_id)) {
      findings.push({ path: `attendees[${i}].contact_id`, message: `"${a.contact_id}" is not a contact you were given; leave it null for someone new` });
    }
  });
  brief.proposed_next_step.evidence_ids.forEach((id, i) => {
    if (!ids.has(id)) findings.push({ path: `proposed_next_step.evidence_ids[${i}]`, message: `"${id}" is not a record id you were given` });
  });
  const c = brief.conversation;
  if (c) {
    c.facts.forEach((f, i) => refs(`conversation.facts[${i}].source_refs`, f.source_refs, true));
    // A hypothesis is the one place a guess is allowed, so what it rests on is
    // checked like everything else even though it may rest on nothing.
    if (c.hypothesis) refs("conversation.hypothesis.based_on", c.hypothesis.based_on, false);
    if (c.connection) {
      refs("conversation.connection.source_refs", c.connection.source_refs, true);
      // The connection is the claim "this meeting is about that deal". A
      // research finding is a public-web statement and cannot establish one on
      // its own, so a connection citing only research is not a connection —
      // null is the answer, and the page says so.
      const supported = c.connection.source_refs.some((r) => {
        const actual = kinds?.get(r.id) ?? r.kind;
        return actual === "deal" || actual === "play";
      });
      if (!supported) {
        findings.push({
          path: "conversation.connection.source_refs",
          message: "a connection must cite the deal or play it connects to; use null when the records do not establish one",
        });
      }
    }
  }
  return findings;
}

export type BriefInput = {
  pack: ContextPack;
  ids: Set<string>;
  /** What each of those ids is, so a ref of the wrong kind is caught here. */
  kinds?: Map<string, string>;
  title: string;
  heldAt: string;
  attendees: Array<{ contact_id: string | null; name: string; note?: string | null }>;
  // Built by researchForPrompt: accepted research, already wrapped as
  // untrusted because it was written from public web pages.
  researchBlock?: string;
  /** The team's own direction (lib/teamDirection.ts); empty means none. */
  direction?: string;
};

export async function generateBrief(input: BriefInput, stages: StageUsage[]): Promise<{ brief: MeetingBrief; attempts: number }> {
  const user = [
    `Account records:\n${packForPrompt(input.pack)}`,
    `The meeting: ${JSON.stringify({ title: input.title, held_at: input.heldAt, attendees: input.attendees })}`,
    input.researchBlock || null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data, attempts } = await runStructured({
    role: "brief",
    stageName: "meeting_brief",
    system: withDirection(SYSTEM, input.direction ?? ""),
    user,
    schema: MeetingBrief,
    effort: "high",
    maxTokens: 12000,
    check: (parsed) => checkBrief(parsed, input.ids, input.kinds),
    fakeContext: { pack: input.pack },
    stages,
  });
  return { brief: data, attempts };
}
