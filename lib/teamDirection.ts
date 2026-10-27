// What the team is for, in its own words.
//
// Nothing in the app knew what the two of you sell, so a brief, a plan and a
// research run were written for "a seller" in general. This is the team's
// own statement of direction — what it sells, what it is after this half,
// what makes an account worth its time, what to steer away from — written on
// /settings/direction and read by the steps that decide what matters.
//
// Three rules, one place:
// - It is the team's text, not evidence. Prompts are told to use it to
//   choose what to prioritise and propose, never to treat it as a fact about
//   an account or cite it.
// - Only the focus areas ever leave AWS. Web research runs on the direct
//   Anthropic API, and DECISIONS #3 lets it carry an account's public
//   identity, the typed question and the team's focus areas — a short list of
//   what it sells — and nothing else: never the goals, signals or anything to
//   avoid. `focusForResearch` is the only door, and it opens on that list.
// - Empty means absent. With nothing written, every prompt is exactly what it
//   was before this existed.
import { db } from "./db";
import { newId } from "./ids";
import { ApplyError } from "./proposals/apply";

export const MAX_FOCUS_AREAS = 12;
export const MAX_FOCUS_LENGTH = 60;
export const MAX_TEXT_LENGTH = 2000;

export type TeamDirection = {
  id: string;
  focusAreas: string[];
  goals: string | null;
  signals: string | null;
  avoid: string | null;
  createdBy: string | null;
  createdAt: number;
};

type Row = { id: string; focus_areas_json: string; goals: string | null; signals: string | null; avoid: string | null; created_by: string | null; created_at: number };

function toDirection(r: Row): TeamDirection {
  let focusAreas: string[] = [];
  try {
    const v = JSON.parse(r.focus_areas_json) as unknown;
    if (Array.isArray(v)) focusAreas = v.filter((x): x is string => typeof x === "string");
  } catch {
    focusAreas = [];
  }
  return { id: r.id, focusAreas, goals: r.goals, signals: r.signals, avoid: r.avoid, createdBy: r.created_by, createdAt: r.created_at };
}

/** The current direction, or null when the team has written none. */
export function currentDirection(): TeamDirection | null {
  const r = db().prepare(`SELECT * FROM team_direction ORDER BY created_at DESC, rowid DESC LIMIT 1`).get() as Row | undefined;
  return r ? toDirection(r) : null;
}

/** Earlier versions, newest first, for the page's history. */
export function directionHistory(limit = 10): TeamDirection[] {
  return (db().prepare(`SELECT * FROM team_direction ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(limit) as Row[]).map(toDirection);
}

const text = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\r\n/g, "\n").trim();
  return t ? t : null;
};

/**
 * Save a new version. `basisId` is the version the page was showing (null
 * when there was none): if the other of you saved since, this is refused
 * rather than quietly replacing what they wrote.
 */
export function saveDirection(input: { focusAreas: string[]; goals?: string | null; signals?: string | null; avoid?: string | null; userId: string | null; basisId: string | null }): TeamDirection {
  const conn = db();
  return conn
    .transaction((): TeamDirection => {
      const current = currentDirection();
      if ((current?.id ?? null) !== input.basisId) {
        throw new ApplyError("The team direction was changed since this page was opened. Reload to see it, then make your change again.", "conflict");
      }
      const seen = new Set<string>();
      const focusAreas: string[] = [];
      for (const raw of input.focusAreas) {
        const f = raw.trim().replace(/\s+/g, " ");
        if (!f) continue;
        if (f.length > MAX_FOCUS_LENGTH) throw new ApplyError(`Keep each focus area under ${MAX_FOCUS_LENGTH} characters: "${f.slice(0, 40)}…"`, "validation");
        if (seen.has(f.toLowerCase())) continue;
        seen.add(f.toLowerCase());
        focusAreas.push(f);
      }
      if (focusAreas.length > MAX_FOCUS_AREAS) throw new ApplyError(`List at most ${MAX_FOCUS_AREAS} focus areas.`, "validation");
      const fields = { goals: text(input.goals), signals: text(input.signals), avoid: text(input.avoid) };
      for (const [name, v] of Object.entries(fields)) {
        if (v && v.length > MAX_TEXT_LENGTH) throw new ApplyError(`Keep ${name} under ${MAX_TEXT_LENGTH} characters.`, "validation");
      }
      // A focus area can carry an address into a web search, which the
      // research question already refuses; the same rule here.
      if (focusAreas.some((f) => /[\w.+-]+@[\w-]+\.[\w.]+/.test(f))) throw new ApplyError("A focus area is sent to web research; leave email addresses out of it.", "validation");
      const row: Row = {
        id: newId(),
        focus_areas_json: JSON.stringify(focusAreas),
        goals: fields.goals,
        signals: fields.signals,
        avoid: fields.avoid,
        created_by: input.userId,
        // Strictly after the version it replaces, even in the same millisecond.
        created_at: Math.max(Date.now(), (current?.createdAt ?? 0) + 1),
      };
      conn
        .prepare(`INSERT INTO team_direction (id, focus_areas_json, goals, signals, avoid, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.focus_areas_json, row.goals, row.signals, row.avoid, row.created_by, row.created_at);
      return toDirection(row);
    })
    .immediate();
}

/**
 * The block a Bedrock prompt carries, or "" when there is no direction. It is
 * appended to the system prompt by `withDirection`.
 */
export function directionForPrompt(d: TeamDirection | null = currentDirection()): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.focusAreas.length) parts.push(`What the team sells and works on: ${d.focusAreas.join("; ")}.`);
  if (d.goals) parts.push(`What the team is trying to achieve:\n${d.goals}`);
  if (d.signals) parts.push(`What makes an account worth the team's time:\n${d.signals}`);
  if (d.avoid) parts.push(`What the team steers away from:\n${d.avoid}`);
  if (!parts.length) return "";
  return [
    "The team's own direction, written by the team itself. Use it to decide what matters most and what to propose; where the records bear on it, lead with that.",
    "It is not evidence about this account: never state it as a fact about the customer, never cite it, and never invent a connection the records do not support. Something important that falls outside it is still said, and said to be outside it.",
    "",
    ...parts,
  ].join("\n");
}

/** Append the direction to a system prompt; unchanged when there is none. */
export function withDirection(system: string, block: string): string {
  return block ? `${system}\n\n${block}` : system;
}

/** The only part of the direction that may go to web research: the focus areas. */
export function focusForResearch(d: TeamDirection | null = currentDirection()): string[] {
  return d ? d.focusAreas.slice(0, MAX_FOCUS_AREAS) : [];
}
