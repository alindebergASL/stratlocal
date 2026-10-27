// How proposed changes from a meeting's notes are dealt into cards, one
// decision each.
//
// The list on /review shows everything at once, which is right for an import
// of forty rows and wrong for the five that come out of a call. Here the
// changes that matter most come first, one at a time; people and follow-ups,
// which are many and cheap to check, are grouped into one card each.
//
// "Accept the rest" exists, and is deliberately narrow: it may accept only
// the kinds of change a glance can verify — a new person, a new follow-up, a
// date, the meeting's own summary. Anything touching money, a stage or a
// status is never accepted in bulk; it waits for its own card. That is the
// line between saving a person time and teaching them to rubber-stamp.
//
// Pure: no fetch, no database. The component does the deciding.
import type { ProposalView } from "@/components/ProposalReview";

export const HIDDEN_FIELDS = new Set(["document_id", "source_ref", "meeting_id"]);
export const LOW_RISK_UPDATE_FIELDS = new Set(["close_date", "due", "next_step_due", "summary"]);

// The same order the review list uses: who and what before the work that
// follows from it.
const RANK: Record<string, number> = { account: 0, contact: 1, deal: 2, install_base: 3, meeting: 4, play: 5, action_item: 6 };

export function needsAck(p: ProposalView): boolean {
  return p.source_ref?.verification === "report_excerpt";
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The fields this proposal would change, in the order the payload gives them. */
export function changedFields(p: ProposalView): string[] {
  return Object.keys(p.payload).filter((k) => {
    if (HIDDEN_FIELDS.has(k)) return false;
    if (p.op === "create") return p.payload[k] !== null && p.payload[k] !== undefined && p.payload[k] !== "";
    return !same(p.before?.[k], p.payload[k]);
  });
}

export function isLowRisk(p: ProposalView): boolean {
  if (needsAck(p)) return false;
  // What an email says is never accepted without being read (DECISIONS #102).
  if (p.origin_kind === "mail") return false;
  if (p.op === "create") return p.entity_type === "contact" || p.entity_type === "action_item";
  const fields = changedFields(p);
  return fields.length > 0 && fields.every((f) => LOW_RISK_UPDATE_FIELDS.has(f));
}

export type DeckCard = {
  key: string;
  kind: "change" | "people" | "follow-ups";
  rows: ProposalView[];
  lowRisk: boolean;
  needsAck: boolean;
};

export function buildDeck(proposals: ProposalView[]): DeckCard[] {
  const ordered = [...proposals].sort(
    (a, b) =>
      (RANK[a.entity_type] ?? 99) - (RANK[b.entity_type] ?? 99) ||
      Number(a.op === "update") - Number(b.op === "update") ||
      a.id.localeCompare(b.id),
  );
  const people = ordered.filter((p) => p.op === "create" && p.entity_type === "contact");
  const followUps = ordered.filter((p) => p.op === "create" && p.entity_type === "action_item");
  const singles = ordered.filter((p) => !people.includes(p) && !followUps.includes(p));
  const card = (kind: DeckCard["kind"], rows: ProposalView[]): DeckCard => ({
    key: `${kind}-${rows.map((r) => r.id).join("-")}`,
    kind,
    rows,
    lowRisk: rows.every(isLowRisk),
    needsAck: rows.some(needsAck),
  });
  return [
    ...singles.map((p) => card("change", [p])),
    ...(people.length ? [card("people", people)] : []),
    ...(followUps.length ? [card("follow-ups", followUps)] : []),
  ];
}

export function showValue(v: unknown, names: Record<string, string> = {}): string {
  if (v === null || v === undefined || v === "") return "—";
  // Linked records by name, as on the review list (lib/proposals/view.ts).
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? (names[x] ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(x) ? "a removed record" : x)) : showValue(x, names))).join(", ") || "—";
  if (typeof v === "string" && names[v]) return names[v];
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
