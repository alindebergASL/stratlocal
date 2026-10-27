// Which fields can be edited in place, and what kind of value each is. Read
// by the inline editor (to pick its input) and by the server action (to
// refuse anything not listed): one field at a time, through the one writer,
// with the row's version so a partner's edit is never silently overwritten.
export type InlineKind = "text" | "longtext" | "date" | "money" | "stage" | "status";
export type InlineEntity = "deal" | "contact" | "play" | "account" | "action_item";

export const INLINE_FIELDS: Record<InlineEntity, Record<string, { kind: InlineKind; label: string; required?: boolean }>> = {
  deal: {
    name: { kind: "text", label: "Name", required: true },
    stage: { kind: "stage", label: "Stage" },
    status: { kind: "status", label: "Status", required: true },
    close_date: { kind: "date", label: "Close date" },
    tcv_usd: { kind: "money", label: "Value" },
    next_step: { kind: "longtext", label: "Next step" },
    competitor: { kind: "text", label: "Competitor" },
    partner: { kind: "text", label: "Partner" },
    owner: { kind: "text", label: "Owner" },
  },
  contact: {
    name: { kind: "text", label: "Name", required: true },
    title: { kind: "text", label: "Title" },
    email: { kind: "text", label: "Email" },
    notes: { kind: "longtext", label: "Notes" },
  },
  play: {
    title: { kind: "text", label: "Title", required: true },
    next_step: { kind: "longtext", label: "Next step" },
    next_step_due: { kind: "date", label: "Next step due" },
    owner: { kind: "text", label: "Owner" },
    thesis: { kind: "longtext", label: "Thesis" },
  },
  account: {
    name: { kind: "text", label: "Name", required: true },
    region: { kind: "text", label: "Region" },
    segment: { kind: "text", label: "Segment" },
    thesis: { kind: "longtext", label: "Thesis" },
  },
  action_item: {
    text: { kind: "longtext", label: "Task", required: true },
    due: { kind: "date", label: "Due" },
  },
};
