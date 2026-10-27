// Where a use case should run, worked out from the playbook's rubric rather
// than asserted: each criterion has a weight and a score per option, the
// workshop says how much each criterion applies to the use case (0 to 3),
// and the option with the highest total is the suggestion, with the
// criteria that decided it.
import type { Playbook } from "./schema";

type Rubric = NonNullable<Playbook["placement"]>;

export type Placement = {
  best: { id: string; name: string } | null;
  totals: Array<{ id: string; name: string; score: number }>;
  /** The criteria that pushed toward the suggestion, largest first. */
  why: Array<{ criterion: string; contribution: number }>;
};

export function suggestPlacement(rubric: Rubric, relevance: Record<string, number>): Placement {
  const totals = rubric.options.map((o) => ({
    id: o.id,
    name: o.name,
    score: rubric.criteria.reduce((s, c) => s + c.weight * (relevance[c.id] ?? 0) * (c.scores[o.id] ?? 0), 0),
  }));
  const ranked = [...totals].sort((a, b) => b.score - a.score);
  // Nothing rated, or a tie at the top: no suggestion rather than a coin toss.
  if (!ranked[0] || ranked[0].score <= 0 || (ranked[1] && ranked[1].score === ranked[0].score)) return { best: null, totals, why: [] };
  const best = ranked[0];
  const why = rubric.criteria
    .map((c) => ({ criterion: c.name, contribution: c.weight * (relevance[c.id] ?? 0) * (c.scores[best.id] ?? 0) }))
    .filter((w) => w.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);
  return { best: { id: best.id, name: best.name }, totals, why };
}
