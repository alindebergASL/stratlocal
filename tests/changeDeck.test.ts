// SYNTHETIC ONLY: invented records and quotes.
import { expect, it } from "vitest";
import { buildDeck, changedFields, isLowRisk } from "@/lib/changeDeck";
import type { ProposalView } from "@/components/ProposalReview";

let n = 0;
function view(p: Partial<ProposalView> & Pick<ProposalView, "entity_type" | "op" | "payload">): ProposalView {
  n += 1;
  return { id: `p${String(n).padStart(2, "0")}`, entity_id: null, entity_label: null, before: null, rationale: null, source_ref: { kind: "meeting", quote: "synthetic quote" }, origin_kind: "meeting", ...p };
}

it("deals the consequential changes first, one each, then people and follow-ups as one card apiece", () => {
  const deal = view({ entity_type: "deal", op: "update", entity_label: "Synthetic refresh", payload: { stage: 4 }, before: { stage: 3 } });
  const play = view({ entity_type: "play", op: "update", payload: { next_step: "Synthetic step" }, before: { next_step: null } });
  const a = view({ entity_type: "contact", op: "create", payload: { name: "Synthetic Person A" } });
  const b = view({ entity_type: "contact", op: "create", payload: { name: "Synthetic Person B" } });
  const t = view({ entity_type: "action_item", op: "create", payload: { text: "Synthetic follow-up", owner: "Synthetic Customer" } });
  const summary = view({ entity_type: "meeting", op: "update", payload: { summary: "Synthetic summary" }, before: { summary: null } });
  const deck = buildDeck([t, b, play, summary, a, deal]);
  expect(deck.map((c) => c.kind)).toEqual(["change", "change", "change", "people", "follow-ups"]);
  expect(deck[0]!.rows[0]!.entity_type).toBe("deal");
  expect(deck[3]!.rows.map((r) => r.payload.name)).toEqual(["Synthetic Person A", "Synthetic Person B"]);
});

it("keeps 'accept the rest' to what a glance can check: people, follow-ups, dates and the summary", () => {
  expect(isLowRisk(view({ entity_type: "contact", op: "create", payload: { name: "X" } }))).toBe(true);
  expect(isLowRisk(view({ entity_type: "action_item", op: "create", payload: { text: "X" } }))).toBe(true);
  expect(isLowRisk(view({ entity_type: "deal", op: "update", payload: { close_date: "2026-12-05" }, before: { close_date: "2026-11-14" } }))).toBe(true);
  expect(isLowRisk(view({ entity_type: "meeting", op: "update", payload: { summary: "S" }, before: { summary: null } }))).toBe(true);
  // Money, a stage, a status or free text never go through in bulk.
  expect(isLowRisk(view({ entity_type: "deal", op: "update", payload: { stage: 4 }, before: { stage: 3 } }))).toBe(false);
  expect(isLowRisk(view({ entity_type: "deal", op: "update", payload: { tcv_usd: 900000 }, before: { tcv_usd: 1 } }))).toBe(false);
  expect(isLowRisk(view({ entity_type: "deal", op: "update", payload: { close_date: "2026-12-05", stage: 4 }, before: { close_date: "2026-11-14", stage: 3 } }))).toBe(false);
  expect(isLowRisk(view({ entity_type: "play", op: "update", payload: { status: "stalled" }, before: { status: "active" } }))).toBe(false);
  // Anything that rests on a research-report excerpt needs its own acknowledgement.
  expect(isLowRisk(view({ entity_type: "contact", op: "create", payload: { name: "X" }, source_ref: { kind: "research", verification: "report_excerpt" } }))).toBe(false);
});

it("names only what an update would actually change, and never the plumbing", () => {
  const p = view({ entity_type: "deal", op: "update", payload: { close_date: "2026-12-05", next_step: "Same", meeting_id: "m1", source_ref: {} }, before: { close_date: "2026-11-14", next_step: "Same" } });
  expect(changedFields(p)).toEqual(["close_date"]);
});
