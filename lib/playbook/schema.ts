// A sales playbook, as data.
//
// The team's own playbook is imported or typed in the app and lives only in
// the database: the code knows its shape, never its content, so a playbook
// that names a company, its products or its people never reaches the
// repository, and another team can bring its own (DECISIONS #68).
import { z } from "zod";

/** MEDDPICC, with the two Ds and two Cs told apart. */
export const MEDDPICC = ["M", "E", "DC", "DP", "P", "I", "CH", "CO"] as const;
export const Meddpicc = z.enum(MEDDPICC);
export type Meddpicc = z.infer<typeof Meddpicc>;
export const MEDDPICC_LABELS: Record<Meddpicc, string> = {
  M: "Metrics",
  E: "Economic buyer",
  DC: "Decision criteria",
  DP: "Decision process",
  P: "Paper process",
  I: "Identify pain",
  CH: "Champion",
  CO: "Competition",
};

const slug = z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/, "use lowercase letters, digits, - and _");
const line = (max: number) => z.string().trim().max(max);
const opt = (max: number) => z.string().trim().max(max).nullable().default(null);

export const PlaybookRole = z.object({ id: slug, name: line(80).min(1), responsibilities: line(1000).default(""), owns: line(500).default("") }).strict();
export const PlaybookStep = z
  .object({
    id: slug,
    name: line(120).min(1),
    /** "90 to 120 minutes", "48 hours", "60 minutes". */
    timebox: opt(80),
    /** What the step produces: a brief, a hypothesis, a readout. */
    output: opt(300),
    owner_role: slug.nullable().default(null),
    detail: line(1500).default(""),
    checklist: z.array(line(200).min(1)).max(12).default([]),
  })
  .strict();
export const PlaybookArchetype = z
  .object({
    id: slug,
    name: line(80).min(1),
    posture: line(500).default(""),
    pain: line(500).default(""),
    entry_point: line(500).default(""),
    messaging: line(1000).default(""),
  })
  .strict();
export const PlaybookMovement = z.object({ id: slug, name: line(120).min(1), purpose: line(500).default("") }).strict();
export const PlaybookQuestion = z
  .object({
    id: slug,
    text: line(400).min(1),
    movement_id: slug.nullable().default(null),
    meddpicc: Meddpicc.nullable().default(null),
    /** Who it is for, as roles a contact can hold: "CIO", "CISO". Empty is anyone. */
    personas: z.array(line(40).min(1)).max(6).default([]),
    /** Which archetypes it suits. Empty is every archetype. */
    archetypes: z.array(slug).max(10).default([]),
  })
  .strict();
export const WorkshopSegment = z.object({ id: slug, name: line(120).min(1), minutes: z.number().int().min(1).max(480), focus: line(500).default(""), lead_role: slug.nullable().default(null) }).strict();
export const PlacementRubric = z
  .object({
    /** Where a workload can run: "SaaS", "Public cloud", "On premise". */
    options: z.array(z.object({ id: slug, name: line(60).min(1) }).strict()).min(2).max(5),
    /** What decides it, how much it matters, and how each option scores on it (-2 to 2). */
    criteria: z.array(z.object({ id: slug, name: line(120).min(1), weight: z.number().int().min(1).max(5), scores: z.record(slug, z.number().int().min(-2).max(2)) }).strict()).max(12),
  })
  .strict();

export const Playbook = z
  .object({
    name: line(120).min(1),
    summary: line(2000).default(""),
    roles: z.array(PlaybookRole).max(8).default([]),
    steps: z.array(PlaybookStep).max(12).default([]),
    archetypes: z.array(PlaybookArchetype).max(10).default([]),
    movements: z.array(PlaybookMovement).max(8).default([]),
    questions: z.array(PlaybookQuestion).max(200).default([]),
    workshop: z.array(WorkshopSegment).max(12).default([]),
    placement: PlacementRubric.nullable().default(null),
    /** When the customer budgets and approves: fiscal year, windows, programmes. */
    budget_hints: opt(1000),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = (xs: Array<{ id: string }>, path: string) => {
      const seen = new Set<string>();
      xs.forEach((x, i) => {
        if (seen.has(x.id)) ctx.addIssue({ code: "custom", path: [path, i, "id"], message: `"${x.id}" is used twice` });
        seen.add(x.id);
      });
      return seen;
    };
    const roles = ids(p.roles, "roles");
    ids(p.steps, "steps");
    const archetypes = ids(p.archetypes, "archetypes");
    const movements = ids(p.movements, "movements");
    ids(p.questions, "questions");
    ids(p.workshop, "workshop");
    if (p.placement) {
      const places = ids(p.placement.options, "placement.options");
      ids(p.placement.criteria, "placement.criteria");
      p.placement.criteria.forEach((c, i) => {
        for (const k of Object.keys(c.scores)) if (!places.has(k)) ctx.addIssue({ code: "custom", path: ["placement", "criteria", i, "scores", k], message: `no place to run "${k}"` });
      });
    }
    p.steps.forEach((s, i) => s.owner_role && !roles.has(s.owner_role) && ctx.addIssue({ code: "custom", path: ["steps", i, "owner_role"], message: `no role "${s.owner_role}"` }));
    p.workshop.forEach((s, i) => s.lead_role && !roles.has(s.lead_role) && ctx.addIssue({ code: "custom", path: ["workshop", i, "lead_role"], message: `no role "${s.lead_role}"` }));
    p.questions.forEach((q, i) => {
      if (q.movement_id && !movements.has(q.movement_id)) ctx.addIssue({ code: "custom", path: ["questions", i, "movement_id"], message: `no movement "${q.movement_id}"` });
      for (const a of q.archetypes) if (!archetypes.has(a)) ctx.addIssue({ code: "custom", path: ["questions", i, "archetypes"], message: `no archetype "${a}"` });
    });
  });
export type Playbook = z.output<typeof Playbook>;
export type PlaybookInput = z.input<typeof Playbook>;
