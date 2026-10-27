// A spreadsheet handed to another account team.
//
// Every bug in a CSV writer is invisible until someone opens the file
// somewhere else, which is exactly when it matters: the file exists to be sent
// to a person who cannot ask you what happened.
import { beforeEach, describe, expect, it } from "vitest";
import { CSV_BOM, csvFilename, escapeCell, toCsv } from "@/lib/csv";
import { applyEntityChange } from "@/lib/proposals/apply";
import { accountContactsSheet, accountDealsSheet, followUpsSheet, pipelineSheet, sheetToCsv } from "@/lib/queries/export";
import { seedAccount, USER, type Seed } from "./helpers";

describe("a cell", () => {
  it("passes ordinary text through untouched", () => {
    expect(escapeCell("EHR Refresh")).toBe("EHR Refresh");
    expect(escapeCell(1_000)).toBe("1000");
  });

  it("is empty for null, not an em-dash", () => {
    // fmtMoney and fmtDay both render "—" for null, which is right on a screen
    // and wrong in a column someone is about to sum.
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
  });

  it("quotes anything that would end the field or the row", () => {
    expect(escapeCell("Acme, Inc")).toBe('"Acme, Inc"');
    expect(escapeCell('He said "no"')).toBe('"He said ""no"""');
    expect(escapeCell("first line\nsecond line")).toBe('"first line\nsecond line"');
    expect(escapeCell("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("defuses a cell a spreadsheet would run", () => {
    // notes and next_step are free text, written partly by extraction from a
    // pasted document — so the shortest path from a customer's file to a
    // formula executing on a colleague's machine runs through here.
    expect(escapeCell("=1+1")).toBe("'=1+1");
    expect(escapeCell('=HYPERLINK("http://evil.test","click")')).toBe(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    expect(escapeCell("+44 7700 900000")).toBe("'+44 7700 900000");
    expect(escapeCell("@mention")).toBe("'@mention");
    expect(escapeCell("-500")).toBe("'-500");
  });

  it("leaves a real negative number alone, because a number is not a formula", () => {
    // The first draft of this prefixed every leading "-", numbers included —
    // so a negative amount exported as text and silently stopped being part of
    // the column it is summed in. The guard is for text, which is where the
    // risk actually is.
    expect(escapeCell(-500)).toBe("-500");
    expect(escapeCell(-1234.5)).toBe("-1234.5");
    // The same characters typed into a text field are still defused.
    expect(escapeCell("-500")).toBe("'-500");
  });
});

describe("a file", () => {
  it("starts with a byte order mark, or Excel mangles every accent", () => {
    const csv = toCsv(["name"], [["Inés Bergström"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("Inés Bergström");
  });

  it("separates rows with CRLF, as RFC 4180 says", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe(`${CSV_BOM}a,b\r\n1,2\r\n`);
  });

  it("names itself from what it holds, safely", () => {
    expect(csvFilename(["Synthetic Orchard Lab", "deals", "2026-09-14"])).toBe("Synthetic-Orchard-Lab-deals-2026-09-14.csv");
    // An account name is typed by a person and reaches a content-disposition
    // header, so it is sanitised the way the documents route sanitises an
    // uploaded filename.
    expect(csvFilename(['bad"name', null, "x"])).toBe("bad-name-x.csv");
    expect(csvFilename([null])).toBe("export.csv");
  });
});

describe("what each export holds", () => {
  let seed: Seed;
  beforeEach(() => {
    seed = seedAccount();
  });

  it("gives the pipeline a row per open deal, with the account named", () => {
    const sheet = pipelineSheet({});
    expect(sheet.rows).toHaveLength(1);
    const row = Object.fromEntries(sheet.headers.map((h, i) => [h, sheet.rows[0]![i]]));
    expect(row.account).toBe("Synthetic Orchard Lab");
    expect(row.deal_id).toBe("SYN-DEAL-001");
    // Raw, not "$1,000" — a comma inside a money cell is how a column
    // stops being a number.
    expect(row.tcv_usd).toBe(1_000);
    expect(row.close_date).toBe("2026-12-01");
  });

  it("can be asked for won and lost, which nothing could before", () => {
    // listOpenDeals hardcoded `d.status = 'open'`, and it is the only
    // cross-account view of a deal there is — so marking a deal won removed it
    // from the last place it could be seen, and "what did we close this
    // quarter" meant opening every account page in turn.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { status: "won" },
      actorUserId: USER,
    });
    expect(pipelineSheet({}).rows).toHaveLength(0);
    expect(pipelineSheet({ status: "open" }).rows).toHaveLength(0);
    expect(pipelineSheet({ status: "won" }).rows).toHaveLength(1);
    expect(pipelineSheet({ status: "lost" }).rows).toHaveLength(0);
    expect(pipelineSheet({ status: "closed" }).rows).toHaveLength(1);
    expect(pipelineSheet({ status: "all" }).rows).toHaveLength(1);
  });

  it("still hides an archived deal whatever status is asked for", () => {
    // The status filter must not become a way round the archive filters, which
    // is the thing every read surface in this app has to get right.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { status: "won", archived_at: "2026-09-14" },
      actorUserId: USER,
    });
    for (const status of ["open", "won", "lost", "closed", "all"] as const) {
      expect(pipelineSheet({ status }).rows, status).toHaveLength(0);
    }
  });

  it("applies the same quarter filter the page applies", () => {
    // The page filters the quarter in JS because it is derived; an export
    // using a different rule from the screen it was reached from would be
    // worse than no export.
    const quarter = pipelineSheet({}).rows[0]![pipelineSheet({}).headers.indexOf("fiscal_quarter")] as string;
    expect(pipelineSheet({ fq: quarter }).rows).toHaveLength(1);
    expect(pipelineSheet({ fq: "FY99 Q9" }).rows).toHaveLength(0);
  });

  it("leaves an archived deal out of the pipeline and says so on the account", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { archived_at: "2026-09-01" },
      actorUserId: USER,
    });
    expect(pipelineSheet({}).rows).toHaveLength(0);
    // The account's own export is a working document rather than a report, so
    // it keeps the row and carries the date that explains it.
    const deals = accountDealsSheet(seed.accountId, { includeArchived: true });
    expect(deals.rows).toHaveLength(1);
    expect(deals.rows[0]![deals.headers.indexOf("archived_at")]).toBe("2026-09-01");
  });

  it("holds the people and the open follow-ups", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "action_item",
      op: "create",
      payload: { text: "Send the sizing document", status: "open", due: "2026-10-01", owner: "Finley Example" },
      actorUserId: USER,
    });
    expect(accountContactsSheet(seed.accountId).rows[0]![0]).toBe("Finley Example");
    const f = followUpsSheet(seed.accountId);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]![f.headers.indexOf("owner")]).toBe("Finley Example");
    expect(f.rows[0]![f.headers.indexOf("account")]).toBe("Synthetic Orchard Lab");
  });

  it("survives a deal whose notes are a formula", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { notes: '=cmd|"/c calc"!A1', next_step: "Follow up, then confirm" },
      actorUserId: USER,
    });
    const csv = sheetToCsv(pipelineSheet({}));
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
    // And the comma in an ordinary sentence still keeps its column.
    expect(csv).toContain('"Follow up, then confirm"');
  });
});
