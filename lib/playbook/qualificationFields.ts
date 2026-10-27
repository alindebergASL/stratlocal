// The qualification scorecard as account fields, one per element, so each
// element is its own proposal, its own drift check and its own history line
// through the one write path (DECISIONS #72).
import { z } from "zod";
import { MEDDPICC, MEDDPICC_LABELS, type Meddpicc } from "./schema";

export const QUALIFICATION_STATUS = ["unknown", "partial", "confirmed"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUS)[number];

export const QualificationValue = z
  .object({
    status: z.enum(QUALIFICATION_STATUS),
    evidence: z.string().trim().max(1000).default(""),
  })
  .strict();
export type QualificationValue = z.infer<typeof QualificationValue>;

export const qualificationField = (e: Meddpicc) => `meddpicc_${e.toLowerCase()}` as const;
export const QUALIFICATION_FIELDS = MEDDPICC.map(qualificationField);
export const QUALIFICATION_COLUMNS: Record<string, string> = Object.fromEntries(QUALIFICATION_FIELDS.map((f) => [f, `${f}_json`]));
export const QUALIFICATION_LABELS: Record<string, string> = Object.fromEntries(MEDDPICC.map((e) => [qualificationField(e), MEDDPICC_LABELS[e]]));

export const qualificationPatchShape = Object.fromEntries(QUALIFICATION_FIELDS.map((f) => [f, QualificationValue.nullable()])) as Record<
  ReturnType<typeof qualificationField>,
  z.ZodNullable<typeof QualificationValue>
>;
