// SYNTHETIC ONLY.
//
// The small things that made the account and pipeline pages look broken:
// a stage read "3 · 3 - Technical Validation", one quarter was two pipeline
// groups ("FY27 Q2" and "FY27Q2"), a drafted plan showed raw record ids, and
// its evidence read "deal; play; play; research…".
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
import { stageText } from "@/lib/format";
import { quarterLabel } from "@/lib/fiscal";
import { createProposalBatch, getProposal } from "@/lib/proposals/apply";
import { toProposalViews } from "@/lib/proposals/view";
import { evidenceSummary, ProposalReview } from "@/components/ProposalReview";
import { seedAccount } from "./helpers";

describe("stageText", () => {
  it("does not repeat a stage number the CRM label already carries", () => {
    expect(stageText(3, "3 - Technical Validation")).toBe("3 · Technical Validation");
    expect(stageText(3, "3. Technical Validation")).toBe("3 · Technical Validation");
    expect(stageText(3, "Technical Validation")).toBe("3 · Technical Validation");
  });
  it("keeps a leading number that is not the stage", () => {
    expect(stageText(2, "3 - Technical Validation")).toBe("2 · 3 - Technical Validation");
  });
  it("falls back to the label when there is no stage", () => {
    expect(stageText(null, "Prospecting")).toBe("Prospecting");
    expect(stageText(null, null)).toBe("—");
  });
});

describe("quarterLabel", () => {
  it("gives one spelling per quarter", () => {
    for (const raw of ["FY27Q2", "FY27 Q2", " fy27 q2 ", "FY2027 Q2"]) expect(quarterLabel(raw)).toBe("FY27 Q2");
  });
  it("keeps what it cannot read, trimmed", () => {
    expect(quarterLabel(" Next year ")).toBe("Next year");
    expect(quarterLabel("")).toBeNull();
    expect(quarterLabel(null)).toBeNull();
  });
});

describe("a drafted change, as reviewed", () => {
  it("counts its evidence by kind", () => {
    expect(evidenceSummary([{ kind: "deal" }, { kind: "play" }, { kind: "play" }, { kind: "deal" }, { kind: "deal" }])).toBe("3 deals, 2 plays");
    expect(evidenceSummary([{ kind: "deal" }])).toBe("1 deal");
  });

  it("names linked deals and people instead of showing their ids", () => {
    const seed = seedAccount();
    const b = createProposalBatch(seed.accountId, { kind: "plan_draft", id: "synthetic", aiRunId: null }, [
      { entity_type: "play", op: "update", entity_id: seed.playId, payload: { deal_ids: [seed.dealId], contact_ids: [seed.contactId] } },
    ]);
    const views = toProposalViews(seed.accountId, [getProposal(b.ids[0]!)!]);
    const html = renderToStaticMarkup(createElement(ProposalReview, { accountId: seed.accountId, proposals: views, batchId: b.batchId }));
    expect(html).toContain("Linked deals");
    expect(html).toContain("EHR Refresh");
    expect(html).toContain("Finley Example");
    for (const id of [seed.dealId, seed.contactId]) expect(html).not.toContain(id);
  });
});
