// The account through the playbook, as Ask's playbook tool returns it: what
// the team believes, where the account is, what is left and what is next.
import type { AccountRow } from "../db";
import type { Citable } from "../ask/tools";
import { currentPlaybook } from "./store";
import { archetypeOf } from "./archetype";
import { lifecycle } from "./lifecycle";
import { qualificationGaps, scorecard } from "./qualification";
import { discoveryGuide } from "./discovery";
import { getWorkshop } from "./workshop";
import { suggestPlacement } from "./placement";
import { nextFiscalStart, roadmap } from "./roadmap";
import { dossier } from "./dossier";
import { playbookOutcomes } from "./outcomes";

export function playbookForAsk(account: AccountRow, today: string, remember?: (record: Citable) => void): unknown {
  const playbook = currentPlaybook({ accountId: account.id })?.playbook;
  if (!playbook) return { error: "The team has no playbook yet; it is set up under Settings, Playbook." };
  const archetype = archetypeOf(playbook, account.archetype_id ?? null);
  const life = lifecycle(account.id, playbook);
  const card = scorecard(account);
  const gaps = qualificationGaps(card);
  const { workshop } = getWorkshop(account.id);
  const map = roadmap(account.id);
  // Register the same rows whose prose is exposed below, even if the answer
  // cites only the account. Ask's retained read state keeps first observation.
  for (const phase of map.phases) for (const play of phase.plays) {
    remember?.({ kind: "play", id: play.id, accountId: play.account_id, label: play.title });
  }
  for (const item of map.milestones) {
    remember?.({ kind: "action_item", id: item.id, accountId: item.account_id, label: item.text });
    remember?.({ kind: "play", id: item.play.id, accountId: item.play.account_id, label: item.play.title });
  }
  return {
    playbook: playbook.name,
    archetype: archetype ? { name: archetype.name, posture: archetype.posture, pain: archetype.pain, entry_point: archetype.entry_point, hypothesis: account.archetype_hypothesis ?? null } : null,
    archetypes_to_choose_from: archetype ? undefined : playbook.archetypes.map((a) => a.name),
    lifecycle: life.current
      ? {
          step: `${life.current.index + 1} of ${life.steps.length}: ${life.current.step.name}`,
          output: life.current.step.output,
          timebox: life.current.step.timebox,
          on_step_since: life.since ? new Date(life.since).toISOString().slice(0, 10) : null,
          still_to_do: life.current.checks.filter((c) => c.doneAt === null).map((c) => c.item),
          next: life.next?.text ?? null,
          next_step: life.steps[life.current.index + 1]?.step.name ?? null,
        }
      : { step: "not started", first_step: playbook.steps[0]?.name ?? null },
    qualification: card.map((r) => ({ element: r.label, status: r.status, evidence: r.evidence || null })),
    still_to_find_out: gaps.map((g) => card.find((r) => r.element === g)!.label),
    discovery_questions: discoveryGuide(playbook, { archetypeId: archetype?.id ?? null, attendees: [], gaps }).map((g) => ({ movement: g.movement.name, questions: g.questions.map((q) => q.text) })),
    workshop: {
      date: workshop.date,
      use_cases: workshop.use_cases.map((u) => {
        const placed = playbook.placement ? suggestPlacement(playbook.placement, u.relevance) : null;
        return { name: u.name, department: u.department || null, value: u.value, feasibility: u.feasibility, run: placed?.best?.name ?? null, because: placed?.why.map((w) => w.criterion) ?? [], phase: u.phase };
      }),
    },
    roadmap: map.phases.map((p) => ({ phase: p.phase, plays: p.plays.map((x) => x.title) })),
    action_plan: map.milestones.map((m) => ({ milestone: m.text, due: m.due, status: m.status, for: m.play.title })),
    budget: { fiscal_year_starts: nextFiscalStart(account, today), calendar: account.budget_calendar ?? null },
    // Team-wide, for "which archetypes are we winning".
    outcomes_last_year_by_archetype: playbookOutcomes(playbook, currentPlaybook({ accountId: account.id })?.slug ?? null, today).map((o) => ({ archetype: o.name, won: o.won, lost: o.lost, win_rate_pct: o.winRate, median_cycle_days: o.medianCycleDays })),
    installed_base: (() => {
      const ib = dossier(account, today).installBase;
      return ib.asOf ? { as_of: ib.asOf, total_usd: ib.totalUsd, lines: ib.lines, largest: ib.top.map((r) => ({ family: r.family, value_usd: r.valueUsd, change_since_last_usd: r.changeUsd, not_in_latest: r.gone })) } : null;
    })(),
  };
}
