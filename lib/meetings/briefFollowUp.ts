// Turning the brief's proposed next step into a real follow-up.
//
// The rule this has to keep is DECISIONS #1: nothing a model wrote becomes a
// record without a person deciding it. Pre-filling the ordinary follow-up form
// would have been four lines of code and would have broken that quietly — the
// row it wrote would be indistinguishable from one somebody typed, with no
// origin and no evidence on it, and the owner and date would be whatever the
// model guessed.
//
// So this is the proposal path, used exactly as the extraction path uses it: a
// proposal carrying the AI origin and the evidence, then an accept. The accept
// is the person pressing the button with an owner and a date they chose, and
// it re-validates the evidence at that moment — a research finding unticked
// since the brief was written stops the write, in acceptProposal, not here.
//
// Nothing is written by reading the brief or by opening the form. The one
// write happens inside this call, in one transaction, and repeating the call
// does not make a second follow-up.
import { createHash } from "node:crypto";
import { db, type ActionItemRow } from "../db";
import { listUsers } from "../auth";
import { isRealDay } from "../clock";
import { acceptProposal, ApplyError, createProposalBatch } from "../proposals/apply";
import { SourceRef } from "../proposals/schema";
import { getAccount } from "../queries/accounts";
import { getMeeting, listActionItems } from "../queries/meetings";
import { readStoredBrief } from "./briefSchema";
import { readBriefEdits } from "../planning";
import { briefEvidenceResolver } from "./briefEvidence";
import { BriefFingerprint, type BriefFollowUpRecord } from "./briefFollowUpOutcome";
export type { BriefFollowUpRecord } from "./briefFollowUpOutcome";

/**
 * The stored brief this form was rendered from.
 *
 * A regenerated brief is a different next step with different evidence, and a
 * form opened against the old one must not apply to the new one — the text on
 * screen would no longer be the text the record cites.
 */
export function briefFingerprint(briefJson: string | null): string | null {
  return briefJson ? createHash("sha256").update(briefJson).digest("hex").slice(0, 16) : null;
}

export const MAX_FOLLOW_UP_TEXT = 1000;

export type BriefFollowUpInput = {
  accountId: string;
  meetingId: string;
  userId: string;
  /** The fingerprint the form was rendered with. */
  fingerprint: string | null;
  /** The text as the person confirmed it; they may edit what the model wrote. */
  text: string;
  /** A real user id, or "unassigned" said explicitly. */
  ownerChoice: string | null;
  due: string | null;
  dueUnknown: boolean;
  ackEvidence: boolean;
};

export type BriefFollowUpResult = {
  status: "created" | "already";
  itemId: string;
  record: BriefFollowUpRecord;
};

function parseSourceRef(row: { source_ref_json: string | null }): SourceRef | null {
  if (!row.source_ref_json) return null;
  try {
    const parsed = SourceRef.safeParse(JSON.parse(row.source_ref_json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A follow-up on this meeting that came from its brief, with its origin intact. */
function fromBrief(row: ActionItemRow): BriefFollowUpRecord | null {
  const ref = parseSourceRef(row);
  if (!ref || ref.origin !== "ai_generated" || ref.kind !== "ai") return null;
  return {
    id: row.id,
    text: row.text,
    owner: row.owner_user_id ? (listUsers().find((u) => u.id === row.owner_user_id)?.display_name ?? row.owner) : row.owner,
    ownerUserId: row.owner_user_id ?? null,
    due: row.due,
    archivedAt: row.archived_at ?? null,
    evidence: (ref.refs ?? []).filter((r) => r.kind !== "meeting").map((r) => ({ kind: r.kind, id: r.id })),
  };
}

/** What this meeting's brief has already produced, for the page to read back. */
export function briefFollowUps(accountId: string, meetingId: string): BriefFollowUpRecord[] {
  return listActionItems(accountId, { meetingId, includeArchived: true })
    .map(fromBrief)
    .filter((r): r is BriefFollowUpRecord => r !== null);
}

/** Allowed source_ref.id metadata; meeting/evidence refs remain separate. */
function briefIdentity(meetingId: string, fingerprint: string): string {
  return `brief:${meetingId}:${fingerprint}`;
}

/** Read-only outcome lookup, including archived originals and moved items. */
export function briefFollowUpOutcome(accountId: string, meetingId: string, fingerprint: string): BriefFollowUpRecord | null {
  if (!BriefFingerprint.safeParse(fingerprint).success) throw new ApplyError("Invalid brief fingerprint.", "validation");
  const meeting = getMeeting(meetingId);
  if (!meeting || meeting.account_id !== accountId) throw new ApplyError("That meeting is not on this account.", "not_found");
  const identity = briefIdentity(meetingId, fingerprint);
  const row = listActionItems(accountId, { includeArchived: true }).find((r) => {
    const ref = parseSourceRef(r);
    return ref?.kind === "ai" && ref.origin === "ai_generated" && ref.id === identity &&
      ref.refs?.some((r) => r.kind === "meeting" && r.id === meetingId);
  });
  return row ? fromBrief(row) : null;
}

export function createFollowUpFromBrief(input: BriefFollowUpInput): BriefFollowUpResult {
  return db().transaction((): BriefFollowUpResult => {
    const account = getAccount(input.accountId);
    if (!account || account.archived_at) throw new ApplyError("That account is missing or archived.", "state");
    const meeting = getMeeting(input.meetingId);
    // Wrong account, archived, or merged away: all of them mean this form is
    // pointing at something that is no longer the live record.
    if (!meeting || meeting.account_id !== input.accountId) throw new ApplyError("That meeting is not on this account.", "not_found");
    // Recover a prior commit even if the brief/evidence or edited fields have
    // since changed. This performs no write and cannot resurrect an archive.
    if (input.fingerprint && BriefFingerprint.safeParse(input.fingerprint).success) {
      const existing = briefFollowUpOutcome(input.accountId, input.meetingId, input.fingerprint);
      if (existing) return { status: "already", itemId: existing.id, record: existing };
    }
    if (meeting.archived_at || meeting.merged_into) throw new ApplyError("That meeting is archived or merged; restore it first.", "state");

    if (!meeting.brief_json) throw new ApplyError("There is no brief on this meeting to take a next step from.", "state");
    const brief = readStoredBrief(meeting.brief_json);
    if (!brief) throw new ApplyError("The stored brief cannot be read; regenerate it before creating a follow-up.", "validation");
    if (briefFingerprint(meeting.brief_json) !== input.fingerprint) {
      throw new ApplyError("The brief has changed since this was opened. Read the new one, then create the follow-up from it.", "state");
    }

    const text = input.text.trim();
    if (!text) throw new ApplyError("The follow-up needs something to do.", "validation");
    if (text.length > MAX_FOLLOW_UP_TEXT) throw new ApplyError("That follow-up is too long; shorten it to a line.", "validation");

    // Ownership is chosen, never inherited from what the model guessed. The
    // brief's own `owner` field is prose off a model and is not a user.
    if (!input.ownerChoice) throw new ApplyError("Choose an owner, or say that nobody owns it yet.", "validation");
    const ownerUserId = input.ownerChoice === "unassigned" ? null : input.ownerChoice;
    if (ownerUserId && !listUsers().some((u) => u.id === ownerUserId)) throw new ApplyError("That owner is not one of us.", "validation");

    if (input.dueUnknown && input.due) throw new ApplyError("Pick a date, or say there is no date yet — not both.", "validation");
    if (!input.dueUnknown && !input.due) throw new ApplyError("Pick a date, or say there is no date yet.", "validation");
    const due = input.dueUnknown ? null : input.due;
    if (due && !isRealDay(due)) throw new ApplyError("That date is not a real day.", "validation");

    // The evidence comes off the stored brief, never off the form: the browser
    // may say what the text is, because a person read and confirmed it, but it
    // may not say what supports it.
    const resolver = briefEvidenceResolver(input.accountId, { excludeMeetingId: input.meetingId });
    const cited = brief.proposed_next_step.evidence_ids;
    const live = cited.flatMap((id) => {
      const kind = resolver.kindOf(id);
      return kind ? [{ kind, id }] : [];
    });
    if (live.length !== cited.length) {
      throw new ApplyError("The records behind this next step are no longer current. Regenerate the brief and read it before creating a follow-up.", "state");
    }

    const sourceRef: SourceRef = {
      kind: "ai",
      id: briefIdentity(input.meetingId, input.fingerprint!),
      origin: "ai_generated",
      // The model's own wording, kept beside the row even when the person
      // edited the text, so the record says what was suggested and what was
      // agreed.
      quote: (readBriefEdits(meeting.brief_edits_json)?.original.proposed_next_step.action ?? brief.proposed_next_step.action).slice(0, 1000),
      verification: "source_excerpt",
      refs: [{ kind: "meeting", id: input.meetingId }, ...live],
    };
    // A research ref is a public-web excerpt: acceptProposal re-checks it and
    // asks for an acknowledgment when it is not source-bound. Saying so here
    // means the ask is the one the review path already makes.
    const researchRefs = live.filter((r) => r.kind === "research");
    if (researchRefs.some((r) => resolver.resolve({ kind: "research", id: r.id }).verification !== "source_excerpt")) {
      sourceRef.verification = "report_excerpt";
    }

    const batch = createProposalBatch(input.accountId, { kind: "meeting", id: input.meetingId, aiRunId: null }, [
      {
        entity_type: "action_item",
        op: "create",
        payload: {
          text,
          owner_user_id: ownerUserId,
          due,
          meeting_id: input.meetingId,
          status: "open",
          source_ref: sourceRef,
        },
        rationale: `${meeting.brief_edits_json ? "Human-edited preparation based on the original AI brief" : "Proposed by the brief for this meeting"}: ${brief.proposed_next_step.concern}`.slice(0, 500),
        source_ref: sourceRef,
      },
    ]);
    const proposalId = batch.ids[0];
    // createProposalBatch drops a draft somebody already rejected. Silence
    // there would look like success with nothing written.
    if (!proposalId) throw new ApplyError("This exact follow-up was declined before. Edit it, or write it down yourself.", "state");

    const decided = acceptProposal(proposalId, input.userId, { ackEvidence: input.ackEvidence });
    if (decided.status !== "accepted" || !decided.entityId) {
      throw new ApplyError(decided.message ?? "That follow-up could not be created.", decided.status === "conflict" ? "conflict" : "state");
    }
    const record = briefFollowUpOutcome(input.accountId, input.meetingId, input.fingerprint!);
    if (!record || record.id !== decided.entityId) throw new ApplyError("The saved follow-up could not be read back.", "state");
    return { status: "created", itemId: decided.entityId, record };
  })();
}
