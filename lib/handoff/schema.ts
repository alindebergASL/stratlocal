// What a handoff report contains, as a shape rather than as a page.
//
// The difference between this and /accounts/[id]/summary is the whole point.
// That page is live: it renders whatever the account says at the moment it is
// opened, which is right for reading it together on a call and wrong for
// handing it over. A handoff is a snapshot — what you reviewed and stood
// behind on the day you sent it — so it is built once, stored, and rendered
// from what was stored. If a deal slips next week, the link the other team is
// reading does not quietly change underneath them.
//
// Zod rather than a bare type because this is read back out of a TEXT column:
// meta_json is parsed, not cast, the same way a research note is. A document
// written by an older version of this app has to fail visibly rather than
// render as undefined in six places.
import { z } from "zod";

const line = z.string().max(400);
const para = z.string().max(4000);

export const HandoffDeal = z.object({
  crm_id: z.string().nullable(),
  name: line,
  stage: z.number().int().nullable(),
  stage_label: line.nullable(),
  close_date: z.string().nullable(),
  fiscal_quarter: line.nullable(),
  tcv_usd: z.number().nullable(),
  owner: line.nullable(),
  next_step: para.nullable(),
  competitor: line.nullable(),
  partner: line.nullable(),
});

export const HandoffPlay = z.object({
  title: line,
  status: line,
  thesis: para.nullable(),
  owner: line.nullable(),
  next_step: para.nullable(),
  next_step_due: z.string().nullable(),
  deals: z.array(line).max(50),
  people: z.array(line).max(50),
});

export const HandoffContact = z.object({
  name: line,
  title: line.nullable(),
  org: line,
  role: line.nullable(),
  email: line.nullable(),
  notes: para.nullable(),
});

export const HandoffInstallBase = z.object({
  as_of: z.string().nullable(),
  rows: z
    .array(
      z.object({
        product_family: line,
        value_usd: z.number().nullable(),
        share_pct: z.number().nullable(),
        role_note: para.nullable(),
      }),
    )
    .max(100),
});

export const HandoffNote = z.object({
  title: line,
  summary: para,
  findings: z.array(z.object({ text: para, url: z.string().max(1000).nullable(), confidence: line })).max(20),
});

export const HandoffMeeting = z.object({ title: line, held_at: z.string(), summary: para.nullable() });

export const HandoffFollowUp = z.object({ text: para, owner: line.nullable(), due: z.string().nullable() });

export const HandoffReport = z.object({
  // Version, because this shape will change and a stored document has to say
  // which shape it is. Read before the rest of the object is trusted.
  v: z.literal(1),
  generated_at: z.string(),
  generated_by: line,
  account: z.object({
    name: line,
    crm_id: line.nullable(),
    legal_entity: line.nullable(),
    region: line.nullable(),
    segment: line.nullable(),
    hq: line.nullable(),
    thesis: para.nullable(),
  }),
  quarter: line,
  open_pipeline_usd: z.number(),
  deals: z.array(HandoffDeal).max(500),
  plays: z.array(HandoffPlay).max(100),
  contacts: z.array(HandoffContact).max(200),
  install_base: HandoffInstallBase,
  research: z.array(HandoffNote).max(10),
  meetings: z.array(HandoffMeeting).max(20),
  follow_ups: z.array(HandoffFollowUp).max(100),
  // The two fields nothing else in this app has, and the reason a handoff is
  // a document rather than a printout of a screen: what the person handing
  // over is asking for, and anything they want to say that is not on file.
  asks: para,
  note: para.nullable(),
});

export type HandoffReport = z.infer<typeof HandoffReport>;
export type HandoffDeal = z.infer<typeof HandoffDeal>;
export type HandoffPlay = z.infer<typeof HandoffPlay>;
