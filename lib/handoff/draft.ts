// Handoff writer's drafts. Two kinds, one shape: an opening paragraph and up
// to eight points, each citing the records it rests on.
//
//  - For another account team: the opening is what we need from them (the
//    "asks" field) and the points are what is worth knowing (the "note").
//    It fills the handoff form; the person edits and presses Create
//    (DECISIONS #24). The share link is still made only by that press (#28).
//  - For time off: a note to the partner covering what falls in the window,
//    shown on /handoff to copy or read. It writes nothing.
//
// Every id a point cites must be one the model was given, checked in code.
import { z } from "zod";
import type { StageUsage } from "../ai/cost";
import { UNTRUSTED_RULES } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";

export const HandoffDraft = z
  .object({
    opening: z.string().trim().min(10).max(900),
    points: z
      .array(
        z
          .object({
            text: z.string().trim().min(5).max(400),
            refs: z.array(z.string().trim().min(1)).min(1).max(4),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type HandoffDraft = z.infer<typeof HandoffDraft>;

export function readDraft(raw: unknown): HandoffDraft | null {
  const p = HandoffDraft.safeParse(raw);
  return p.success ? p.data : null;
}

const ACCOUNT_SYSTEM = `You draft the covering text of an account handoff from one sales team to another, from the account's own records, given as JSON.

${UNTRUSTED_RULES}

Produce:
- opening: what we need from the team taking this account, in two to four sentences, as the person handing over would say it. Concrete: who matters, what is live, what must not be dropped.
- points: up to eight things worth knowing that a new team would not see in the numbers — an open promise, a sensitive relationship, a decision pending, a risk. One sentence each.

Rules specific to this task:
- Each point cites, in refs, one to four ids from the JSON that it rests on (a deal_id, or a play, contact, action item, meeting or research note id). Something you cannot cite is left out.
- Never invent a person, a date, an amount or a commitment. Say what the records say.
- Write for a colleague, plainly. No marketing language.`;

const COVER_SYSTEM = `You draft a short note from one seller to their partner, who is covering for them while they are away. You are given, as JSON, what falls in that time: their follow-ups, their meetings, promises customers made, and plays whose next step is due.

${UNTRUSTED_RULES}

Produce:
- opening: two or three sentences: the dates, and what matters most while they are away.
- points: up to eight, the things the partner should actually do or watch, most important first. One sentence each, saying what and by when.

Rules specific to this task:
- Each point cites, in refs, one to four ids from the JSON it rests on.
- Never invent a person, a date, an amount or a commitment.
- Write as the person going away, to a colleague. No pleasantries beyond one line.`;

export function checkDraft(d: HandoffDraft, ids: Set<string>): Finding[] {
  const out: Finding[] = [];
  d.points.forEach((p, i) =>
    p.refs.forEach((r, j) => {
      if (!ids.has(r)) out.push({ path: `points[${i}].refs[${j}]`, message: `"${r}" is not an id in the records given. Cite only ids from the JSON.` });
    }),
  );
  return out;
}

export async function draftHandoff(input: { mode: "account" | "cover"; records: string; ids: Set<string>; heading: string }, stages: StageUsage[]): Promise<{ draft: HandoffDraft; attempts: number }> {
  const { data, attempts } = await runStructured({
    role: "handoff_draft",
    stageName: input.mode === "account" ? "handoff_account" : "handoff_cover",
    system: input.mode === "account" ? ACCOUNT_SYSTEM : COVER_SYSTEM,
    user: `${input.heading}\n\nRecords (JSON):\n${input.records}`,
    schema: HandoffDraft,
    effort: "medium",
    maxTokens: 3000,
    check: (d) => checkDraft(d, input.ids),
    fakeContext: { mode: input.mode, ids: [...input.ids], heading: input.heading },
    stages,
  });
  return { draft: data, attempts };
}

/** The draft as text for a textarea or the clipboard. */
export function draftText(d: HandoffDraft): { opening: string; points: string } {
  return { opening: d.opening, points: d.points.map((p) => `- ${p.text}`).join("\n") };
}
