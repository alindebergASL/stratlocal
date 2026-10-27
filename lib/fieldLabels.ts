import { QUALIFICATION_LABELS } from "./playbook/qualificationFields";
// Presentation only: stored audit fields and values are never rewritten.
const FIELD_LABELS: Record<string, string> = {
  owner_user_id: "Assigned owner", owner: "Owner", raw_notes: "Meeting notes",
  held_at: "Meeting date", held_time: "Meeting time", summary: "Summary",
  tcv_usd: "Deal value", close_date: "Close date", next_step: "Next step",
  next_step_due: "Next-step due date", due: "Due date", title: "Title",
  name: "Name", status: "Status", stage: "Stage", stage_label: "Stage label",
  thesis: "Thesis", meeting_id: "Source meeting", play_id: "Linked play",
  deal_ids_json: "Linked deals", contact_ids_json: "Linked people", deal_ids: "Linked deals", contact_ids: "Linked people",
  attendees_json: "Attendees", archived_at: "Archived date", merged_into: "Merged into",
  value_usd: "Value", share_pct: "Share (%)", as_of: "As of", product_family: "Product family",
  role_note: "Role notes", brief_json: "Meeting brief",
  crm_id: "CRM ID", legal_entity: "Legal entity", region: "Region", segment: "Segment", hq: "Headquarters",
  archetype_id: "Archetype", archetype_hypothesis: "Hypothesis",
  ...QUALIFICATION_LABELS,
  fiscal_year_start_month: "Fiscal year starts", budget_calendar: "Budget calendar", phase: "Roadmap phase", playbook_slug: "Playbook", next_step_waived: "Next step not needed", next_step_waived_until: "Not needed until", next_step_waived_reason: "Why not needed",
  merged_from: "Merged in", unmerged: "Merge undone", account_id: "Account",
};
export function fieldLabel(field: string): string {
  const label = Object.prototype.hasOwnProperty.call(FIELD_LABELS, field) ? FIELD_LABELS[field] : undefined;
  return label ?? field.replace(/_/g, " ");
}
