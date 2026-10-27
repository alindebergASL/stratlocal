import { appTimeZone, dayOf, daysBetween, formatter } from "./clock";
import { isLocalDealId } from "./ids";

export const STAGE_LABELS: Record<number, string> = {
  1: "Qualify",
  2: "Propose",
  3: "Tech Validation",
  4: "Biz Validation",
  5: "Commit",
  6: "Closed",
};

// What to show where a deal's CRM id goes. One helper so the answer is the
// same everywhere: a deal the app issued an id to has no CRM id to show, and
// printing `local-3f9c1a20` at a customer would be worse than saying nothing.
export function crmIdText(dealId: string): string | null {
  return isLocalDealId(dealId) ? null : dealId;
}

// Two names for the same thing, allowing for the punctuation a CRM export and
// a person type differently: "Northwind_EHR-Refresh" and "Northwind EHR
// Refresh". Equality, not fuzzy matching — the duplicate hint and the merge
// picker both use it, so they always agree about what looks like a pair.
// The normalised form `sameName` compares, exported so a reader that has to
// group rows by name before anything is matched uses the app's one rule rather
// than a lowercase() that disagrees with it by exactly the differences a
// spreadsheet introduces — a double space, a trailing space, "O'Brien".
export function nameKey(v: string): string {
  // Names are not ASCII-only: dropping other letters collapses distinct people.
  return v.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b) && nameKey(a) !== "";
}

// "3 · Technical Validation". The CRM report's stage cell often carries its
// own number ("3 - Technical Validation"), which used to come out as
// "3 · 3 - Technical Validation". A leading number in the label is dropped
// when it is the stage's own; a different number is kept, because then the
// label is saying something the stage is not.
export function stageText(stage: number | null, label: string | null): string {
  if (stage === null) return label ?? "—";
  let words = (label ?? "").trim();
  const lead = /^(\d+)\s*[-–—·.:)]\s*/.exec(words);
  if (lead && Number(lead[1]) === stage) words = words.slice(lead[0].length).trim();
  return `${stage} · ${words || STAGE_LABELS[stage] || ""}`.replace(/ · $/, "").trim();
}

// The day's AI spend against the cap, said the same way everywhere.
//
// A cap of zero is a real setting — it is how you turn model calls off for the
// day — and every surface got it wrong in its own way: Home rendered "$0.00 of
// $0.00" and, because `0 >= 0 * 0.8`, painted the tile as though the budget
// were nearly gone, permanently. The refusal underneath said the budget "is
// spent" and "resets at midnight", neither of which was true.
export type Spend = { cents: number; capCents: number; unpriced: number };

export function spendSub(spend: Spend): string {
  if (spend.capCents === 0) return "model calls are off";
  const cap = `of $${(spend.capCents / 100).toFixed(2)}`;
  // A run whose model has no price stores no cost, so it adds nothing to the
  // figure. Saying how many there were is the difference between "we spent
  // nothing" and "we cannot tell".
  return spend.unpriced > 0 ? `${cap} · ${spend.unpriced} unpriced` : cap;
}

export function spendLine(spend: Spend): string {
  if (spend.capCents === 0) return "Model calls are off";
  return `AI today $${(spend.cents / 100).toFixed(2)} ${spendSub(spend)}`;
}

/** Worth colouring: nearly at the cap, or carrying runs we cannot price. */
export function spendIsTight(spend: Spend): boolean {
  if (spend.unpriced > 0) return true;
  if (spend.capCents === 0) return false;
  return spend.cents >= spend.capCents * 0.8;
}

// A record's history count, said honestly when the list is capped.
//
// Each record page reads 200 rows and used to print "{history.length}
// changes", so past the cap the count was a count of the cap — a number that
// stops moving while the record keeps changing. DECISIONS #20: a count comes
// from the whole set, never from the shown one.
export function historyCountText(shown: number, total: number): string {
  if (total <= shown) return `${total} change${total === 1 ? "" : "s"}`;
  return `${shown} most recent of ${total}`;
}

// How big a value is, when the value itself is not worth carrying.
//
// One definition, because two surfaces show it: history records a meeting's
// notes as a size rather than a second copy (DECISIONS #9), and the activity
// feed does the same for any value too long to carry 200 rows of.
export function sizeMarker(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtMoneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// A date a person reads: "Fri 20 Sep". The year appears only when it is not
// the current one, because most dates in this app are within a few months.
export function fmtDay(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  // Through the cache rather than toLocaleDateString, which builds a formatter
  // per call: the pipeline calls this once per deal, and at 600 deals that was
  // most of the page's render time. Two shapes, so two cache entries.
  return formatter("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(d);
}

// A timestamp in the app's timezone. It used to print UTC, which read five to
// eight hours off from when the person remembered doing the thing.
export function fmtWhen(ms: number | null | undefined): string {
  if (!ms) return "—";
  return `${fmtDay(dayOf(ms))}, ${formatter("en-GB", {
    timeZone: appTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms))}`;
}

// What a run cost, said honestly. One definition; there were three, with two
// different strings.
export function fmtCostNote(cents: number | null | undefined, estimated: boolean | null | undefined): string {
  // A run whose model has no price returns null, and this used to render the
  // empty string for it — so a run that cost real money showed no cost at all,
  // which reads exactly like a run that was free. It also sums to zero against
  // the daily cap, so the silence was hiding a budget that had stopped
  // working. Say it instead.
  if (cents === null || cents === undefined) return " · cost unknown for this model";
  const amount = `$${(cents / 100).toFixed(2)}`;
  return estimated ? ` · about ${amount}, estimated` : ` · ${amount}`;
}

// By the calendar, not by elapsed hours: eleven last night to nine this
// morning is ten hours and was yesterday.
export function relativeDays(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const days = daysBetween(dayOf(ms), dayOf(now));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return fmtDay(dayOf(ms));
}

export function parseJsonArray(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// Reads a change_log value back into something readable.
//
// `labels` resolves an id to a name where the caller has one. Without it a
// contested play link reads as a row of uuids, and a meeting's attendee list —
// which is an array of objects — came out as "[object Object], [object
// Object]" in the one place whose entire job is explaining what changed.
export function logValueText(v: string | null, labels?: (id: string) => string | undefined): string {
  if (v === null) return "—";
  try {
    const parsed = JSON.parse(v);
    if (parsed === null) return "—";
    if (Array.isArray(parsed)) return parsed.map((item) => itemText(item, labels)).join(", ") || "—";
    return itemText(parsed, labels);
  } catch {
    return v;
  }
}

function itemText(item: unknown, labels?: (id: string) => string | undefined): string {
  if (item === null || item === undefined) return "—";
  // An attendee: {contact_id, name, note}. The name is what was written down
  // at the time, so it is the truest thing to show.
  if (typeof item === "object") {
    const o = item as Record<string, unknown>;
    if (typeof o.name === "string" && o.name) return o.name;
    if (typeof o.contact_id === "string") return labels?.(o.contact_id) ?? o.contact_id;
    return JSON.stringify(item);
  }
  if (typeof item === "string") return labels?.(item) ?? item;
  return String(item);
}
