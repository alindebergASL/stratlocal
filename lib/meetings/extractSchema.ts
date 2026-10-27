import { z } from "zod";
import { ContactOrg, ContactRole, PlayStatus } from "../proposals/schema";
import { Meddpicc } from "../playbook/schema";

// Every claimed change carries the words from the notes that support it. The
// quote is checked against the notes in code before anything is shown.
const quote = z.string().min(4).max(1000);
const nstr = z.string().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const ExtractedActionItem = z.object({
  text: z.string().min(1).max(2000),
  owner: nstr,
  due: isoDate,
  quote,
});

export const ExtractedDealUpdate = z.object({
  deal_id: z.string().min(1),
  stage: z.number().int().min(1).max(6).nullable(),
  next_step: nstr,
  notes: nstr,
  quote,
});

export const ExtractedPlayUpdate = z.object({
  play_id: z.string().min(1),
  status: PlayStatus.nullable(),
  next_step: nstr,
  quote,
});

export const ExtractedContactUpdate = z.object({
  contact_id: nstr,
  name: z.string().min(1),
  title: nstr,
  role: ContactRole.nullable(),
  org: ContactOrg.nullable(),
  notes: nstr,
  quote,
});

// What the notes establish about one qualification element (DECISIONS #72).
// Only asked for when the team has a playbook.
export const ExtractedQualification = z.object({
  element: Meddpicc,
  status: z.enum(["partial", "confirmed"]),
  evidence: z.string().min(1).max(1000),
  quote,
});

export const MeetingExtraction = z.object({
  summary: z.string().max(4000),
  action_items: z.array(ExtractedActionItem),
  deal_updates: z.array(ExtractedDealUpdate),
  play_updates: z.array(ExtractedPlayUpdate),
  contact_updates: z.array(ExtractedContactUpdate),
  qualification: z.array(ExtractedQualification).optional(),
});

export type MeetingExtraction = z.infer<typeof MeetingExtraction>;
export type ExtractedDealUpdate = z.infer<typeof ExtractedDealUpdate>;
export type ExtractedContactUpdate = z.infer<typeof ExtractedContactUpdate>;
export type ExtractedQualification = z.infer<typeof ExtractedQualification>;
