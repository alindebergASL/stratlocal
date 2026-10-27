// Invented fixtures only. No generation, provider call or acceptance is needed.
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { storeDraftNote } from "@/lib/research/notes";
export const LONG_TITLE = "Synthetic quarterly architecture and operational readiness review with the regional service delivery and infrastructure planning teams";
export const FULL_SUMMARY = "Synthetic saved summary. ".repeat(45) + "Complete summary ending.";
export const ORIGINAL_NOTES = "Synthetic original notes, including the complete final sentence.";
export function layoutFixture(userId: string) {
  const create = (accountId: string, entityType: Parameters<typeof applyEntityChange>[0]["entityType"], payload: Record<string, unknown>) =>
    applyEntityChange({ accountId, entityType, op: "create", payload, actorUserId: userId }).entityId;
  const accountId = create("", "account", { name: "Synthetic Layout Lab", thesis: "Keep the complete account thesis in view." });
  const emptyId = create("", "account", { name: "Synthetic Quiet Lab" });
  const brief = { situation: [], deals_in_play: [], attendees: [], changes_since_last: [], questions: [], risks: [], proposed_next_step: { concern: "A synthetic open question.", action: "Agree a review date.", owner: null, target_date: null, blocker: null, evidence_ids: [] } };
  const meetingId = create(accountId, "meeting", { title: LONG_TITLE, held_at: "2020-01-01", raw_notes: ORIGINAL_NOTES, summary: FULL_SUMMARY, brief_json: JSON.stringify(brief) });
  for (let i = 0; i < 6; i++) create(accountId, "play", { title: `Synthetic play ${i + 1}`, status: "active", owner: "Alex", thesis: "Full play thesis. ".repeat(40), next_step: "Confirm the planning date", next_step_due: "2030-10-01" });
  create(accountId, "action_item", { text: "Keep the nonempty follow-up visible", status: "open", owner: "Alex" });
  const meetingBatch = createProposalBatch(accountId, { kind: "meeting", id: meetingId, aiRunId: null }, [{ entity_type: "action_item", op: "create", payload: { text: "Synthetic proposed meeting follow-up" } }]);
  const planBatch = createProposalBatch(accountId, { kind: "plan_draft", id: null, aiRunId: null }, [{ entity_type: "account", op: "update", entity_id: accountId, payload: { thesis: "Synthetic proposed plan thesis" } }]);
  const note = storeDraftNote({ accountId, userId, aiRunId: "synthetic-layout-run", note: { title: "Synthetic draft dossier", summary: "Original model summary for review.", open_questions: ["What remains unknown?"], findings: [{ text: "A proposed synthetic programme.", quote: "The programme is proposed.", url: "https://example.test/layout", date: null, confidence: "low", topic: "strategy" }] }, prose: "Complete synthetic dossier.", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });
  return { accountId, emptyId, meetingId, noteId: note.id, meetingBatch, planBatch };
}
