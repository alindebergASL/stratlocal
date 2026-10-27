// Reading a team's own playbook document into the playbook shape.
//
// The document is the team's: it can name its company, products and people,
// and it stays inside AWS (Bedrock) and this app's database. What comes back
// is a draft a person reads and corrects before it is saved; nothing becomes
// the playbook on the model's say (DECISIONS #68).
import { z } from "zod";
import { BudgetError, runDetached, startRun } from "../ai/guard";
import { runStructured } from "../ai/runStructured";
import { UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { MEDDPICC, MEDDPICC_LABELS, Playbook } from "./schema";
import { playbookProblems } from "./store";

/** The most text read from one document; a playbook is a few pages. */
export const MAX_PLAYBOOK_TEXT = 120_000;

const SYSTEM = `You turn a sales team's playbook document into a structured playbook. Copy the team's own words; do not invent steps, archetypes, questions or names that are not in the document, and leave a field empty rather than guess.

${UNTRUSTED_RULES}

Fill:
- name and summary: the playbook's title and its core narrative or strategy, in its words.
- roles: each role on the team (id: short lowercase slug), with responsibilities and what it owns in meetings.
- steps: the lifecycle steps in order (id slug), each with its timebox, its output, the owner role id, a short detail, and a checklist of concrete things done in that step if the document lists them.
- archetypes: the customer types (id slug), with posture, pain, entry point (where the team starts with this type) and any messaging.
- movements: the stages of the discovery conversation (id slug), with their purpose.
- questions: every discovery question the document gives (id slug), with its movement id, its MEDDPICC element when the document tags one or it plainly asks about one (${MEDDPICC.map((m) => `${m} = ${MEDDPICC_LABELS[m]}`).join(", ")}), the personas it is for (e.g. CIO, CISO) and the archetype ids it suits. If the document gives no explicit questions for a movement, leave that movement without questions.
- workshop: the workshop agenda segments (id slug) with minutes, focus and lead role id.
- placement: if the document gives a way to decide where a workload runs, its options (id slug, name) and criteria with a weight from 1 to 5 and a score from -2 to 2 per option; otherwise null.
- budget_hints: what the document says about the customer's budget and approval calendar, or null.
Every id a field refers to must be one you defined.`;

export type PlaybookImportResult = { draft: Playbook; problems: string[] | null; chars: number; filename: string | null };

export function startPlaybookImport(input: { text: string; filename: string | null; userId: string }): string {
  const text = input.text.replace(/\r\n/g, "\n").trim().slice(0, MAX_PLAYBOOK_TEXT);
  if (text.length < 200) throw new BudgetError("That is too short to be a playbook. Paste or upload the whole document.");
  const run = startRun({ role: "import", kind: "playbook_import", accountId: null, userId: input.userId, inputSummary: `playbook document${input.filename ? ` ${input.filename.slice(0, 120)}` : ""} (${text.length} characters)` });
  runDetached(run.id, async (stages): Promise<PlaybookImportResult> => {
    const { data } = await runStructured({
      role: "import",
      stageName: "playbook_import",
      schema: Playbook as unknown as z.ZodType<Playbook>,
      stages,
      maxTokens: 16000,
      system: SYSTEM,
      user: `Read this playbook document.\n\n${wrapUntrusted("playbook document", text)}`,
      check: (p) => (playbookProblems(p) ?? []).map((m) => ({ path: m.split(":")[0]!, message: m })),
      fakeContext: { playbookText: text },
    });
    return { draft: data, problems: playbookProblems(data), chars: text.length, filename: input.filename };
  });
  return run.id;
}
