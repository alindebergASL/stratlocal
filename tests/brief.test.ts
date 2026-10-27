import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { buildContextPack, evidenceIds } from "@/lib/meetings/contextPack";
import { checkBrief } from "@/lib/meetings/brief";
import type { MeetingBrief } from "@/lib/meetings/briefSchema";
import { seedAccount, type Seed } from "./helpers";

function brief(seed: Seed, over: Partial<MeetingBrief> = {}): MeetingBrief {
  return {
    situation: [{ text: "The refresh is the one deal that matters this quarter.", source_refs: [{ kind: "deal", id: seed.dealId }] }],
    deals_in_play: [{ text: "EHR Refresh sits at stage 3 with no agreed next step.", source_refs: [{ kind: "deal", id: seed.dealId }] }],
    attendees: [
      {
        contact_id: seed.contactId,
        name: "Finley Example",
        role_note: "IT leader",
        last_position: null,
        cares_about: null,
        source_refs: [{ kind: "contact", id: seed.contactId }],
      },
    ],
    changes_since_last: [],
    questions: [{ text: "What has to be true for this to close on 11 December?", source_refs: [] }],
    risks: [{ text: "No competitor is recorded, which is itself a gap.", source_refs: [{ kind: "deal", id: seed.dealId }] }],
    proposed_next_step: {
      concern: "The deal has no dated next step.",
      action: "Agree a technical review date before the call ends.",
      owner: "Alex",
      target_date: null,
      blocker: null,
      evidence_ids: [seed.dealId],
    },
    ...over,
  };
}

describe("checkBrief", () => {
  let seed: Seed;
  let ids: Set<string>;
  beforeEach(() => {
    resetDbForTests();
    seed = seedAccount();
    ids = evidenceIds(buildContextPack(seed.accountId));
  });

  it("accepts a brief whose every citation resolves", () => {
    expect(checkBrief(brief(seed), ids)).toEqual([]);
  });

  it("questions may carry no citation; other sections may not", () => {
    expect(checkBrief(brief(seed, { questions: [{ text: "What is the budget cycle?", source_refs: [] }] }), ids)).toEqual([]);
    const findings = checkBrief(brief(seed, { risks: [{ text: "Someone might say no.", source_refs: [] }] }), ids);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe("risks[0].source_refs");
  });

  it("rejects a citation that is not a record we gave the model", () => {
    const findings = checkBrief(
      brief(seed, { situation: [{ text: "There is a second opportunity.", source_refs: [{ kind: "deal", id: "invented-deal" }] }] }),
      ids,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("not a record id you were given");
  });

  it("rejects an attendee bound to an unknown contact and an unknown next-step reference", () => {
    const bad = brief(seed, {
      attendees: [{ contact_id: "ghost", name: "Nobody", role_note: null, last_position: null, cares_about: null, source_refs: [] }],
      proposed_next_step: { ...brief(seed).proposed_next_step, evidence_ids: ["ghost"] },
    });
    const paths = checkBrief(bad, ids).map((f) => f.path);
    expect(paths).toContain("attendees[0].contact_id");
    expect(paths).toContain("proposed_next_step.evidence_ids[0]");
  });
});
