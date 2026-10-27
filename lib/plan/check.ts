// The monthly thesis check: does what was said in recent meetings sit
// against the account thesis anywhere? It asks; it never rewrites. Every
// claim must be quoted from the thesis and every quote copied from a meeting's
// notes, both checked in code, so a question always points at two real
// sentences a person can read side by side (DECISIONS #44).
import { z } from "zod";
import type { StageUsage } from "../ai/cost";
import { containsQuote, UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";

export const Tension = z
  .object({
    thesis_claim: z.string().trim().min(8).max(400),
    meeting_id: z.string().trim().min(1).max(80),
    quote: z.string().trim().min(8).max(600),
    question: z.string().trim().min(8).max(300),
  })
  .strict();
export type Tension = z.infer<typeof Tension>;

export const ThesisCheck = z
  .object({
    tensions: z.array(Tension).max(3),
    holds: z.string().max(400),
  })
  .strict();
export type ThesisCheck = z.infer<typeof ThesisCheck>;

const SYSTEM = `You help two sellers keep an account plan honest. You are given the account thesis, written by them, and the notes from their recent meetings with the customer.

${UNTRUSTED_RULES}

Find where something said in a meeting sits against the thesis: a stated priority that has moved, a budget or timeline that no longer fits, a person the thesis relies on who has changed, a reason to believe that the notes contradict.

Produce:
- tensions: zero to three. Each one:
  - thesis_claim: a sentence or clause copied verbatim from the thesis.
  - meeting_id: the id of the meeting whose notes say otherwise.
  - quote: a sentence copied verbatim from that meeting's notes.
  - question: one short question for the sellers, neutral, that the two quotes raise. Not advice and not a rewrite.
- holds: when nothing sits against the thesis, one sentence saying so; otherwise an empty string.

Rules specific to this task:
- Quote exactly. Something you cannot quote from both sides is not a tension.
- Never propose new wording for the thesis. The strategy is theirs; you only point at the evidence.
- Agreement is not a tension. Leave out anything that merely supports the thesis.`;

export type CheckInput = { accountName: string; thesis: string; meetings: Array<{ id: string; title: string; heldAt: string; notes: string }> };

export function checkThesisCheck(c: ThesisCheck, input: Pick<CheckInput, "thesis" | "meetings">): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(input.meetings.map((m) => [m.id, m]));
  c.tensions.forEach((t, i) => {
    if (!containsQuote(input.thesis, t.thesis_claim)) out.push({ path: `tensions[${i}].thesis_claim`, message: "This is not in the thesis. Copy a sentence or clause from it verbatim." });
    const m = byId.get(t.meeting_id);
    if (!m) out.push({ path: `tensions[${i}].meeting_id`, message: "That meeting id was not given. Use one from the list." });
    else if (!containsQuote(m.notes, t.quote)) out.push({ path: `tensions[${i}].quote`, message: "This quote is not in that meeting's notes. Copy it verbatim." });
  });
  return out;
}

export async function runThesisCheck(input: CheckInput, stages: StageUsage[]): Promise<{ check: ThesisCheck; attempts: number }> {
  const user = [
    `Account: ${input.accountName}`,
    "",
    "Thesis (written by the sellers):",
    input.thesis,
    "",
    ...input.meetings.map((m) => wrapUntrusted("meeting_notes", m.notes, { meeting_id: m.id, meeting_title: m.title, held_at: m.heldAt })),
  ].join("\n");
  const { data, attempts } = await runStructured({
    role: "plan_check",
    stageName: "thesis_check",
    system: SYSTEM,
    user,
    schema: ThesisCheck,
    effort: "medium",
    maxTokens: 3000,
    check: (c) => checkThesisCheck(c, input),
    fakeContext: { thesis: input.thesis, meetings: input.meetings.map((m) => ({ id: m.id, notes: m.notes })) },
    stages,
  });
  return { check: data, attempts };
}
