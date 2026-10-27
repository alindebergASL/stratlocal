// Asks the model to turn everything on file into a small number of named
// plays, then checks that every id it cited is one we actually gave it.
import type { StageUsage } from "../ai/cost";
import { UNTRUSTED_RULES } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";
import { packForPrompt, evidenceIndex, type EvidenceEntry, type ContextPack } from "../meetings/contextPack";
import { PlanDraft } from "./schema";
import { withDirection } from "../teamDirection";

const SYSTEM = `You draft an account plan for two sellers who already know this account. You are given its records as JSON — deals, plays, people, follow-ups, recent meetings, install base — and any accepted research notes.

${UNTRUSTED_RULES}

Produce:
- thesis: three or four sentences on how this account is won. What they are trying to do, where we already are, and what has to be true for the next year to go our way. Concrete and specific to these records; a sentence that would be true of any account is a wasted one.
- plays: zero to six. Return zero and an explicit insufficient-evidence/discovery-only thesis when evidence is thin. Public research does not imply a sales commitment. Preserve planned vs approved qualifiers; past targets are not proof of completion. A play is a named piece of work with an owner and a next step, not a theme. Each carries:
  - title: short and recognisable, the way someone would refer to it out loud.
  - thesis: what we are trying to achieve here and why it is winnable, in two or three sentences.
  - next_step: the one thing that moves it, specific enough to do this week. Null if the records genuinely do not support one.
  - owner_suggestion: a name from the records if one is the obvious owner, otherwise null. Never invent a person.
  - linked_deal_ids: the deal ids this play covers, copied from the JSON.
  - linked_contact_ids: the people this play turns on, copied from the JSON.
  - source_refs: at least one record id this play is built on. Cite a deal's deal_id, or a play, contact, action item, meeting, research note or customer document id.

Rules that matter:
- Cite only ids that appear in the material you were given. Do not invent an id, a deal, a person or a date.
- Where an existing play already covers a piece of work, keep its exact title. It will be updated rather than duplicated.
- Cover the account: the large deals, whatever is stalled, and the ground the research says is moving. Do not write six plays about the same deal.
- Do not propose retiring a play, and do not propose that we have already won something. Say what the records support and stop there.`;

export type PlanDraftOutcome = { draft: PlanDraft; attempts: number };

export function checkPlanDraft(draft: PlanDraft, ids: Map<string, EvidenceEntry>): Finding[] {
  const findings: Finding[] = [];
  draft.plays.forEach((p, i) => {
    p.linked_deal_ids.forEach((id, j) => {
      if (!ids.has(id))
        findings.push({
          path: `plays[${i}].linked_deal_ids[${j}]`,
          message: `"${id}" is not a record id you were given; cite an id from the JSON or drop it`,
        });
    });
    p.linked_contact_ids.forEach((id, j) => {
      if (!ids.has(id))
        findings.push({
          path: `plays[${i}].linked_contact_ids[${j}]`,
          message: `"${id}" is not a record id you were given; cite an id from the JSON or drop it`,
        });
    });
    p.source_refs.forEach((r, j) => {
      if (ids.has(r.id) && ids.get(r.id)?.kind !== r.kind)
        findings.push({
          path: `plays[${i}].source_refs[${j}].kind`,
          message: "Citation kind does not match the supplied record",
        });
      if (!ids.has(r.id))
        findings.push({
          path: `plays[${i}].source_refs[${j}].id`,
          message: `"${r.id}" is not a record id you were given; cite an id from the JSON or drop the play`,
        });
    });
  });
  // Two plays with the same title would become one create and one update of
  // the row the first one made, which is not what anybody asked for.
  const seen = new Map<string, number>();
  draft.plays.forEach((p, i) => {
    const key = p.title.trim().toLowerCase();
    const first = seen.get(key);
    if (first !== undefined)
      findings.push({
        path: `plays[${i}].title`,
        message: `"${p.title}" repeats plays[${first}]; give each play a distinct title or merge them`,
      });
    else seen.set(key, i);
  });
  return findings;
}

export async function generatePlanDraft(input: { pack: ContextPack; ids: Set<string>; researchBlock?: string; direction?: string }, stages: StageUsage[]): Promise<PlanDraftOutcome> {
  const user = [`Account records:\n${packForPrompt(input.pack)}`, input.researchBlock || null].filter(Boolean).join("\n\n");
  const { data, attempts } = await runStructured({
    role: "plan_draft",
    stageName: "plan_draft",
    // The team's direction shapes which plays are worth proposing; a play
    // the records support but the direction does not cover is still offered,
    // and says so (lib/teamDirection.ts).
    system: withDirection(SYSTEM, input.direction ?? ""),
    user,
    schema: PlanDraft,
    effort: "high",
    maxTokens: 12000,
    check: (parsed) => checkPlanDraft(parsed, evidenceIndex(input.pack)),
    fakeContext: { pack: input.pack },
    stages,
  });
  return { draft: data, attempts };
}
