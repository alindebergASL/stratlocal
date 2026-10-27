// SYNTHETIC ONLY: invented sandbox ids, people and amounts.
//
// The conversation view of a brief, and what its citations resolve to once the
// records have moved underneath them. The things that would be silently wrong
// rather than loudly broken are what is covered: a brief written before this
// view existed, a finding that was unticked afterwards, a ref naming a record
// on another account, and a ref whose kind does not match the record it names.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { insertResearchNote, insertLargeResearchNote } from "./briefFixtures";
import { archiveDocument } from "@/lib/documents";
import { acceptNote, researchSelection } from "@/lib/research/notes";
import { applyEntityChange } from "@/lib/proposals/apply";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeetingBriefView, briefSubtitle } from "@/components/MeetingBrief";
import { buildContextPack, evidenceIndex } from "@/lib/meetings/contextPack";
import { checkBrief } from "@/lib/meetings/brief";
import { MeetingBrief } from "@/lib/meetings/briefSchema";
import { briefEvidenceResolver, resolveBriefEvidence, refKey } from "@/lib/meetings/briefEvidence";
import { briefRefs, conversationView, readingMinutes } from "@/lib/meetings/briefView";
import { seedAccount, USER, type Seed } from "./helpers";

// A brief in the shape that was stored before the conversation view existed.
// Kept as a literal on purpose: it is the JSON already on disk, and it has to
// keep parsing and rendering exactly as it did.
function legacyBriefJson(seed: Seed): string {
  return JSON.stringify({
    situation: [{ text: "The refresh is the one deal that matters this quarter.", source_refs: [{ kind: "deal", id: seed.dealId }] }],
    deals_in_play: [{ text: "EHR Refresh sits at stage 3 with no agreed next step.", source_refs: [{ kind: "deal", id: seed.dealId }] }],
    attendees: [
      { contact_id: seed.contactId, name: "Finley Example", role_note: "IT leader", last_position: null, cares_about: null, source_refs: [{ kind: "contact", id: seed.contactId }] },
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
  });
}

let seed: Seed;

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("evidence cited only by the next step", () => {
  function onlyNextStep(ids: string[]) {
    const brief = MeetingBrief.parse(JSON.parse(legacyBriefJson(seed)));
    for (const key of ["situation", "deals_in_play", "attendees", "changes_since_last", "questions", "risks"] as const) brief[key] = [];
    brief.proposed_next_step.evidence_ids = ids;
    return brief;
  }

  it("includes an exact retained finding outside the prompt cap in the inventory and next-step links", () => {
    const note = insertLargeResearchNote(seed.accountId);
    const brief = onlyNextStep([`${note}#25`]);
    const { map, nextStepEvidence } = resolveBriefEvidence(brief, briefEvidenceResolver(seed.accountId));
    expect(map.size).toBe(1);
    expect(nextStepEvidence[0]?.status).toBe("current");
    expect(nextStepEvidence[0]?.asOf).toBe("2026-07-25");
    const html = renderToStaticMarkup(React.createElement(MeetingBriefView, { brief, map, nextStepRefs: nextStepEvidence.map(e => e.requested) }));
    expect(html).not.toContain("This brief cites no record.");
    const card = html.split('data-testid="brief-next-step"')[1]!.split('data-testid="brief-next-step-meta"')[0]!;
    expect(card).toContain(`finding-${note}-25`);
    expect(html).toContain('data-testid="brief-source"');
  });

  it("keeps next-step-only missing evidence visible instead of claiming no citation exists", () => {
    const note = insertResearchNote(seed.accountId);
    const brief = onlyNextStep([`${note}#0`]);
    archiveDocument(note, USER);
    const { map, nextStepEvidence } = resolveBriefEvidence(brief, briefEvidenceResolver(seed.accountId));
    expect(map.size).toBe(1);
    expect(nextStepEvidence[0]?.status).toBe("missing");
    expect(nextStepEvidence[0]?.href).toBeNull();
    const html = renderToStaticMarkup(React.createElement(MeetingBriefView, { brief, map, nextStepRefs: nextStepEvidence.map(e => e.requested) }));
    expect(html).toContain("evidence unavailable");
    expect(html).not.toContain("This brief cites no record.");
  });

  it("does not turn another account's next-step-only citation into a link", () => {
    const other = seedAccount({ name: "Synthetic Other Lab", dealId: "SYN-OTHER-NEXT" });
    const brief = onlyNextStep([other.dealId]);
    const { nextStepEvidence } = resolveBriefEvidence(brief, briefEvidenceResolver(seed.accountId));
    expect(nextStepEvidence[0]?.status).toBe("missing");
    expect(nextStepEvidence[0]?.href).toBeNull();
  });
});

describe("a brief written before the conversation view", () => {
  it("still parses, and every section it had survives", () => {
    const parsed = MeetingBrief.safeParse(JSON.parse(legacyBriefJson(seed)));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.conversation).toBeUndefined();
    expect(parsed.success && parsed.data.risks).toHaveLength(1);
  });

  it("gets a purpose and a hypothesis of nothing rather than an invented one", () => {
    const brief = MeetingBrief.parse(JSON.parse(legacyBriefJson(seed)));
    const view = conversationView(brief);
    expect(view.written).toBe(false);
    expect(view.purpose).toBeNull();
    expect(view.hypothesis).toBeNull();
    expect(view.uncertainty).toBeNull();
  });

  it("leads with claims the old brief already made, marked as selected, never padded to three", () => {
    const brief = MeetingBrief.parse(JSON.parse(legacyBriefJson(seed)));
    const view = conversationView(brief);
    expect(view.factsSelected).toBe(true);
    expect(view.facts.length).toBeLessThanOrEqual(3);
    // Two cited claims in the old brief's situation and deals; the risk line
    // is cited too, so three is what it has — and each is a sentence the old
    // brief already contained.
    expect(view.facts.map((f) => f.text)).toEqual([
      "The refresh is the one deal that matters this quarter.",
      "EHR Refresh sits at stage 3 with no agreed next step.",
      "No competitor is recorded, which is itself a gap.",
    ]);
    expect(view.questions.map((q) => q.text)).toEqual(["What has to be true for this to close on 11 December?"]);
    expect(view.nextStep.action).toBe("Agree a technical review date before the call ends.");
  });

  it("only claims a deal connection when a claim actually cites a deal", () => {
    const brief = MeetingBrief.parse(JSON.parse(legacyBriefJson(seed)));
    expect(conversationView(brief).connection?.refs[0]!.id).toBe(seed.dealId);
    const noDeals = MeetingBrief.parse({ ...JSON.parse(legacyBriefJson(seed)), deals_in_play: [] });
    expect(conversationView(noDeals).connection).toBeNull();
  });

  it("caps facts and questions at three however long the old brief is", () => {
    const many = JSON.parse(legacyBriefJson(seed));
    many.situation = Array.from({ length: 5 }, (_, i) => ({ text: `Claim ${i}.`, source_refs: [{ kind: "deal", id: seed.dealId }] }));
    many.questions = Array.from({ length: 6 }, (_, i) => ({ text: `Question ${i}?`, source_refs: [] }));
    const view = conversationView(MeetingBrief.parse(many));
    expect(view.facts).toHaveLength(3);
    expect(view.questions).toHaveLength(3);
    expect(readingMinutes(view)).toBeGreaterThanOrEqual(1);
  });
});

describe("what a citation resolves to now", () => {
  it.each([24, 25])("resolves retained finding #%s omitted by prompt cap or text dedup, at its exact date/index", (index) => {
    const noteId = insertLargeResearchNote(seed.accountId);
    const id = `${noteId}#${index}`;
    const selection = researchSelection(seed.accountId);
    expect(selection.included).toHaveLength(24);
    expect(selection.included.some((r) => r.id === id)).toBe(false);
    expect(evidenceIndex(buildContextPack(seed.accountId)).has(id)).toBe(false);
    const resolved = briefEvidenceResolver(seed.accountId).resolve({ kind: "research", id });
    expect(resolved.status).toBe("current");
    expect(resolved.href).toBe(`/accounts/${seed.accountId}/research?note=${noteId}&finding=${index}#finding-${noteId}-${index}`);
    expect(resolved.asOf).toBe(index === 25 ? "2026-07-25" : "2026-07-24");
  });

  it("resolves an unsummarized old meeting and completed action excluded from the prompt", () => {
    const actionId = applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", actorUserId: USER, payload: { text: "Synthetic completed action", status: "done" } }).entityId;
    const promptIds = evidenceIndex(buildContextPack(seed.accountId));
    expect(promptIds.has(seed.meetingId)).toBe(false);
    expect(promptIds.has(actionId)).toBe(false);
    const resolver = briefEvidenceResolver(seed.accountId);
    expect(resolver.resolve({ kind: "meeting", id: seed.meetingId })).toMatchObject({ status: "current", asOf: "2026-09-15" });
    expect(resolver.resolve({ kind: "action_item", id: actionId }).status).toBe("current");
  });

  it("links a research ref at the exact finding, with the evidence date", () => {
    const noteId = insertResearchNote(seed.accountId, { sourceExcerpt: true });
    const resolver = briefEvidenceResolver(seed.accountId);
    const resolved = resolver.resolve({ kind: "research", id: `${noteId}#1` });
    expect(resolved.status).toBe("current");
    expect(resolved.href).toBe(`/accounts/${seed.accountId}/research?note=${noteId}&finding=1#finding-${noteId}-1`);
    // The finding's own date, not the day the page was rendered.
    expect(resolved.asOf).toBe("2026-08-01");
    expect(resolved.verification).toBe("source_excerpt");
  });

  it("says unavailable, with a reason, when the finding was unticked in a re-review", () => {
    const noteId = insertResearchNote(seed.accountId);
    acceptNote(noteId, [0], USER);
    const resolved = briefEvidenceResolver(seed.accountId).resolve({ kind: "research", id: `${noteId}#1` });
    expect(resolved.status).toBe("missing");
    expect(resolved.href).toBeNull();
    expect(resolved.reason).toMatch(/unavailable/);
  });

  it("says unavailable when the whole note was retracted", () => {
    const noteId = insertResearchNote(seed.accountId);
    archiveDocument(noteId, USER);
    expect(briefEvidenceResolver(seed.accountId).resolve({ kind: "research", id: `${noteId}#0` }).status).toBe("missing");
  });

  it("refuses to link an id cited as the wrong kind of record", () => {
    // The deal id is real and is on this account; the brief calls it a play.
    const resolved = briefEvidenceResolver(seed.accountId).resolve({ kind: "play", id: seed.dealId });
    expect(resolved.status).toBe("kind_mismatch");
    expect(resolved.href).toBeNull();
    expect(resolved.reason).toContain("deal");
  });

  it("fails closed on a record belonging to another account", () => {
    const other = seedAccount({ name: "Synthetic Fernbrook", dealId: "SYN-DEAL-002" });
    const resolved = briefEvidenceResolver(seed.accountId).resolve({ kind: "deal", id: other.dealId });
    expect(resolved.status).toBe("missing");
    expect(resolved.href).toBeNull();
  });

  it("keeps two claims about one id apart when they claim different kinds", () => {
    const map = briefEvidenceResolver(seed.accountId).resolveAll([
      { kind: "deal", id: seed.dealId },
      { kind: "contact", id: seed.dealId },
    ]);
    expect(map.get(refKey({ kind: "deal", id: seed.dealId }))!.status).toBe("current");
    expect(map.get(refKey({ kind: "contact", id: seed.dealId }))!.status).toBe("kind_mismatch");
  });

  it("collects every ref the brief cites, conversation and sections alike", () => {
    const brief = MeetingBrief.parse({
      ...JSON.parse(legacyBriefJson(seed)),
      conversation: {
        purpose: "Settle the review date.",
        facts: [{ text: "The play is active.", source_refs: [{ kind: "play", id: seed.playId }] }],
        hypothesis: null,
        questions: ["Who signs?"],
        connection: null,
        uncertainty: null,
      },
    });
    const ids = briefRefs(brief).map((r) => r.id);
    expect(ids).toContain(seed.playId);
    expect(ids).toContain(seed.dealId);
    expect(ids).toContain(seed.contactId);
  });
});

describe("what the model is allowed to come back with", () => {
  function ids() {
    return new Set(evidenceIndex(buildContextPack(seed.accountId)).keys());
  }
  function kinds() {
    return new Map([...evidenceIndex(buildContextPack(seed.accountId))].map(([id, e]) => [id, e.kind as string]));
  }
  function withConversation(over: Record<string, unknown>) {
    return MeetingBrief.parse({
      ...JSON.parse(legacyBriefJson(seed)),
      conversation: { purpose: "Settle the review date.", facts: [], hypothesis: null, questions: [], connection: null, uncertainty: null, ...over },
    });
  }

  it("requires a fact to cite a record", () => {
    // The schema will not even hold an uncited fact.
    expect(() => withConversation({ facts: [{ text: "They are ready to buy.", source_refs: [] }] })).toThrow();
  });

  it("rejects a fact citing an id that is not on this account", () => {
    const other = seedAccount({ name: "Synthetic Fernbrook", dealId: "SYN-DEAL-002" });
    const findings = checkBrief(withConversation({ facts: [{ text: "Another deal is open.", source_refs: [{ kind: "deal", id: other.dealId }] }] }), ids(), kinds());
    expect(findings.map((f) => f.path)).toContain("conversation.facts[0].source_refs[0].id");
  });

  it("rejects a ref whose kind does not match the record", () => {
    const findings = checkBrief(withConversation({ facts: [{ text: "The play is live.", source_refs: [{ kind: "play", id: seed.dealId }] }] }), ids(), kinds());
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("is a deal in the JSON");
  });

  it("will not let research alone establish a connection to a deal", () => {
    const noteId = insertResearchNote(seed.accountId);
    const findings = checkBrief(
      withConversation({ connection: { text: "This meeting is about their capital plan.", source_refs: [{ kind: "research", id: `${noteId}#0` }] } }),
      ids(),
      kinds(),
    );
    expect(findings.map((f) => f.path)).toContain("conversation.connection.source_refs");
    // Citing the deal is what makes it a connection.
    expect(checkBrief(withConversation({ connection: { text: "This meeting is about the refresh.", source_refs: [{ kind: "deal", id: seed.dealId }] } }), ids(), kinds())).toEqual([]);
  });

  it("accepts a hypothesis resting on nothing, because that is what a hypothesis is", () => {
    const findings = checkBrief(withConversation({ hypothesis: { text: "They are waiting on a decision.", unknown: "Nothing on file says who decides.", based_on: [] } }), ids(), kinds());
    expect(findings).toEqual([]);
  });

  it("still checks the old sections exactly as it did", () => {
    const brief = MeetingBrief.parse({ ...JSON.parse(legacyBriefJson(seed)), risks: [{ text: "Someone might say no.", source_refs: [] }] });
    expect(checkBrief(brief, ids()).map((f) => f.path)).toEqual(["risks[0].source_refs"]);
  });
});

describe("truthful compact brief copy", () => {
  it("states absent fields without claiming verification or no evidence in the world", () => {
    const brief = MeetingBrief.parse({ ...JSON.parse(legacyBriefJson(seed)), situation: [], deals_in_play: [], risks: [], questions: [] });
    const html = renderToStaticMarkup(React.createElement(MeetingBriefView, { brief, map: new Map() }));
    for (const copy of ["Not recorded in this brief: purpose, cited facts, hypothesis, questions, deal or play connection, uncertainty note.", "These gaps remain unresolved", "Full brief &amp; evidence", "not assigned", "no date agreed yet"]) expect(html).toContain(copy);
    expect(html).not.toMatch(/nothing beyond|That is the finding|did not raise/);
    expect(briefSubtitle(brief)).toMatch(/^For meeting attendees · about \d+ minutes? to read$/);
  });

  it("labels legacy selected facts without implying a new authored summary", () => {
    const brief = MeetingBrief.parse(JSON.parse(legacyBriefJson(seed)));
    const html = renderToStaticMarkup(React.createElement(MeetingBriefView, { brief, map: new Map() }));
    expect(html).toContain("Selected from the full brief.");
  });
});
