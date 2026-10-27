// The install base over time.
//
// Snapshots have been stored per as_of since Phase 1, under a UNIQUE
// (account_id, product_family, as_of) constraint whose entire purpose is a
// history — and the only reader took MAX(as_of) and stopped. "Our share of
// their compute went from 34% to 28% since March" could not be said by an app
// that had every number needed to say it.
import { beforeEach, describe, expect, it } from "vitest";
import { acceptProposal, applyEntityChange, archiveEntity, createProposalBatch, restoreEntity } from "@/lib/proposals/apply";
import { diffExtraction } from "@/lib/import/diffExtraction";
import { entityHistory, getAccount, installBaseAt, latestInstallBase } from "@/lib/queries/accounts";
import { buildHandoff } from "@/lib/handoff/build";
import { buildContextPack } from "@/lib/meetings/contextPack";
import type { AgentReportExtraction } from "@/lib/import/extractSchema";
import { installBaseTrend } from "@/lib/queries/accounts";
import { seedAccount, USER, type Seed } from "./helpers";

let seed: Seed;

beforeEach(() => {
  seed = seedAccount();
});

function snapshot(asOf: string, rows: Array<{ family: string; value: number; share?: number }>) {
  for (const r of rows) {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      op: "create",
      payload: { product_family: r.family, value_usd: r.value, share_pct: r.share ?? null, as_of: asOf },
      actorUserId: USER,
    });
  }
}

function byFamily(trend: ReturnType<typeof installBaseTrend>) {
  return Object.fromEntries(trend.rows.map((r) => [r.product_family, r]));
}

describe("what moved since the last report", () => {
  it("says nothing moved when there is only one snapshot", () => {
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000, share: 34 }]);
    const t = installBaseTrend(seed.accountId);
    expect(t.asOf).toBe("2026-03-31");
    expect(t.previousAsOf).toBeNull();
    expect(byFamily(t).Compute?.previous_value_usd).toBeNull();
  });

  it("compares the latest against the one before it, not against the oldest", () => {
    snapshot("2026-01-31", [{ family: "Compute", value: 1_000_000, share: 12 }]);
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000, share: 34 }]);
    snapshot("2026-06-30", [{ family: "Compute", value: 3_400_000, share: 28 }]);
    const t = installBaseTrend(seed.accountId);
    expect(t.asOf).toBe("2026-06-30");
    expect(t.previousAsOf).toBe("2026-03-31");
    const compute = byFamily(t).Compute!;
    expect(compute.value_usd).toBe(3_400_000);
    expect(compute.previous_value_usd).toBe(4_100_000);
    expect(compute.previous_share_pct).toBe(34);
  });

  it("marks a family the new report does not mention rather than dropping it", () => {
    // A product family disappearing from a report is the change most worth
    // seeing, and an inner join would have hidden exactly that one.
    snapshot("2026-03-31", [
      { family: "Compute", value: 4_100_000 },
      { family: "Storage", value: 900_000 },
    ]);
    snapshot("2026-06-30", [{ family: "Compute", value: 4_300_000 }]);
    const t = installBaseTrend(seed.accountId);
    const storage = byFamily(t).Storage!;
    expect(storage.gone).toBe(true);
    expect(storage.previous_value_usd).toBe(900_000);
    expect(byFamily(t).Compute!.gone).toBe(false);
  });

  it("calls a family that was not there before new, not a fall to zero", () => {
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000 }]);
    snapshot("2026-06-30", [
      { family: "Compute", value: 4_100_000 },
      { family: "Networking", value: 2_000_000 },
    ]);
    const t = installBaseTrend(seed.accountId);
    expect(byFamily(t).Networking!.previous_value_usd).toBeNull();
    expect(byFamily(t).Networking!.gone).toBe(false);
  });

  it("is empty for an account that has never had a report", () => {
    expect(installBaseTrend(seed.accountId)).toEqual({ asOf: null, previousAsOf: null, rows: [] });
  });
});

// Re-importing a report for a date that already has a snapshot.
//
// The guard was `state.latestInstallBaseAsOf !== source.asOf`, and
// latestInstallBaseAsOf is MAX(as_of) — so it asked "is this the newest
// snapshot's date", not "does a snapshot exist for this date". Two things
// followed, and the date field Phase 8 added is what makes both reachable:
// re-importing the newest date was silently skipped, and re-importing an
// *older* one passed the guard and died on the UNIQUE constraint at accept
// time, as a raw SQLite error rather than anything a person could read.
describe("a report for a date that already has a snapshot", () => {
  const extraction = (rows: Array<{ family: string; value: number }>) =>
    ({
      account: { name: "Synthetic Orchard Lab", crm_id: null, legal_entity: null, region: null, segment: null, hq: null, summary: null },
      team: [],
      deals: [],
      install_base: rows.map((r) => ({ product_family: r.family, value_usd: r.value, share_pct: null, role_note: null })),
      plays: [],
      kpis: [],
    }) as AgentReportExtraction;

  const state = (asOf: string) => ({
    account: { id: seed.accountId, name: "Synthetic Orchard Lab" } as never,
    deals: [],
    contacts: [],
    plays: [],
    installBaseAtAsOf: installBaseAt(seed.accountId, asOf),
  });

  it("proposes an update for a figure that changed, rather than a create that cannot be applied", () => {
    // Q1, then Q2, then the corrected Q1 — which is exactly what the report
    // date field exists to let you do.
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000 }]);
    snapshot("2026-06-30", [{ family: "Compute", value: 3_900_000 }]);

    const drafts = diffExtraction(extraction([{ family: "Compute", value: 4_250_000 }]), state("2026-03-31"), {
      documentId: "doc-1",
      asOf: "2026-03-31",
    });
    const ib = drafts.filter((d) => d.entity_type === "install_base");
    expect(ib).toHaveLength(1);
    expect(ib[0]!.op).toBe("update");
    expect(ib[0]!.payload).toEqual({ value_usd: 4_250_000 });

    // And it applies. Before this, the draft was a create and the accept threw
    // SQLITE_CONSTRAINT out of the raw insert — the pre-insert duplicate check
    // looks up the primary key, which is a fresh uuid, so it never caught it.
    const batch = createProposalBatch(seed.accountId, { kind: "import", id: "doc-1", aiRunId: null }, drafts);
    for (const id of batch.ids) expect(acceptProposal(id, USER).status).toBe("accepted");
    expect(installBaseTrend(seed.accountId).rows.find((r) => r.product_family === "Compute")?.previous_value_usd).toBe(4_250_000);
  });

  it("proposes nothing when the report says what is already filed", () => {
    // The quiet outcome has to survive — but for the right reason now. It used
    // to be quiet because the whole block was skipped whatever it said.
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000 }]);
    const drafts = diffExtraction(extraction([{ family: "Compute", value: 4_100_000 }]), state("2026-03-31"), {
      documentId: "doc-1",
      asOf: "2026-03-31",
    });
    expect(drafts.filter((d) => d.entity_type === "install_base")).toEqual([]);
  });

  it("creates a family the snapshot does not have yet", () => {
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000 }]);
    const drafts = diffExtraction(
      extraction([
        { family: "Compute", value: 4_100_000 },
        { family: "Storage", value: 900_000 },
      ]),
      state("2026-03-31"),
      { documentId: "doc-1", asOf: "2026-03-31" },
    );
    const ib = drafts.filter((d) => d.entity_type === "install_base");
    expect(ib).toHaveLength(1);
    expect(ib[0]!.op).toBe("create");
    expect(ib[0]!.payload).toMatchObject({ product_family: "Storage", as_of: "2026-03-31" });
  });

  it("leaves a family the report does not mention alone", () => {
    // A report can be partial, and absence is not evidence — the same rule
    // every other importer here applies to a blank field. The trend's own
    // "not in this report" marker is for a *newer* snapshot omitting it, not
    // for a second read of the same one.
    snapshot("2026-03-31", [
      { family: "Compute", value: 4_100_000 },
      { family: "Storage", value: 900_000 },
    ]);
    const drafts = diffExtraction(extraction([{ family: "Compute", value: 4_250_000 }]), state("2026-03-31"), {
      documentId: "doc-1",
      asOf: "2026-03-31",
    });
    const ib = drafts.filter((d) => d.entity_type === "install_base");
    expect(ib).toHaveLength(1);
    expect(ib[0]!.payload).toEqual({ value_usd: 4_250_000 });
  });

  it("files a genuinely new date as a new snapshot", () => {
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000 }]);
    const drafts = diffExtraction(extraction([{ family: "Compute", value: 3_900_000 }]), state("2026-06-30"), {
      documentId: "doc-1",
      asOf: "2026-06-30",
    });
    const ib = drafts.filter((d) => d.entity_type === "install_base");
    expect(ib).toHaveLength(1);
    expect(ib[0]!.op).toBe("create");
    expect(ib[0]!.payload).toMatchObject({ as_of: "2026-06-30" });
  });
});

// Archiving a row, and the filter every read has to take a position on.
//
// The Phase 2.5 lesson, applied to a new column: a missed filter is a silent
// bug across every surface at once, so this asserts the whole object rather
// than one query at a time.
describe("a snapshot you can correct", () => {
  function visibility() {
    const trend = installBaseTrend(seed.accountId);
    const latest = latestInstallBase(seed.accountId);
    const account = getAccount(seed.accountId)!;
    return {
      latestAsOf: latest.asOf,
      inLatest: latest.rows.map((r) => r.product_family).sort(),
      inTrend: trend.rows.map((r) => r.product_family).sort(),
      inHandoff: buildHandoff({ account, by: "Alex", asks: "Keep the cadence.", note: null }).install_base.rows.map((r) => r.product_family).sort(),
      inPack: buildContextPack(seed.accountId).install_base.map((r) => r.product_family).sort(),
    };
  }

  it("leaves every surface at once, and comes back to every surface at once", () => {
    snapshot("2026-06-30", [
      { family: "Compute", value: 4_100_000 },
      { family: "Storage", value: 900_000 },
    ]);
    const storage = latestInstallBase(seed.accountId).rows.find((r) => r.product_family === "Storage")!;

    expect(visibility()).toEqual({
      latestAsOf: "2026-06-30",
      inLatest: ["Compute", "Storage"],
      inTrend: ["Compute", "Storage"],
      inHandoff: ["Compute", "Storage"],
      inPack: ["Compute", "Storage"],
    });

    archiveEntity({ accountId: seed.accountId, entityType: "install_base", entityId: storage.id, actorUserId: USER });
    expect(visibility()).toEqual({
      latestAsOf: "2026-06-30",
      inLatest: ["Compute"],
      inTrend: ["Compute"],
      inHandoff: ["Compute"],
      inPack: ["Compute"],
    });

    restoreEntity({ accountId: seed.accountId, entityType: "install_base", entityId: storage.id, actorUserId: USER });
    expect(visibility().inLatest).toEqual(["Compute", "Storage"]);
  });

  it("falls back to the snapshot before when the newest one is entirely archived", () => {
    // MAX(as_of) has to be MAX over the rows that still count. Without the
    // filter the date survives its own rows and the page reads "as of June"
    // above nothing at all.
    snapshot("2026-03-31", [{ family: "Compute", value: 4_100_000 }]);
    snapshot("2026-06-30", [{ family: "Compute", value: 3_900_000 }]);
    for (const r of latestInstallBase(seed.accountId).rows) {
      archiveEntity({ accountId: seed.accountId, entityType: "install_base", entityId: r.id, actorUserId: USER });
    }
    const after = latestInstallBase(seed.accountId);
    expect(after.asOf).toBe("2026-03-31");
    expect(after.rows.map((r) => r.value_usd)).toEqual([4_100_000]);
  });

  it("writes one history line per change, like every other record", () => {
    snapshot("2026-06-30", [{ family: "Compute", value: 4_100_000 }]);
    const row = latestInstallBase(seed.accountId).rows[0]!;
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "install_base",
      entityId: row.id,
      op: "update",
      payload: { value_usd: 4_250_000 },
      actorUserId: USER,
    });
    const history = entityHistory("install_base", row.id, 50);
    expect(history.some((h) => h.field === "value_usd" && h.old_value === "4100000" && h.new_value === "4250000")).toBe(true);
  });

  it("still refuses to let a proposal archive one", () => {
    // Widening ARCHIVABLE must not widen what the model may do. A draft may
    // clear archived_at (a restore) and never set one.
    snapshot("2026-06-30", [{ family: "Compute", value: 4_100_000 }]);
    const row = latestInstallBase(seed.accountId).rows[0]!;
    expect(() =>
      createProposalBatch(seed.accountId, { kind: "import", id: "doc-1", aiRunId: null }, [
        { entity_type: "install_base", op: "update", entity_id: row.id, payload: { archived_at: "2026-07-01" }, rationale: "x", source_ref: null },
      ]),
    ).toThrow();
  });
});
