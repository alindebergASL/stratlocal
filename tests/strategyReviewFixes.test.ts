import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FindingRow } from "@/components/FindingList";
import { explicitCurrentRole } from "@/lib/research/people";
import { selectEvidence } from "@/lib/research/evidence";
import { checkPlanDraft } from "@/lib/plan/draft";
import { updatesToDrafts } from "@/lib/research/updates";
import { applyEntityChange, createProposalBatch, getProposal, acceptProposal } from "@/lib/proposals/apply";
import { storeDraftNote, acceptNote, researchSelection } from "@/lib/research/notes";
import { toProposalViews } from "@/lib/proposals/view";
import { USER } from "./helpers";
const finding = (text: string) => ({
  text,
  quote: text,
  url: "https://example.com/a",
  date: null,
  confidence: "high" as const,
  topic: "leadership" as const,
});
function fixture() {
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
    aiRunId: "synthetic",
    note: {
      title: "Research",
      summary: "",
      open_questions: [],
      findings: [finding("Dana Rivera is the chief information officer.")],
    },
    prose: "Original",
    focus: null,
    depth: "standard",
    searches: 0,
    fetches: 0,
    dropped: [],
  });
  acceptNote(doc.id, [0], USER);
  return { accountId, doc };
}
it("binds current person-title association rather than independent substrings", () => {
  expect(explicitCurrentRole("Dana Rivera is the chief information officer.", "Dana Rivera", "chief information officer")).toBe(true);
  expect(explicitCurrentRole("Chief Information Officer Dana Rivera leads technology.", "Dana Rivera", "Chief Information Officer")).toBe(true);
  expect(
    explicitCurrentRole(
      "Dana Rivera formerly served as chief information officer; Morgan Lee is the current chief information officer.",
      "Dana Rivera",
      "chief information officer",
    ),
  ).toBe(false);
  expect(explicitCurrentRole("Dana Rivera is Chief Investment Information Officer; Morgan Lee is Chief Information Officer.", "Dana Rivera", "Chief Information Officer")).toBe(
    false,
  );
});
it.each([
  "Deputy Chief Information Officer Dana Rivera leads infrastructure.",
  "It is not true that Dana Rivera is chief information officer.",
  "Dana Rivera is not chief information officer.",
  "Dana Rivera is chief information officer designate.",
  "Assistant Chief Information Officer Dana Rivera leads infrastructure.",
  "Dana Rivera may become chief information officer.",
  "Deputy\nChief Information Officer Dana Rivera leads infrastructure.",
  "It is not true that\nDana Rivera is chief information officer.",
  "Dana Rivera is chief information officer?",
  "Dana Rivera is chief information officer; this claim is wrong.",
])("keeps unsupported title extraction as discovery: %s", (text) => {
  const { accountId } = fixture();
  const e = researchSelection(accountId).included[0]!;
  e.finding = { ...finding(text), evidence: { kind: "source_excerpt", text } };
  expect(explicitCurrentRole(text, "Dana Rivera", "chief information officer")).toBe(false);
  const drafts = updatesToDrafts(accountId, { updates: [{ type: "contact", name: "Dana Rivera", title: "chief information officer", evidence_id: e.id }] }, [e]);
  expect(drafts[0]?.entity_type).toBe("action_item");
});
it("preserves an explicit deputy title without promoting it", () => {
  expect(explicitCurrentRole("Deputy Chief Information Officer Dana Rivera leads infrastructure.", "Dana Rivera", "Deputy Chief Information Officer")).toBe(true);
});
it("routes ambiguous historical contact extraction to an internal follow-up", () => {
  const { accountId } = fixture(),
    e = researchSelection(accountId).included[0]!;
  e.finding = finding("Dana Rivera formerly served as chief information officer; Morgan Lee is the current chief information officer.");
  const drafts = updatesToDrafts(
    accountId,
    {
      updates: [
        {
          type: "contact",
          name: "Dana Rivera",
          title: "chief information officer",
          evidence_id: e.id,
        },
      ],
    },
    [e],
  );
  expect(drafts[0]?.entity_type).toBe("action_item");
});
it("displays and carries actual source excerpt separately from generated report wording", () => {
  const { accountId } = fixture(),
    e = researchSelection(accountId).included[0]!;
  e.finding = {
    ...e.finding,
    quote: "The model described a leadership role.",
    evidence: {
      kind: "source_excerpt",
      text: "Dana Rivera is the chief information officer.",
      location: "paragraph 2",
    },
  };
  const html = renderToStaticMarkup(createElement(FindingRow, { finding: e.finding }));
  expect(html).toContain("Dana Rivera is the chief information officer.");
  expect(html).toContain("Research report wording (AI-generated)");
  const drafts = updatesToDrafts(
    accountId,
    {
      updates: [
        {
          type: "contact",
          name: "Dana Rivera",
          title: "chief information officer",
          evidence_id: e.id,
        },
      ],
    },
    [e],
  );
  expect(drafts[0]?.source_ref?.quote).toBe(e.finding.evidence!.text);
});
it("deduplicates repeated cross-note findings without collapsing contradictory claims", () => {
  const meta = {
    title: "n",
    summary: "",
    findings: [finding("Dana is the CIO")],
    open_questions: [],
    focus: null,
    depth: "standard" as const,
    generated_at: "2026-09-16",
    searches: 0,
    fetches: 0,
    dropped: [],
    sources: [],
  };
  const notes = Array.from({ length: 24 }, (_, i) => ({
    doc: { id: `n${i}` },
    meta,
  }));
  notes.push({
    doc: { id: "new" },
    meta: { ...meta, findings: [finding("Morgan is the CIO")] },
  });
  const selected = selectEvidence(notes, "people");
  expect(selected.included).toHaveLength(2);
  expect(selected.total).toBe(25);
  expect(selected.omitted).toBe(23);
});
it("rejects a model citation kind that does not match the actual record type", () => {
  const draft = {
    thesis: "Hypothesis",
    plays: [
      {
        title: "Discovery",
        thesis: "Validate",
        next_step: null,
        owner_suggestion: null,
        linked_deal_ids: [],
        linked_contact_ids: [],
        source_refs: [{ kind: "account" as const, id: "n#0" }],
      },
    ],
  };
  expect(checkPlanDraft(draft, new Map([["n#0", { kind: "research", label: "Evidence" }]]))).toEqual([expect.objectContaining({ path: "plays[0].source_refs[0].kind" })]);
});
it("exposes acknowledgement for plan research refs without verification metadata", () => {
  const { accountId, doc } = fixture();
  const b = createProposalBatch(accountId, { kind: "plan_draft", id: null, aiRunId: null }, [
    {
      entity_type: "play",
      op: "create",
      payload: { title: "Discovery", status: "proposed" },
      source_ref: {
        kind: "research",
        id: `${doc.id}#0`,
        origin: "ai_generated",
        refs: [{ kind: "research", id: `${doc.id}#0` }],
      },
    },
  ]);
  const view = toProposalViews(accountId, [getProposal(b.ids[0]!)!])[0]!;
  expect(view.source_ref?.verification).toBe("report_excerpt");
  expect(() => acceptProposal(b.ids[0]!, USER)).toThrow(/Acknowledge/);
  expect(acceptProposal(b.ids[0]!, USER, { ackEvidence: true }).status).toBe("accepted");
});
it("does not re-propose a paraphrased follow-up for the same retained finding", () => {
  const { accountId, doc } = fixture();
  const origin = {
    kind: "plan_draft" as const,
    id: "research_updates",
    aiRunId: null,
  };
  const source_ref = {
    kind: "research" as const,
    id: doc.id,
    finding_index: 0,
  };
  createProposalBatch(accountId, origin, [
    {
      entity_type: "action_item",
      op: "create",
      payload: { text: "Validate role" },
      source_ref,
    },
  ]);
  expect(
    createProposalBatch(accountId, origin, [
      {
        entity_type: "action_item",
        op: "create",
        payload: { text: "Confirm responsibilities" },
        source_ref,
      },
    ]).ids,
  ).toHaveLength(0);
});
