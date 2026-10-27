import { expect, it } from "vitest";
import { acceptNote, storeDraftNote, resolveNote, parseNote, researchSelection } from "@/lib/research/notes";
import { sanitizeResearchNote } from "@/lib/research/extract";
import { ModelResearchNote } from "@/lib/research/schema";
import { updatesToDrafts, SuggestedUpdates } from "@/lib/research/updates";
import { fakeAnswer } from "@/lib/ai/fake";
import { urlKey, harvestEvidence } from "@/lib/ai/runWebResearch";
import { db } from "@/lib/db";
import { applyEntityChange, createProposalBatch, acceptProposal, rejectProposal } from "@/lib/proposals/apply";
import { USER } from "./helpers";
const finding = (text: string) => ({
  text,
  quote: text,
  url: "https://example.com/a",
  confidence: "high" as const,
  topic: "leadership" as const,
  date: null,
});
function saved() {
  const accountId = applyEntityChange({
    accountId: "",
    entityType: "account",
    op: "create",
    payload: { name: "Synthetic" },
    actorUserId: USER,
  }).entityId;
  const doc = storeDraftNote({
    accountId,
    userId: USER,
    aiRunId: "test",
    note: {
      title: "Original",
      summary: "Unsafe summary",
      findings: [finding("Dana Rivera, chief information officer, started in May 2026"), finding("New published leadership appointment")],
      open_questions: [],
    },
    prose: "Immutable original",
    focus: null,
    depth: "standard",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
  acceptNote(doc.id, [0, 1], USER);
  return { accountId, doc };
}
it("rejects model evidence and binds original quote only to its exact URL", () => {
  const f = {
    ...finding("Report says something factual"),
    source_quote: "Original source passage",
    evidence: { kind: "source_excerpt" as const, text: "Forged" },
  };
  const n = { title: "Test", summary: "", findings: [f], open_questions: [] };
  expect(ModelResearchNote.safeParse(n).success).toBe(false);
  const sources = new Map([[urlKey(f.url)!, f.url]]);
  expect(sanitizeResearchNote(n, f.quote, sources).note.findings[0]?.evidence?.kind).toBe("report_excerpt");
  expect(sanitizeResearchNote(n, f.quote, sources, [{ url: f.url, text: "Original source passage is real." }]).note.findings[0]?.evidence?.kind).toBe("source_excerpt");
  expect(sanitizeResearchNote(n, f.quote, sources, [{ url: "http://example.com/a", text: "Original source passage" }]).note.findings[0]?.evidence?.kind).toBe("report_excerpt");
});
it("resolves with actor/time history without changing originals or selected indexes", () => {
  const { accountId, doc } = saved();
  const result = resolveNote(doc.id, 0, [`${doc.id}#1`], "New evidence replaces old assertion", USER);
  const m = parseNote(result)!.meta;
  expect(m.accepted_finding_indexes).toEqual([0, 1]);
  expect(m.findings).toEqual(parseNote(doc)!.meta.findings);
  expect(result.content_text).toBe("Immutable original");
  expect(m.resolutions?.[0]).toMatchObject({
    actor: USER,
    obsolete_index: 0,
    supporting_ids: [`${doc.id}#1`],
  });
  expect(m.resolutions?.[0]?.at).toBeTruthy();
  expect(researchSelection(accountId).included.map((e) => e.index)).toEqual([1]);
  expect(() => resolveNote(doc.id, 1, [`${doc.id}#0`], "cycle", USER)).toThrow();
  expect(() => resolveNote(doc.id, 1, [`${doc.id}#1`], "self", USER)).toThrow();
  expect(() => resolveNote(doc.id, 1, [], "empty", USER)).toThrow();
});
it("rejects cross-account and unretained resolution support", () => {
  const a = saved(),
    b = saved();
  expect(() => resolveNote(a.doc.id, 0, [`${b.doc.id}#0`], "different account", USER)).toThrow();
  acceptNote(a.doc.id, [0], USER);
  expect(() => resolveNote(a.doc.id, 0, [`${a.doc.id}#1`], "unchecked", USER)).toThrow();
});
it("requires legacy report acknowledgment and preserves typed refs in apply history", () => {
  const { accountId, doc } = saved();
  const ref = {
    kind: "research" as const,
    id: doc.id,
    finding_index: 0,
    origin: "ai_generated" as const,
    refs: [
      { kind: "research" as const, id: doc.id, finding_index: 0 },
      { kind: "account" as const, id: accountId },
    ],
  };
  const b = createProposalBatch(accountId, { kind: "plan_draft", id: "research_updates", aiRunId: null }, [
    {
      entity_type: "action_item",
      op: "create",
      payload: { text: "Check public fact" },
      source_ref: ref,
    },
  ]);
  expect(() => acceptProposal(b.ids[0]!, USER)).toThrow(/acknowledge/i);
  expect(acceptProposal(b.ids[0]!, USER, { ackEvidence: true }).status).toBe("accepted");
  const log = db().prepare("SELECT source_ref_json FROM change_log WHERE proposal_id=? LIMIT 1").get(b.ids[0]) as { source_ref_json: string };
  expect(JSON.parse(log.source_ref_json)).toEqual(ref);
});
it.each(["pending", "accepted", "rejected"])("dedupes repeated research update in %s state", (status) => {
  const { accountId } = saved();
  const origin = {
    kind: "plan_draft" as const,
    id: "research_updates",
    aiRunId: null,
  };
  const drafts = [
    {
      entity_type: "action_item" as const,
      op: "create" as const,
      payload: { text: "Validate deployment" },
    },
  ];
  const first = createProposalBatch(accountId, origin, drafts);
  if (status === "accepted") acceptProposal(first.ids[0]!, USER);
  if (status === "rejected") rejectProposal(first.ids[0]!, USER);
  expect(createProposalBatch(accountId, origin, drafts).ids).toHaveLength(0);
});
it("fake updates use explicit named evidence, not installed metrics", () => {
  const { accountId } = saved();
  const evidence = researchSelection(accountId).included;
  const response = SuggestedUpdates.parse(fakeAnswer("plan_draft", { researchUpdates: evidence }));
  const drafts = updatesToDrafts(accountId, response, evidence);
  expect(drafts[0]).toMatchObject({
    entity_type: "contact",
    op: "create",
    payload: { name: "Dana Rivera", title: "chief information officer" },
  });
  expect(drafts.some((d) => d.entity_type === "install_base")).toBe(false);
  expect(() =>
    updatesToDrafts(
      accountId,
      {
        updates: [
          {
            type: "contact",
            name: "Invented Person",
            title: "CIO",
            evidence_id: evidence[0]!.id,
          },
        ],
      },
      evidence,
    ),
  ).toThrow(/explicit/i);
  expect(
    SuggestedUpdates.safeParse({
      updates: [
        {
          type: "contact",
          name: "Dana Rivera",
          title: "",
          evidence_id: evidence[0]!.id,
        },
      ],
    }).success,
  ).toBe(false);
});
it("captures bounded plain-text documents and rejects unsafe source URLs", () => {
  const envelope = (url: string) => ({
    type: "web_fetch_tool_result",
    content: {
      type: "web_fetch_result",
      url,
      content: { source: { type: "plain_text", data: "x".repeat(50000) } },
    },
  });
  const result = harvestEvidence([envelope("https://example.com/a"), envelope("https://name:password@example.com/a")]);
  expect(result).toHaveLength(1);
  expect(result[0]?.text).toHaveLength(24000);
});
it("rejects named-contact duplicates that appear between generation and acceptance", () => {
  const { accountId } = saved(),
    evidence = researchSelection(accountId).included;
  const drafts = updatesToDrafts(accountId, SuggestedUpdates.parse(fakeAnswer("plan_draft", { researchUpdates: evidence })), evidence);
  const b = createProposalBatch(accountId, { kind: "plan_draft", id: "research_updates", aiRunId: null }, drafts);
  applyEntityChange({
    accountId,
    entityType: "contact",
    op: "create",
    payload: { name: "Dana Rivera" },
    actorUserId: USER,
  });
  expect(() => acceptProposal(b.ids[0]!, USER, { ackEvidence: true })).toThrow(/matching record/i);
});
it("detects stale account field updates before applying", () => {
  const { accountId } = saved();
  const b = createProposalBatch(accountId, { kind: "plan_draft", id: "research_updates", aiRunId: null }, [
    {
      entity_type: "account",
      entity_id: accountId,
      op: "update",
      payload: { hq: "First city" },
    },
  ]);
  applyEntityChange({
    accountId,
    entityType: "account",
    entityId: accountId,
    op: "update",
    payload: { hq: "Human edit" },
    actorUserId: USER,
  });
  expect(acceptProposal(b.ids[0]!, USER).status).toBe("conflict");
});
