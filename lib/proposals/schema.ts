// What a proposal or a manual edit may set on each entity. The apply path
// re-parses every payload against these before touching a row, so a model
// (or a stale browser tab) can only ever change fields listed here.
import { z } from "zod";
import { qualificationPatchShape } from "../playbook/qualificationFields";

// The lengths the patch schemas enforce, named so a reader that has to stop a
// row *before* the schema sees it can use the same numbers rather than a copy
// that drifts. lib/sheet/readDeals.ts is the caller that needs them: it feeds
// createProposalBatch, which parses a whole batch in one transaction, so a
// cell that would fail here has to be caught a step earlier.
export const FIELD_MAX = { text: 4000, short: 400, dealId: 64 } as const;

const text = z.string().trim().max(FIELD_MAX.text);
// Notes and briefs are documents, not fields. They are written through the
// same apply path but their history records a size marker rather than a copy
// of the content (see LARGE_FIELDS in apply.ts), and a proposal may never
// carry one.
const longText = z.string().max(200_000);
const short = z.string().trim().max(FIELD_MAX.short);
const nullableShort = short.nullable();
// Exported for the same reason isoDate below is, and after the same mistake:
// lib/sheet/readContacts.ts has to refuse an address this schema would refuse,
// because it feeds createProposalBatch, which parses a whole batch in one
// transaction — so one unusable address three hundred rows into an import
// throws a ZodError naming a Zod path and loses every other row with it. It
// hand-rolled "one @, a dot in the domain" instead, which accepts a domain
// label starting with a hyphen, a doubled dot, a leading dot on the local
// part and seven other shapes this refuses. The check a reader runs early has
// to *be* the check the write path runs later, not a description of it.
export const contactEmail = z.string().trim().email().max(200);
// Exported so nothing redefines it: lib/meetings/inviteSchema.ts reads the
// same shapes the write path will validate against, and a regex that drifted
// between the two would accept a value the save then refuses.
export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .nullable();
// "HH:MM", 24-hour, in the app's timezone. Narrow on purpose: this feeds an
// ORDER BY, and a value that sorts wrong sorts wrong forever.
export const clockTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
  .nullable();

// Null means live. Only a person may set a date; a proposal may only clear it
// (see createProposalBatch), so the model can restore but never archive.
const archivedAt = isoDate;

export const SourceRef = z
  .object({
    kind: z.enum(["document", "meeting", "research", "user", "account", "contact", "deal", "play", "action_item", "ai", "mail"]),
    id: z.string().nullable().optional(),
    quote: z.string().max(1000).nullable().optional(),
    url: z.string().max(1000).nullable().optional(),
    finding_index: z.number().int().nonnegative().optional(),
    origin: z.literal("ai_generated").optional(),
    verification: z.enum(["source_excerpt", "report_excerpt"]).optional(),
    refs: z
      .array(
        z.object({
          kind: z.enum(["document", "meeting", "research", "user", "account", "contact", "deal", "play", "action_item", "email"]),
          id: z.string(),
          finding_index: z.number().int().nonnegative().optional(),
        }),
      )
      .optional(),
  })
  .strict();
export type SourceRef = z.infer<typeof SourceRef>;

export const AccountPatch = z
  .object({
    name: short.min(1),
    crm_id: nullableShort,
    legal_entity: nullableShort,
    region: nullableShort,
    segment: nullableShort,
    hq: nullableShort,
    thesis: text.nullable(),
    // Which of us runs it. In the patch so the change lands in history like
    // every other field — a handover between the two of them is exactly the
    // kind of thing you want a dated line for. Nothing a model produces can
    // reach it: no prompt is told the field exists and no diff writes one.
    owner_user_id: nullableShort,
    // Which of the playbook's archetypes the account is, and the two-sentence
    // hypothesis that goes with it (DECISIONS #69). The id is the playbook's
    // own; history is change_log, so a move between archetypes is a dated line.
    archetype_id: nullableShort,
    archetype_hypothesis: text.nullable(),
    // The qualification scorecard, one field per element (DECISIONS #72).
    ...qualificationPatchShape,
    // When the customer's money is set: the month their fiscal year starts
    // and, in their words, when budgets are submitted and approved.
    fiscal_year_start_month: z.number().int().min(1).max(12).nullable(),
    budget_calendar: text.nullable(),
    // Which of the team's playbooks the account uses; null is the default.
    playbook_slug: nullableShort,
    archived_at: archivedAt,
  })
  .partial()
  .strict();

export const ContactOrg = z.enum(["customer", "vendor", "partner"]);
export const ContactRole = z.enum(["ae", "se", "specialist_ae", "specialist_se", "partner", "executive", "it_leader", "technical", "procurement", "other"]);

export const ContactPatch = z
  .object({
    name: short.min(1),
    title: nullableShort,
    org: ContactOrg,
    role: ContactRole.nullable(),
    email: contactEmail.nullable(),
    notes: text.nullable(),
    archived_at: archivedAt,
  })
  .partial()
  .strict();

export const DealStatus = z.enum(["open", "won", "lost"]);

export const DealPatch = z
  .object({
    deal_id: z.string().trim().min(1).max(FIELD_MAX.dealId),
    name: short.min(1),
    stage: z.number().int().min(1).max(6).nullable(),
    stage_label: nullableShort,
    close_date: isoDate,
    fiscal_quarter: nullableShort,
    tcv_usd: z.number().int().min(0).nullable(),
    competitor: nullableShort,
    partner: nullableShort,
    architecture: text.nullable(),
    owner: nullableShort,
    next_step: text.nullable(),
    notes: text.nullable(),
    status: DealStatus,
    // "No next step needed" (DECISIONS #88): until a date, or informational
    // while the deal stands. Cleared when the deal moves.
    next_step_waived: z.enum(["until", "info"]).nullable(),
    next_step_waived_until: isoDate,
    next_step_waived_reason: text.nullable(),
    archived_at: archivedAt,
  })
  .partial()
  .strict();

export const InstallBasePatch = z
  .object({
    product_family: short.min(1),
    value_usd: z.number().int().min(0).nullable(),
    share_pct: z.number().min(0).max(100).nullable(),
    role_note: text.nullable(),
    as_of: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    document_id: nullableShort,
    archived_at: archivedAt,
  })
  .partial()
  .strict();

// "Not applicable" and "information only" are a person's say-so that a play
// needs nothing more: they leave every plan warning (DECISIONS #87).
export const PlayStatus = z.enum(["proposed", "active", "stalled", "won", "dropped", "not_applicable", "info_only"]);

export const PlayPatch = z
  .object({
    title: short.min(1),
    thesis: text.nullable(),
    status: PlayStatus,
    owner: nullableShort,
    next_step: text.nullable(),
    next_step_due: isoDate,
    deal_ids: z.array(z.string().trim().min(1)).max(50),
    contact_ids: z.array(z.string().trim().min(1)).max(50),
    sort_order: z.number().int().min(0),
    // Which phase of the account's roadmap the play is (1 to 3), when it is on one.
    phase: z.number().int().min(1).max(3).nullable(),
    archived_at: archivedAt,
  })
  .partial()
  .strict();

export const ActionItemPatch = z
  .object({
    text: text.min(1),
    notes: text.nullable(),
    owner: nullableShort,
    owner_user_id: nullableShort,
    due: isoDate,
    status: z.enum(["open", "done"]),
    meeting_id: nullableShort,
    play_id: nullableShort,
    // Kept on the row, not only in history, so the quote that produced the
    // item stays visible next to it.
    source_ref: SourceRef.nullable(),
    archived_at: archivedAt,
  })
  .partial()
  .strict();

export const Attendee = z
  .object({
    contact_id: z.string().nullable(),
    name: short.min(1),
    note: nullableShort,
  })
  .strict();
export type Attendee = z.infer<typeof Attendee>;

export const MeetingPatch = z
  .object({
    title: short.min(1),
    // A calendar day like every other date here. It was min(4).max(40), and
    // the queries that ask "is this meeting today" compare it with `=` against
    // a bare YYYY-MM-DD — a stored timestamp would have counted as zero
    // meetings today while every screen still rendered it correctly.
    held_at: isoDate,
    held_time: clockTime,
    attendees: z.array(Attendee).max(50),
    summary: text.nullable(),
    raw_notes: longText.nullable(),
    brief_json: longText.nullable(),
    brief_edits_json: longText.nullable(),
    archived_at: archivedAt,
  })
  .partial()
  .strict();

// The entity types a person can archive.
//
// install_base used to be excluded, on the grounds that a snapshot keyed by
// import date is replaced rather than curated. That is a fair description of
// what a snapshot is and it had no answer for one that was wrong when it was
// taken — a figure misread from a report table was permanent, and the trend is
// read off it. A row is archived rather than deleted, like everything else
// here (DECISIONS #8), so the snapshot that was filed stays on the record and
// stops being counted.
export const ARCHIVABLE = ["account", "contact", "deal", "install_base", "play", "meeting", "action_item"] as const;
export type Archivable = (typeof ARCHIVABLE)[number];

export function isArchivable(entityType: string): entityType is Archivable {
  return (ARCHIVABLE as readonly string[]).includes(entityType);
}

export const EntityType = z.enum(["account", "contact", "deal", "install_base", "play", "action_item", "meeting"]);
export type EntityType = z.infer<typeof EntityType>;

export const PATCH_SCHEMAS = {
  account: AccountPatch,
  contact: ContactPatch,
  deal: DealPatch,
  install_base: InstallBasePatch,
  play: PlayPatch,
  action_item: ActionItemPatch,
  meeting: MeetingPatch,
} as const;

// Fields that must be present when creating a row.
export const CREATE_REQUIRED: Record<EntityType, string[]> = {
  account: ["name"],
  contact: ["name"],
  // deal_id is not here: applyEntityChange issues a local one when a create
  // carries none, so a deal that has no CRM id yet is a real state rather than
  // a malformed payload (DECISIONS #16).
  deal: ["name"],
  install_base: ["product_family", "as_of"],
  play: ["title"],
  action_item: ["text"],
  meeting: ["title", "held_at"],
};

export type ProposalDraft = {
  entity_type: EntityType;
  op: "create" | "update";
  entity_id?: string | null;
  payload: Record<string, unknown>;
  rationale?: string | null;
  source_ref?: SourceRef | null;
};

export function parsePayload(entityType: EntityType, payload: unknown): Record<string, unknown> {
  const schema = PATCH_SCHEMAS[entityType];
  return schema.parse(payload) as Record<string, unknown>;
}
