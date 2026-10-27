import { expect, it } from "vitest";
import { selectEvidence } from "@/lib/research/evidence";
import { urlKey } from "@/lib/ai/runWebResearch";
import { PlanDraft } from "@/lib/plan/schema";
import { acceptNote, storeDraftNote, researchForPrompt } from "@/lib/research/notes";
import { planReadiness } from "@/lib/ai/readiness";
import { applyEntityChange, createProposalBatch, acceptProposal } from "@/lib/proposals/apply";
import { USER } from "./helpers";
const finding = (text: string, topic = "org") => ({
  text,
  quote: text,
  url: "https://example.com/a",
  confidence: "high" as const,
  topic: topic as "org",
  date: null,
});
const meta = {
  title: "Original",
  summary: "REJECTED assertion",
  open_questions: ["REJECTED question"],
  findings: [finding("Kept fact"), finding("REJECTED fact")],
  accepted_finding_indexes: [0],
  focus: null,
  depth: "standard" as const,
  generated_at: "2026-09-16",
  searches: 0,
  fetches: 0,
  dropped: [],
  sources: [],
};
it("projects only retained immutable evidence, never original summaries/questions", () => {
  // This used to assert the property against `acceptedProjection`, a function
  // the UI never called — so it was true of a projection nothing projected.
  // The surface that actually decides is `researchForPrompt`, which is what a
  // brief and a plan draft read: it is built from kept findings, so a note's
  // own summary and open questions — model prose about web pages, never
  // reviewed line by line — must not be in it, and neither must a finding
  // somebody unticked.
  const { accountId } = saved();
  const prompt = researchForPrompt(accountId);
  expect(prompt).toContain("Kept fact");
  expect(prompt).not.toContain("REJECTED");
});
it("balances topics and retains late CIO evidence with exact included ids", () => {
  const m = {
    ...meta,
    findings: Array.from({ length: 40 }, (_, i) => finding(i === 30 ? "Dana is CIO" : `Organisation detail ${i}`, i === 30 ? "leadership" : "org")),
    accepted_finding_indexes: undefined,
  };
  const selected = selectEvidence([{ doc: { id: "n" }, meta: m }], "people technology", 12);
  expect(selected.included.some((e) => e.index === 30)).toBe(true);
  expect(selected.included).toHaveLength(12);
  expect(selected.omitted).toBe(28);
  expect(new Set(selected.included.map((e) => e.id)).size).toBe(12);
});
it("rejects userinfo links and supports discovery-only plans", () => {
  expect(urlKey("https://trusted.example@evil.example/a")).toBeNull();
  expect(
    PlanDraft.safeParse({
      thesis: "Insufficient evidence: discovery only",
      plays: [],
    }).success,
  ).toBe(true);
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
      summary: meta.summary,
      findings: meta.findings,
      open_questions: meta.open_questions,
    },
    prose: "Immutable original",
    focus: null,
    depth: "standard",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
  acceptNote(doc.id, [0], USER);
  return { accountId, doc };
}
it("zero retained evidence is not plan readiness and does not leak through prompts", () => {
  const { accountId, doc } = saved();
  acceptNote(doc.id, [], USER);
  expect(planReadiness(accountId)).not.toBeNull();
  expect(researchForPrompt(accountId)).toBe("");
});
it("refuses pending proposals after supporting finding is removed", () => {
  const { accountId, doc } = saved();
  const b = createProposalBatch(accountId, { kind: "plan_draft", id: null, aiRunId: null }, [
    {
      entity_type: "action_item",
      op: "create",
      payload: { text: "Validate fact" },
      source_ref: { kind: "research", id: doc.id, finding_index: 0 },
    },
  ]);
  acceptNote(doc.id, [], USER);
  expect(() => acceptProposal(b.ids[0]!, USER)).toThrow(/evidence/i);
});
