// The playbook's discovery questions chosen for one meeting: by the
// account's archetype, by who is in the room, and by what the team still
// needs to find out. Worked out in code from the playbook, so the guide is
// the team's own questions, never generated ones.
import type { Meddpicc, Playbook } from "./schema";

type Question = Playbook["questions"][number];

export type GuideQuestion = Question & { why: string[] };
export type DiscoveryGuide = Array<{ movement: { id: string | null; name: string; purpose: string }; questions: GuideQuestion[] }>;

const SMALL = new Set(["of", "and", "the", "for", "to", "&"]);

/** "Chief Information Security Officer" → "CISO"; "Chief AI Officer" → "CAIO". */
export function titleAcronym(title: string): string {
  return title
    .split(/[\s,/-]+/)
    .filter((w) => w && !SMALL.has(w.toLowerCase()))
    .map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w[0]!.toUpperCase()))
    .join("");
}

/** Whether a person with this title or role is the persona a question is for. */
export function isPersona(persona: string, who: { title?: string | null; role?: string | null }): boolean {
  const p = persona.trim().toLowerCase();
  if (!p) return false;
  return [who.title, who.role].some((t) => {
    if (!t) return false;
    const words = t.toLowerCase();
    return new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(words) || titleAcronym(t).toLowerCase() === p;
  });
}

export const PER_MOVEMENT = 3;

export function discoveryGuide(
  playbook: Playbook,
  input: { archetypeId: string | null; attendees: Array<{ name: string; title?: string | null; role?: string | null }>; gaps?: Meddpicc[] },
): DiscoveryGuide {
  const archetype = playbook.archetypes.find((a) => a.id === input.archetypeId) ?? null;
  const gaps = new Set(input.gaps ?? []);
  const scored = playbook.questions
    .map((q, order) => {
      // A question for other archetypes only is not for this account; with no
      // archetype chosen yet, every question is in play.
      if (archetype && q.archetypes.length && !q.archetypes.includes(archetype.id)) return null;
      const why: string[] = [];
      let score = 0;
      if (archetype && q.archetypes.includes(archetype.id)) {
        score += 2;
        why.push(archetype.name);
      }
      const forWhom = input.attendees.filter((a) => q.personas.some((p) => isPersona(p, a)));
      if (forWhom.length) {
        score += 2;
        why.push(`for ${forWhom.map((a) => a.name).join(", ")}`);
      } else if (q.personas.length && input.attendees.length) {
        // For someone who is not in the room.
        score -= 1;
      }
      if (q.meddpicc && gaps.has(q.meddpicc)) {
        score += 3;
        why.push("still to find out");
      }
      return { q: { ...q, why }, score, order };
    })
    .filter((x): x is { q: GuideQuestion; score: number; order: number } => x !== null);

  const movements = [...playbook.movements.map((m) => ({ id: m.id as string | null, name: m.name, purpose: m.purpose })), { id: null, name: "Other questions", purpose: "" }];
  return movements
    .map((movement) => ({
      movement,
      questions: scored
        .filter((x) => (x.q.movement_id ?? null) === movement.id || (movement.id === null && x.q.movement_id !== null && !playbook.movements.some((m) => m.id === x.q.movement_id)))
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, PER_MOVEMENT)
        .sort((a, b) => a.order - b.order)
        .map((x) => x.q),
    }))
    .filter((g) => g.questions.length > 0);
}
