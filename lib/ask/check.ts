// What a piece of Ask's writing may cite: only what a tool returned this turn.
import type { CitableSet } from "./tools";

type Cited = { text: string; citations: Array<{ n: number; kind: string; id: string }> };

/** Problems with an answer or a report against what the turn was shown. */
export function checkAnswer(answer: Cited, cites: CitableSet): string[] {
  const problems: string[] = [];
  for (const c of answer.citations) if (!cites.get(c.kind, c.id)) problems.push(`[${c.n}] cites ${c.kind} ${c.id}, which no tool returned in this turn.`);
  const listed = new Set(answer.citations.map((c) => c.n));
  for (const m of answer.text.matchAll(/\[(\d{1,3})\]/g)) if (!listed.has(Number(m[1]))) problems.push(`The text uses [${m[1]}] but citations has no entry for it.`);
  return [...new Set(problems)];
}
