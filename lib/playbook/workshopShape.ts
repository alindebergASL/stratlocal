// The shape of an account's workshop plan: when, who is invited, and the use
// cases the line of business brought, each scored, placed by the rubric and
// given a roadmap phase. No database here, so the editor can use it.
import { z } from "zod";

const score = z.number().int().min(1).max(5).nullable().default(null);

export const UseCase = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(200),
    department: z.string().trim().max(120).default(""),
    notes: z.string().trim().max(1000).default(""),
    value: score,
    feasibility: score,
    relevance: z.record(z.string(), z.number().int().min(0).max(3)).default({}),
    phase: z.number().int().min(1).max(3).nullable().default(null),
    play_id: z.string().nullable().default(null),
  })
  .strict();
export type UseCase = z.infer<typeof UseCase>;

export const Workshop = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    start: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
    invitees: z.array(z.string()).max(40).default([]),
    use_cases: z.array(UseCase).max(40).default([]),
  })
  .strict();
export type Workshop = z.infer<typeof Workshop>;

export const EMPTY_WORKSHOP: Workshop = Workshop.parse({});

/** "09:30" plus minutes, as a clock time. */
export function addMinutes(start: string, minutes: number): string {
  const [h, m] = start.split(":").map(Number) as [number, number];
  const t = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
