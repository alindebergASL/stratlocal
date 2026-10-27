// What changed between two versions of a playbook, said in a line per
// section: added, removed and changed items, by their ids.
import type { Playbook } from "./schema";

type Listed = "roles" | "steps" | "archetypes" | "movements" | "questions" | "workshop";
const LISTS: Array<[Listed, string]> = [
  ["roles", "role"],
  ["steps", "step"],
  ["archetypes", "archetype"],
  ["movements", "movement"],
  ["questions", "question"],
  ["workshop", "workshop segment"],
];

const n = (k: number, what: string) => `${k} ${what}${k === 1 ? "" : "s"}`;

export function playbookDiff(before: Playbook | null, after: Playbook): string[] {
  if (!before) return ["First version"];
  const out: string[] = [];
  if (before.name !== after.name) out.push(`Renamed to “${after.name}”`);
  if (before.summary !== after.summary) out.push("Summary changed");
  for (const [key, what] of LISTS) {
    const a = new Map((before[key] as Array<{ id: string }>).map((x) => [x.id, JSON.stringify(x)]));
    const b = new Map((after[key] as Array<{ id: string }>).map((x) => [x.id, JSON.stringify(x)]));
    const added = [...b.keys()].filter((id) => !a.has(id)).length;
    const removed = [...a.keys()].filter((id) => !b.has(id)).length;
    const changed = [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id)).length;
    const parts = [added && `${n(added, what)} added`, removed && `${n(removed, what)} removed`, changed && `${n(changed, what)} changed`].filter(Boolean);
    if (parts.length) out.push(parts.join(", "));
  }
  if (JSON.stringify(before.placement) !== JSON.stringify(after.placement)) {
    const b = before.placement;
    const a = after.placement;
    if (!b || !a) out.push(a ? "Placement rubric added" : "Placement rubric removed");
    else {
      const parts: string[] = [];
      if (JSON.stringify(b.options) !== JSON.stringify(a.options)) parts.push("places to run changed");
      const shape = (r: typeof a) => JSON.stringify(r.criteria.map((c) => [c.id, c.name, c.weight]));
      if (shape(b) !== shape(a)) parts.push("criteria changed");
      const scores = (r: typeof a) => JSON.stringify(r.criteria.map((c) => [c.id, c.scores]));
      if (scores(b) !== scores(a)) parts.push("placement scores changed");
      out.push(`Placement rubric: ${parts.join(", ") || "changed"}`);
    }
  }
  if (before.budget_hints !== after.budget_hints) out.push("Budget calendar changed");
  return out.length ? out : ["No change"];
}
