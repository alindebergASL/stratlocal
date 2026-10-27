// What a plan draft may say.
//
// Every string is bounded below the matching limit in
// lib/proposals/schema.ts (PlayPatch.title is 400, thesis and next_step are
// 4000, AccountPatch.thesis is 4000). createProposalBatch parses each draft
// inside one transaction with no per-draft try, so a single over-long field
// would lose the whole batch. Bounding the output here keeps that failure
// inside runStructured's repair loop, which is where it can be fixed.
import { z } from "zod";
import { EvidenceRef } from "../meetings/briefSchema";

export const DraftPlay = z
  .object({
    title: z.string().trim().min(1).max(120),
    thesis: z.string().trim().min(1).max(1200),
    next_step: z.string().trim().max(300).nullable(),
    owner_suggestion: z.string().trim().max(120).nullable(),
    linked_deal_ids: z.array(z.string().trim().min(1)).max(20),
    linked_contact_ids: z.array(z.string().trim().min(1)).max(20),
    source_refs: z.array(EvidenceRef).min(1).max(8),
  })
  .strict();

export type DraftPlay = z.infer<typeof DraftPlay>;

// There is deliberately no status field. PlayStatus includes "dropped", and
// createProposalBatch blocks only archived_at — so letting the model propose
// a status would let it retire a play by another name. Status is set to
// "proposed" on a create and never touched on an update; whether a play is
// active, stalled or dropped is a person's call.
export const PlanDraft = z
  .object({
    thesis: z.string().trim().min(1).max(1500),
    plays: z.array(DraftPlay).max(6),
  })
  .strict();

export type PlanDraft = z.infer<typeof PlanDraft>;
