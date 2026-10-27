import { describe, expect, it } from "vitest";
import { diffExtraction, type AccountState } from "@/lib/import/diffExtraction";
import type { AgentReportExtraction } from "@/lib/import/extractSchema";
import type { AccountRow, DealRow } from "@/lib/db";

const account: AccountRow = {
  id: "acct-1",
  name: "Synthetic Orchard Lab",
  crm_id: null,
  legal_entity: null,
  region: "Central",
  segment: null,
  hq: null,
  thesis: null,
  created_at: 0,
  updated_at: 0,
};

const extraction: AgentReportExtraction = {
  account: { name: "Synthetic Orchard Lab", crm_id: "SYN-ACCOUNT-001", legal_entity: "SYNTHETIC ORCHARD ENTITY", region: "Central", segment: null, hq: null, summary: null },
  team: [
    { name: "Avery Example", email: "avery.example@example.com", role: "specialist_ae", title: null },
    { name: "Casey Example", email: null, role: "ae", title: null },
  ],
  deals: [
    { deal_id: "SYN-DEAL-001", name: "SyntheticOrchard_EHR-Refresh", stage: 3, stage_label: "Tech Validation", close_date: "2026-12-01", fiscal_quarter: "FY27 Q2", tcv_usd: 1000, competitor: "Synthetic Rival A", partner: "Synthetic Partner A", owner: null, architecture: "EHR refresh" },
    { deal_id: "SYN-DEAL-002", name: "SyntheticOrchard North DC Expansion", stage: 2, stage_label: "Propose", close_date: "2026-11-20", fiscal_quarter: "FY27 Q2", tcv_usd: 900, competitor: null, partner: null, owner: "Casey Example", architecture: null },
  ],
  install_base: [
    { product_family: "Compute", value_usd: 100, share_pct: 9.9, role_note: "Blades" },
    { product_family: "Security", value_usd: 100, share_pct: 18.9, role_note: null },
  ],
  plays: [{ title: "EHR Architecture Defense vs. SyntheticRival", thesis: "Win the EHR refresh", deal_ids: ["SYN-DEAL-001"], stakeholders: ["Avery Example"], next_step: null }],
  kpis: [],
};

const source = { documentId: "doc-1", asOf: "2026-09-11" };

function fresh(): AccountState {
  return { account, deals: [], contacts: [], plays: [], installBaseAtAsOf: [] };
}

/** The install-base rows the report's own figures would have left behind,
 *  filed under the date being imported — i.e. what "the applied state" means
 *  for this block now that a second report for that date is a real diff. */
function appliedInstallBase(): AccountState["installBaseAtAsOf"] {
  return extraction.install_base.map((r, i) => ({
    id: `ib${i}`,
    account_id: "acct-1",
    product_family: r.product_family,
    value_usd: r.value_usd,
    share_pct: r.share_pct,
    role_note: r.role_note,
    as_of: source.asOf,
    document_id: null,
    created_at: 0,
    updated_at: 0,
  }));
}

describe("diffExtraction", () => {
  it("fresh account: everything becomes a create, plus account metadata", () => {
    const drafts = diffExtraction(extraction, fresh(), source);
    const kinds = drafts.map((d) => `${d.entity_type}:${d.op}`);
    expect(kinds).toEqual([
      "account:update",
      "contact:create",
      "contact:create",
      "deal:create",
      "deal:create",
      "install_base:create",
      "install_base:create",
      "play:create",
    ]);
    const acct = drafts[0]!;
    expect(acct.payload).toEqual({ crm_id: "SYN-ACCOUNT-001", legal_entity: "SYNTHETIC ORCHARD ENTITY" });
    const deal = drafts.find((d) => d.entity_type === "deal")!;
    expect(deal.payload).toMatchObject({ deal_id: "SYN-DEAL-001", stage: 3, tcv_usd: 1000, fiscal_quarter: "FY27 Q2" });
    expect(deal.payload).not.toHaveProperty("owner");
    expect(deal.source_ref).toEqual({ kind: "document", id: "doc-1", quote: "SYN-DEAL-001" });
    const play = drafts.find((d) => d.entity_type === "play")!;
    expect(play.payload).toMatchObject({ status: "proposed", deal_ids: ["SYN-DEAL-001"] });
    const contact = drafts.find((d) => d.entity_type === "contact")!;
    expect(contact.payload).toMatchObject({ org: "vendor", role: "specialist_ae" });
  });

  it("same extraction again against the applied state proposes nothing", () => {
    const state: AccountState = {
      account: { ...account, crm_id: "SYN-ACCOUNT-001", legal_entity: "SYNTHETIC ORCHARD ENTITY" },
      deals: extraction.deals.map(
        (d): DealRow => ({ ...d, account_id: "acct-1", next_step: null, notes: null, status: "open", created_at: 0, updated_at: 0 }),
      ),
      contacts: extraction.team.map((m, i) => ({ id: `c${i}`, account_id: "acct-1", name: m.name, title: null, org: "vendor" as const, role: m.role, email: m.email, notes: null, created_at: 0, updated_at: 0 })),
      plays: [{ id: "p1", account_id: "acct-1", title: "ehr architecture defense vs. syntheticrival", thesis: null, status: "active", owner: null, next_step: null, next_step_due: null, deal_ids_json: "[]", contact_ids_json: "[]", sort_order: 0, created_at: 0, updated_at: 0 }],
      installBaseAtAsOf: appliedInstallBase(),
    };
    expect(diffExtraction(extraction, state, source)).toEqual([]);
  });

  it("a changed stage yields one update with only the changed field", () => {
    const state = fresh();
    state.deals = [
      { ...extraction.deals[0]!, stage: 2, stage_label: "Propose", account_id: "acct-1", next_step: "call", notes: null, status: "open", created_at: 0, updated_at: 0 },
    ];
    state.contacts = extraction.team.map((m, i) => ({ id: `c${i}`, account_id: "acct-1", name: m.name, title: null, org: "vendor" as const, role: m.role, email: m.email, notes: null, created_at: 0, updated_at: 0 }));
    // The report's two install-base families, already filed under this date.
    // This used to be `state.latestInstallBaseAsOf = "2026-09-11"` and the
    // whole block was skipped on the strength of it — which is what made a
    // corrected report silently do nothing. Now it is an ordinary diff, and
    // with identical figures it still proposes nothing, for the right reason.
    state.installBaseAtAsOf = appliedInstallBase();
    state.plays = [{ id: "p1", account_id: "acct-1", title: "EHR Architecture Defense vs. SyntheticRival", thesis: null, status: "active", owner: null, next_step: null, next_step_due: null, deal_ids_json: "[]", contact_ids_json: "[]", sort_order: 0, created_at: 0, updated_at: 0 }];
    state.account = { ...account, crm_id: "SYN-ACCOUNT-001", legal_entity: "SYNTHETIC ORCHARD ENTITY" };
    const drafts = diffExtraction(extraction, state, source);
    const dealDrafts = drafts.filter((d) => d.entity_type === "deal");
    expect(dealDrafts).toHaveLength(2);
    expect(dealDrafts[0]).toMatchObject({ op: "update", entity_id: "SYN-DEAL-001", payload: { stage: 3, stage_label: "Tech Validation" } });
    expect(dealDrafts[1]).toMatchObject({ op: "create", payload: { deal_id: "SYN-DEAL-002" } });
  });

  it("a deal filed under another account is flagged, not moved", () => {
    const state = fresh();
    state.deals = [{ ...extraction.deals[0]!, account_id: "other", next_step: null, notes: null, status: "open", created_at: 0, updated_at: 0 }];
    const drafts = diffExtraction(extraction, state, source).filter((d) => d.entity_type === "deal" && d.entity_id === "SYN-DEAL-001");
    expect(drafts[0]!.payload).toHaveProperty("notes");
    expect(drafts[0]!.payload).not.toHaveProperty("stage");
  });

  it("known contacts get missing details filled but are not duplicated", () => {
    const state = fresh();
    state.contacts = [{ id: "c1", account_id: "acct-1", name: "avery example", title: null, org: "vendor", role: null, email: null, notes: null, created_at: 0, updated_at: 0 }];
    const contacts = diffExtraction(extraction, state, source).filter((d) => d.entity_type === "contact");
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({ op: "update", entity_id: "c1", payload: { email: "avery.example@example.com", role: "specialist_ae" } });
    expect(contacts[1]).toMatchObject({ op: "create", payload: { name: "Casey Example" } });
  });
});

describe("a deal that was merged away", () => {
  function dealRow(over: Partial<DealRow> & { deal_id: string; name: string }): DealRow {
    return {
      account_id: "acct-1",
      stage: null,
      stage_label: null,
      close_date: null,
      fiscal_quarter: null,
      tcv_usd: null,
      competitor: null,
      partner: null,
      architecture: null,
      owner: null,
      next_step: null,
      notes: null,
      status: "open",
      archived_at: null,
      merged_into: null,
      created_at: 0,
      updated_at: 0,
      ...over,
    };
  }

  // The keeper carries the CRM id the report uses; the tombstone is the local
  // row it absorbed.
  function afterMerge(): AccountState {
    return {
      account,
      deals: [
        dealRow({ deal_id: "SYN-DEAL-001", name: "SyntheticOrchard_EHR-Refresh", stage: 3, stage_label: "Tech Validation", close_date: "2026-12-01", fiscal_quarter: "FY27 Q2", tcv_usd: 1000, competitor: "Synthetic Rival A", partner: "Synthetic Partner A", architecture: "EHR refresh" }),
        dealRow({ deal_id: "local-3f9c1a20", name: "EHR Refresh", archived_at: "2026-09-12", merged_into: "SYN-DEAL-001" }),
      ],
      contacts: [],
      plays: [],
      installBaseAtAsOf: [],
    };
  }

  it("never proposes bringing the tombstone back", () => {
    // This is the one that mattered: the import reads archived rows on
    // purpose, so without following merged_into the next report would find
    // the local id and propose clearing archived_at. One Accept all and the
    // duplicate returns — every import, forever.
    const drafts = diffExtraction(extraction, afterMerge(), source);
    expect(drafts.some((d) => d.entity_id === "local-3f9c1a20")).toBe(false);
    expect(drafts.some((d) => d.payload.archived_at === null)).toBe(false);
  });

  it("points a report that still uses the old id at the surviving deal", () => {
    const state = afterMerge();
    const x = { ...extraction, deals: [{ ...extraction.deals[0]!, deal_id: "local-3f9c1a20", stage: 4, stage_label: "Biz Validation" }] };
    const drafts = diffExtraction(x, state, source).filter((d) => d.entity_type === "deal");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.op).toBe("update");
    expect(drafts[0]!.entity_id).toBe("SYN-DEAL-001");
    expect(drafts[0]!.payload).toMatchObject({ stage: 4 });
  });

  it("links a play to the survivor rather than the tombstone", () => {
    const state = afterMerge();
    const x = { ...extraction, plays: [{ ...extraction.plays[0]!, title: "Brand new play", deal_ids: ["local-3f9c1a20"] }] };
    const play = diffExtraction(x, state, source).find((d) => d.entity_type === "play" && d.op === "create");
    expect(play!.payload.deal_ids).toEqual(["SYN-DEAL-001"]);
  });
});

describe("the duplicate the report is about to create", () => {
  function localOnly(name: string): AccountState {
    return {
      account,
      deals: [
        {
          account_id: "acct-1", deal_id: "local-3f9c1a20", name, stage: null, stage_label: null, close_date: null,
          fiscal_quarter: null, tcv_usd: null, competitor: null, partner: null, architecture: null, owner: null,
          next_step: null, notes: null, status: "open", archived_at: null, merged_into: null, created_at: 0, updated_at: 0,
        },
      ],
      contacts: [],
      plays: [],
      installBaseAtAsOf: [],
    };
  }

  it("says so on the card when exactly one local deal has the same name", () => {
    const drafts = diffExtraction(extraction, localOnly("SyntheticOrchard EHR Refresh"), source);
    const create = drafts.find((d) => d.entity_type === "deal" && d.op === "create" && d.payload.deal_id === "SYN-DEAL-001")!;
    expect(create.rationale).toMatch(/looks like the CRM id/);
    expect(create.rationale).toMatch(/merge them after accepting/);
    // The payload is untouched — this is advice, not a new mechanism.
    expect(create.payload).toMatchObject({ deal_id: "SYN-DEAL-001", stage: 3 });
  });

  it("stays silent when the name does not match", () => {
    const drafts = diffExtraction(extraction, localOnly("Something else entirely"), source);
    const create = drafts.find((d) => d.entity_type === "deal" && d.op === "create")!;
    expect(create.rationale).toBe("New opportunity row in the report");
  });

  it("stays silent when the lookalike already has a CRM id", () => {
    const state = localOnly("SyntheticOrchard EHR Refresh");
    state.deals[0]!.deal_id = "SYN-EXTRA-008";
    const drafts = diffExtraction(extraction, state, source);
    const create = drafts.find((d) => d.entity_type === "deal" && d.op === "create")!;
    expect(create.rationale).toBe("New opportunity row in the report");
  });

  it("stays silent when two local deals could both be it", () => {
    const state = localOnly("SyntheticOrchard EHR Refresh");
    state.deals.push({ ...state.deals[0]!, deal_id: "local-aabbccdd" });
    const drafts = diffExtraction(extraction, state, source);
    const create = drafts.find((d) => d.entity_type === "deal" && d.op === "create")!;
    // Ambiguity is worse than silence: "merge them" is unactionable if you do
    // not know which.
    expect(create.rationale).toBe("New opportunity row in the report");
  });
});
