import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDbForTests, type ChangeLogRow, type DealRow, type PlayRow } from "@/lib/db";
import { acceptProposal, applyEntityChange, ApplyError, createProposalBatch, rejectProposal } from "@/lib/proposals/apply";

const USER = "user-1";

function makeAccount(): string {
  return applyEntityChange({
    accountId: "",
    entityType: "account",
    op: "create",
    payload: { name: "Synthetic Orchard Lab", region: "Central" },
    actorUserId: USER,
  }).entityId;
}

function logsFor(entityType: string, entityId: string): ChangeLogRow[] {
  return db()
    .prepare(`SELECT * FROM change_log WHERE entity_type = ? AND entity_id = ? ORDER BY rowid`)
    .all(entityType, entityId) as ChangeLogRow[];
}

describe("applyEntityChange", () => {
  beforeEach(() => resetDbForTests());

  it("creates a deal, derives the fiscal quarter, and logs each field", () => {
    const accountId = makeAccount();
    const r = applyEntityChange({
      accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: "SYN-DEAL-001", name: "EHR Refresh", stage: 3, close_date: "2026-12-01", tcv_usd: 1000 },
      actorUserId: USER,
    });
    expect(r.entityId).toBe("SYN-DEAL-001");
    const row = db().prepare(`SELECT * FROM deals WHERE deal_id = ?`).get("SYN-DEAL-001") as DealRow;
    expect(row.fiscal_quarter).toBe("FY27 Q2");
    expect(row.status).toBe("open");
    const fields = logsFor("deal", "SYN-DEAL-001").map((l) => l.field).sort();
    expect(fields).toEqual(["close_date", "fiscal_quarter", "name", "stage", "tcv_usd"]);
  });

  it("updates only the fields that differ and logs old and new", () => {
    const accountId = makeAccount();
    applyEntityChange({ accountId, entityType: "deal", op: "create", payload: { deal_id: "1", name: "A", stage: 2 }, actorUserId: USER });
    const r = applyEntityChange({
      accountId,
      entityType: "deal",
      op: "update",
      entityId: "1",
      payload: { stage: 3, name: "A" },
      actorUserId: USER,
    });
    expect(r.changedFields).toEqual(["stage"]);
    const log = logsFor("deal", "1").filter((l) => l.field === "stage");
    expect(log.map((l) => [l.old_value, l.new_value])).toEqual([
      [null, "2"],
      ["2", "3"],
    ]);
  });

  it("rejects fields outside the schema and unknown linked ids", () => {
    const accountId = makeAccount();
    expect(() =>
      applyEntityChange({ accountId, entityType: "deal", op: "create", payload: { deal_id: "1", name: "A", account_id: "x" }, actorUserId: USER }),
    ).toThrow(ApplyError);
    expect(() =>
      applyEntityChange({ accountId, entityType: "play", op: "create", payload: { title: "P", deal_ids: ["nope"] }, actorUserId: USER }),
    ).toThrow(/unknown deal/);
  });

  it("stores play link arrays as JSON and round-trips them", () => {
    const accountId = makeAccount();
    applyEntityChange({ accountId, entityType: "deal", op: "create", payload: { deal_id: "9", name: "D" }, actorUserId: USER });
    const play = applyEntityChange({ accountId, entityType: "play", op: "create", payload: { title: "P", deal_ids: ["9"] }, actorUserId: USER });
    const row = db().prepare(`SELECT * FROM plays WHERE id = ?`).get(play.entityId) as PlayRow;
    expect(JSON.parse(row.deal_ids_json)).toEqual(["9"]);
    const again = applyEntityChange({ accountId, entityType: "play", op: "update", entityId: play.entityId, payload: { deal_ids: ["9"] }, actorUserId: USER });
    expect(again.changedFields).toEqual([]);
  });
});

describe("proposals", () => {
  beforeEach(() => resetDbForTests());

  it("fresh account: creates become rows on accept; the same batch again proposes nothing", () => {
    const accountId = makeAccount();
    const drafts = [
      { entity_type: "deal" as const, op: "create" as const, payload: { deal_id: "1", name: "A", stage: 2 }, source_ref: { kind: "document" as const, id: "doc1", quote: "A" } },
      { entity_type: "contact" as const, op: "create" as const, payload: { name: "Priya", org: "vendor", role: "specialist_ae" } },
    ];
    const batch = createProposalBatch(accountId, { kind: "import", id: "doc1", aiRunId: null }, drafts);
    expect(batch.ids).toHaveLength(2);
    for (const id of batch.ids) expect(acceptProposal(id, USER).status).toBe("accepted");
    expect(db().prepare(`SELECT COUNT(*) AS n FROM deals`).get()).toEqual({ n: 1 });
    const log = logsFor("deal", "1");
    expect(log.every((l) => l.proposal_id === batch.ids[0])).toBe(true);
    expect(JSON.parse(log[0]!.source_ref_json!)).toMatchObject({ kind: "document", id: "doc1" });

    // An update proposal whose values already match is dropped at creation.
    const noop = createProposalBatch(accountId, { kind: "import", id: "doc2", aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: "1", payload: { stage: 2, name: "A" } },
    ]);
    expect(noop.ids).toHaveLength(0);
  });

  it("update captures before_json and conflicts when the row changed underneath", () => {
    const accountId = makeAccount();
    applyEntityChange({ accountId, entityType: "deal", op: "create", payload: { deal_id: "1", name: "A", stage: 2 }, actorUserId: USER });
    const batch = createProposalBatch(accountId, { kind: "meeting", id: "m1", aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: "1", payload: { stage: 3 } },
    ]);
    const p = db().prepare(`SELECT before_json FROM proposals WHERE id = ?`).get(batch.ids[0]) as { before_json: string };
    expect(JSON.parse(p.before_json)).toEqual({ stage: 2 });

    // Someone moves the deal to stage 4 manually before the proposal is reviewed.
    applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: "1", payload: { stage: 4 }, actorUserId: USER });
    const result = acceptProposal(batch.ids[0]!, USER);
    expect(result.status).toBe("conflict");
    const row = db().prepare(`SELECT stage FROM deals WHERE deal_id = ?`).get("1") as { stage: number };
    expect(row.stage).toBe(4);
  });

  it("accepting a drifted row is fine when it already matches the proposal", () => {
    const accountId = makeAccount();
    applyEntityChange({ accountId, entityType: "deal", op: "create", payload: { deal_id: "1", name: "A", stage: 2 }, actorUserId: USER });
    const batch = createProposalBatch(accountId, { kind: "meeting", id: "m1", aiRunId: null }, [
      { entity_type: "deal", op: "update", entity_id: "1", payload: { stage: 3 } },
    ]);
    applyEntityChange({ accountId, entityType: "deal", op: "update", entityId: "1", payload: { stage: 3 }, actorUserId: USER });
    expect(acceptProposal(batch.ids[0]!, USER).status).toBe("accepted");
  });

  it("an identical draft is not proposed again after it was rejected", () => {
    const accountId = makeAccount();
    const draft = { entity_type: "contact" as const, op: "create" as const, payload: { name: "Tom", org: "vendor" } };
    const first = createProposalBatch(accountId, { kind: "import", id: "d1", aiRunId: null }, [draft]);
    rejectProposal(first.ids[0]!, USER);
    const second = createProposalBatch(accountId, { kind: "import", id: "d2", aiRunId: null }, [draft]);
    expect(second.ids).toHaveLength(0);
    const changed = createProposalBatch(accountId, { kind: "import", id: "d3", aiRunId: null }, [{ ...draft, payload: { name: "Tom", org: "vendor", role: "ae" } }]);
    expect(changed.ids).toHaveLength(1);
  });

  it("reject touches nothing and a decided proposal cannot be decided again", () => {
    const accountId = makeAccount();
    const batch = createProposalBatch(accountId, { kind: "import", id: null, aiRunId: null }, [
      { entity_type: "deal", op: "create", payload: { deal_id: "1", name: "A" } },
    ]);
    expect(rejectProposal(batch.ids[0]!, USER).status).toBe("rejected");
    expect(db().prepare(`SELECT COUNT(*) AS n FROM deals`).get()).toEqual({ n: 0 });
    expect(db().prepare(`SELECT COUNT(*) AS n FROM change_log WHERE entity_type = 'deal'`).get()).toEqual({ n: 0 });
    expect(() => acceptProposal(batch.ids[0]!, USER)).toThrow(/rejected/);
  });
});

describe("document-sized fields", () => {
  beforeEach(() => resetDbForTests());

  it("history records how big the notes were, not a second copy of them", () => {
    const accountId = makeAccount();
    const meeting = applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Review", held_at: "2026-09-15" },
      actorUserId: USER,
    }).entityId;
    const notes = "x".repeat(5000);
    applyEntityChange({ accountId, entityType: "meeting", op: "update", entityId: meeting, payload: { raw_notes: notes }, actorUserId: USER });

    const stored = db().prepare(`SELECT raw_notes FROM meetings WHERE id = ?`).get(meeting) as { raw_notes: string };
    expect(stored.raw_notes).toBe(notes);
    const log = logsFor("meeting", meeting).filter((l) => l.field === "raw_notes");
    expect(log).toHaveLength(1);
    expect(log[0]!.new_value).toBe("4.9 KB");
    expect(log[0]!.old_value).toBeNull();
  });

  it("a title change beside a notes change still logs its real values", () => {
    const accountId = makeAccount();
    const meeting = applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Review", held_at: "2026-09-15" },
      actorUserId: USER,
    }).entityId;
    applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "update",
      entityId: meeting,
      payload: { title: "Quarterly review", raw_notes: "short note here" },
      actorUserId: USER,
    });
    const log = logsFor("meeting", meeting);
    // The create logged the original title, so take the latest entry.
    expect(log.filter((l) => l.field === "title").at(-1)!.new_value).toBe('"Quarterly review"');
    expect(log.filter((l) => l.field === "raw_notes").at(-1)!.new_value).toBe("15 B");
  });

  it("nothing may propose a document-sized field", () => {
    const accountId = makeAccount();
    const meeting = applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Review", held_at: "2026-09-15" },
      actorUserId: USER,
    }).entityId;
    expect(() =>
      createProposalBatch(accountId, { kind: "meeting", id: meeting, aiRunId: null }, [
        { entity_type: "meeting", op: "update", entity_id: meeting, payload: { brief_json: "{}" } },
      ]),
    ).toThrow(/cannot be proposed/);
  });

  it("attendees round-trip as structured data and an action item keeps its quote", () => {
    const accountId = makeAccount();
    const meeting = applyEntityChange({
      accountId,
      entityType: "meeting",
      op: "create",
      payload: { title: "Review", held_at: "2026-09-15", attendees: [{ contact_id: null, name: "Finley Example", note: null }] },
      actorUserId: USER,
    }).entityId;
    const stored = db().prepare(`SELECT attendees_json FROM meetings WHERE id = ?`).get(meeting) as { attendees_json: string };
    expect(JSON.parse(stored.attendees_json)).toEqual([{ contact_id: null, name: "Finley Example", note: null }]);

    const item = applyEntityChange({
      accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the doc", status: "open", meeting_id: meeting, source_ref: { kind: "meeting", id: meeting, quote: "Dana asked for a doc" } },
      actorUserId: USER,
    }).entityId;
    const row = db().prepare(`SELECT source_ref_json FROM action_items WHERE id = ?`).get(item) as { source_ref_json: string };
    expect(JSON.parse(row.source_ref_json)).toMatchObject({ quote: "Dana asked for a doc" });
  });
});
