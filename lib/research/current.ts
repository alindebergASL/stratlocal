// Kept research that may no longer be true, for a person to say so.
//
// A finding was true of its page on the day it was read. Two years on, or
// once the date of the event it announced has passed, it may not be: the
// research page asks, rather than either trusting it forever or quietly
// dropping it. What a person says is kept, and asked again after six months.
import { findingAge } from "./provenance";
import type { BriefItem } from "./brief";

export const OLD_MONTHS = 24;
export const RECHECK_DAYS = 180;
export const STILL_TRUE_SHOWN = 5;

export type StillTrue = { item: BriefItem; why: string };

export function stillTrue(items: Array<BriefItem & { checkedAt?: string | null }>, today: string, now = Date.now()): StillTrue[] {
  const out: StillTrue[] = [];
  for (const item of items) {
    if (item.checkedAt && now - Date.parse(item.checkedAt) < RECHECK_DAYS * 86400000) continue;
    const date = item.finding.date;
    if (date && item.read?.signal === "compelling_event" && date < today) out.push({ item, why: `its date, ${date}, has passed` });
    else if ((findingAge(date, today)?.months ?? 0) >= OLD_MONTHS) out.push({ item, why: `${findingAge(date, today)!.label}` });
  }
  return out.sort((a, b) => (a.item.finding.date ?? "").localeCompare(b.item.finding.date ?? ""));
}
