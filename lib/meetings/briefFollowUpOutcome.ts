// Shared wire contract for this form only. No server/database imports.
import { z } from "zod";

export const BriefFingerprint = z.string().regex(/^[a-f0-9]{16}$/);
export const BriefFollowUpRecordSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  owner: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  due: z.string().nullable(),
  archivedAt: z.string().nullable(),
  evidence: z.array(z.object({ kind: z.string(), id: z.string() })),
});
export type BriefFollowUpRecord = z.infer<typeof BriefFollowUpRecordSchema>;

export const BriefFollowUpReply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), status: z.enum(["created", "already"]), record: BriefFollowUpRecordSchema }),
  z.object({ ok: z.literal(false), error: z.string().min(1), noWrite: z.literal(true) }),
]);
export type BriefFollowUpReply = z.infer<typeof BriefFollowUpReply>;

export const BriefFollowUpCheck = z.discriminatedUnion("status", [
  z.object({ ok: z.literal(true), status: z.literal("found"), fingerprint: BriefFingerprint, record: BriefFollowUpRecordSchema }),
  z.object({ ok: z.literal(true), status: z.literal("absent"), fingerprint: BriefFingerprint }),
]);
