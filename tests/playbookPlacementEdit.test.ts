// The neutral starter only.
import { expect, it } from "vitest";
import { Playbook } from "@/lib/playbook/schema";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { playbookDiff } from "@/lib/playbook/diff";
import { suggestPlacement } from "@/lib/playbook/placement";
import { playbookProblems } from "@/lib/playbook/store";

const base = Playbook.parse(STARTER_PLAYBOOK);

it("refuses a score for a place to run that does not exist", () => {
  const bad = { ...STARTER_PLAYBOOK, placement: { ...STARTER_PLAYBOOK.placement!, criteria: [{ id: "x", name: "X", weight: 3, scores: { nowhere: 2 } }] } };
  expect(playbookProblems(bad)).toEqual(['placement.criteria.0.scores.nowhere: no place to run "nowhere"']);
});

it("says which part of the rubric changed, and a changed score changes the suggestion", () => {
  const rubric = base.placement!;
  const relevance = { speed: 3 };
  expect(suggestPlacement(rubric, relevance).best?.id).toBe("saas");
  const edited: Playbook = { ...base, placement: { ...rubric, criteria: rubric.criteria.map((c) => (c.id === "speed" ? { ...c, scores: { ...c.scores, saas: -2, "on-prem": 2 } } : c)) } };
  expect(playbookDiff(base, edited)).toEqual(["Placement rubric: placement scores changed"]);
  expect(suggestPlacement(edited.placement!, relevance).best?.id).toBe("on-prem");

  const renamed: Playbook = { ...base, placement: { ...rubric, options: rubric.options.map((o) => (o.id === "cloud" ? { ...o, name: "Synthetic cloud" } : o)) } };
  expect(playbookDiff(base, renamed)).toEqual(["Placement rubric: places to run changed"]);
  expect(playbookDiff(base, { ...base, placement: null })).toEqual(["Placement rubric removed"]);
});
