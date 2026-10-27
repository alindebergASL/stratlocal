// Ranking what a watch found. Pure, so the review screen can use it.
import { findingAge } from "./provenance";
import type { FindingRead, ResearchFinding } from "./schema";

export type RankedChange = { index: number; score: number; reasons: string[] };

/**
 * What a watch found, most important first, each with why: a compelling event
 * outranks a trigger, touching a play or a focus area adds weight, and
 * anything a year old loses it. Worked out in code from the reads and the
 * play matches; a finding with no reason to rank is left out of the list,
 * not out of the note.
 */
export function rankChanges(
  findings: ResearchFinding[],
  reads: Record<string, FindingRead> | undefined,
  touches: Record<number, Array<{ playTitle: string }>> | undefined,
  today: string,
): RankedChange[] {
  return findings
    .map((f, index) => {
      const read = reads?.[String(index)];
      const reasons: string[] = [];
      let score = 0;
      if (read?.signal === "compelling_event") {
        score += 3;
        reasons.push(read.owner ? `a compelling event, owned by ${read.owner}` : "a compelling event");
      } else if (read?.signal === "trigger") {
        score += 2;
        reasons.push("a reason to call now");
      }
      const plays = touches?.[index] ?? [];
      if (plays.length) {
        score += 2;
        reasons.push(`touches ${plays.map((p) => p.playTitle).join(", ")}`);
      }
      if (read?.fits.length) {
        score += 1;
        reasons.push(`fits ${read.fits.join(", ")}`);
      }
      if (score > 0 && findingAge(f.date, today)?.stale) {
        score -= 2;
        reasons.push("but over a year old");
      }
      return { index, score, reasons };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
