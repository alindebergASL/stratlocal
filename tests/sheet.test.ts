// A CRM export is a spreadsheet, and until now this app could only read a
// report through a model.
//
// Four things are enumerable here and each of them is a way the import could
// be wrong without anything on a screen saying so: the parser (a quoted comma
// shifts every column after it), the column guess (a plausible wrong guess
// writes a date into the money column across a whole pipeline), the row reader
// (an unreadable cell must stop its row rather than be dropped from it), and
// the diff (the same rules the report import already applies to deals).
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, resetDbForTests } from "@/lib/db";
import { acceptProposal, applyEntityChange, archiveEntity, createProposalBatch } from "@/lib/proposals/apply";
import { isLocalDealId } from "@/lib/ids";
import { getDocument, latestInstallBase, listContacts, listDeals, listDocuments } from "@/lib/queries/accounts";
import { CsvError, parseCsv, splitHeader, looksLikeCsv } from "@/lib/sheet/csv";
import { guessKind, guessMapping, mappingProblems, normaliseHeader, type SheetMapping } from "@/lib/sheet/columns";
import { readDate, readDeals } from "@/lib/sheet/readDeals";
import { diffSheet } from "@/lib/sheet/diffSheet";
import { readContacts } from "@/lib/sheet/readContacts";
import { diffContacts } from "@/lib/sheet/diffContacts";
import { readInstallBase } from "@/lib/sheet/readInstallBase";
import { ContactPatch } from "@/lib/proposals/schema";
import { applySheet, previewSheet, SheetError, storeSheetDocument } from "@/lib/sheet/run";
import { seedAccount, USER, type Seed } from "./helpers";

const FIXTURE = readFileSync(join(process.cwd(), "tests/fixtures/pipeline-export.csv"), "utf8");

describe("reading a CSV", () => {
  it("keeps a comma and a newline that are inside quotes", () => {
    // The whole reason this is a state machine and not two splits. Both of
    // these appear in the fixture because both appear in a real export: an
    // amount written "$1,200" and a next step someone typed on two lines.
    const rows = parseCsv(`a,b\n"one, two","line one\nline two"\n`);
    expect(rows).toEqual([
      ["a", "b"],
      ["one, two", "line one\nline two"],
    ]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv(`a\n"he said ""no"""\n`)[1]).toEqual([`he said "no"`]);
  });

  it("strips the byte order mark Excel puts on the front", () => {
    // Left in, it becomes part of the first header's name and nothing matches
    // it — so the CRM ID column is silently unmapped on every Excel export.
    const { headers } = splitHeader(parseCsv("﻿Deal ID,Name\n1,x\n"));
    expect(headers[0]).toBe("Deal ID");
    expect(guessMapping(headers, "deal").deal_id).toBe(0);
  });

  it("handles CRLF and a trailing blank line", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("says so rather than swallowing the file into one cell", () => {
    expect(() => parseCsv(`a,b\n"never closed,2\n`)).toThrow(CsvError);
  });

  it("refuses a file with no rows", () => {
    expect(() => parseCsv("")).toThrow(CsvError);
    expect(() => parseCsv("\n\n")).toThrow(CsvError);
  });

  it("pads a short row rather than shifting the ones after it", () => {
    const { body } = splitHeader(parseCsv("a,b,c\n1,2\n"));
    expect(body[0]).toEqual(["1", "2", ""]);
  });

  it("names the spreadsheet formats that are not CSV", () => {
    // .xlsx is a zip and .xls an OLE file; both read as text produce nonsense
    // rather than an error, which is the worst of the three outcomes.
    expect(looksLikeCsv(Buffer.from("PKrest"))).toBe(false);
    expect(looksLikeCsv(Buffer.from("d0cf11e0a1b11ae1", "hex"))).toBe(false);
    expect(looksLikeCsv(Buffer.from("Deal ID,Name\n1,x\n"))).toBe(true);
  });
});

describe("guessing which column is which", () => {
  const headers = splitHeader(parseCsv(FIXTURE)).headers;

  it("reads the export's own words", () => {
    const m = guessMapping(headers, "deal");
    expect(headers[m.deal_id!]).toBe("Opportunity ID");
    expect(headers[m.name!]).toBe("Opportunity Name");
    expect(headers[m.close_date!]).toBe("Expected Close");
    expect(headers[m.tcv_usd!]).toBe("Amount");
    expect(headers[m.stage!]).toBe("Sales Stage");
    expect(headers[m.stage_label!]).toBe("Stage Name");
  });

  it("does not confuse two dates with each other", () => {
    // "Created Date" is in the fixture precisely so a substring match on
    // "date" would put it in the close-date slot, and the quarter every deal
    // is forecast in would be the quarter it was created in.
    const m = guessMapping(headers, "deal");
    expect(headers[m.close_date!]).not.toBe("Created Date");
  });

  it("leaves a column it does not recognise alone rather than guessing", () => {
    const m = guessMapping(["Name", "Wibble", "Frobnicator"], "deal");
    expect(m.name).toBe(0);
    expect(m.tcv_usd).toBeNull();
    expect(m.close_date).toBeNull();
  });

  it("claims a column once, so a second one with the same name is visible", () => {
    const m = guessMapping(["Name", "Amount", "Amount"], "deal");
    expect(m.tcv_usd).toBe(1);
    expect(Object.values(m).filter((v) => v === 2)).toHaveLength(0);
  });

  it("ignores the punctuation that differs between exports of the same CRM", () => {
    expect(normaliseHeader("Deal ID")).toBe(normaliseHeader("deal_id"));
    expect(normaliseHeader("Amount (USD)")).toBe("amount");
  });

  it("refuses a mapping with no name, or one column doing two jobs", () => {
    expect(mappingProblems({ name: null }, ["A", "B"], "deal")).toEqual([expect.stringContaining("Name")]);
    expect(mappingProblems({ name: 0, tcv_usd: 0 }, ["A", "B"], "deal")).toEqual([expect.stringMatching(/both Name and Value/)]);
    expect(mappingProblems({ name: 7 }, ["A"], "deal")).toEqual([expect.stringContaining("not in this file")]);
    expect(mappingProblems({ name: 0, tcv_usd: 1 }, ["A", "B"], "deal")).toEqual([]);
  });
});

describe("reading a row", () => {
  const { headers, body } = splitHeader(parseCsv(FIXTURE));
  const mapping = guessMapping(headers, "deal");
  const read = readDeals(body, mapping);

  it("reads money the way a seller writes it", () => {
    const byName = new Map(read.deals.map((d) => [d.name, d]));
    expect(byName.get("SyntheticOrchard_EHR-Refresh")?.tcv_usd).toBe(1_200);
    expect(byName.get("SyntheticOrchard_Campus-Wireless")?.tcv_usd).toBe(2_000);
    expect(byName.get("SyntheticOrchard_Storage, phase two")?.tcv_usd).toBe(3_000);
  });

  it("reads a date that names its month, and refuses one that does not", () => {
    expect(readDate("2026-12-01")).toBe("2026-12-01");
    expect(readDate("2026-12-01T00:00:00Z")).toBe("2026-12-01");
    expect(readDate("11 Feb 2027")).toBe("2027-02-11");
    expect(readDate("Feb 11, 2027")).toBe("2027-02-11");
    // The one that matters: 03/04/2026 is March in one locale and April in
    // another, which is two different quarters. Refused rather than read.
    expect(() => readDate("03/04/2026")).toThrow(/different quarter/);
    expect(() => readDate("2026-02-31")).toThrow(/not a real date/);
  });

  it("stops a row it cannot read and says which row and why", () => {
    const bad = read.skipped.find((s) => s.why.includes("03/04/2026"));
    expect(bad).toBeTruthy();
    // Row numbers count the header as row 1, because that is what the person
    // sees in the spreadsheet they are about to go and fix.
    expect(bad!.row).toBe(6);
    // And the row is not half-imported: nothing from it reaches the deals.
    expect(read.deals.some((d) => d.name === "SyntheticOrchard_Broken-Date")).toBe(false);
  });

  it("skips a row with no name, which is the one field a deal cannot do without", () => {
    expect(read.skipped.find((s) => s.row === 7)?.why).toBe("no name");
  });

  it("takes the first of two rows carrying the same CRM id", () => {
    // A joined export can list one opportunity twice. Two drafts for one id
    // would be two proposals editing the same row, and accepting both makes
    // the second a conflict.
    expect(read.deals.filter((d) => d.deal_id === "SYN-DEAL-001")).toHaveLength(1);
    expect(read.skipped.find((s) => s.row === 8)?.why).toMatch(/on an earlier row too/);
  });

  it("reads a status in the spellings an export uses", () => {
    const won = read.deals.find((d) => d.name === "SyntheticOrchard_Storage, phase two");
    expect(won?.status).toBe("won");
    expect(read.deals.find((d) => d.name === "SyntheticOrchard_EHR-Refresh")?.status).toBe("open");
  });

  it("leaves a blank cell undefined rather than null", () => {
    // undefined is "the export did not carry this", which the diff treats as
    // no evidence of a change. null would be an explicit clear, and a mostly
    // empty export would wipe every field anyone had typed.
    const wireless = read.deals.find((d) => d.name === "SyntheticOrchard_Campus-Wireless")!;
    expect(wireless.competitor).toBeUndefined();
    expect(wireless.partner).toBe("Synthetic Partner C");
  });

  it("gives a row with no id a null id rather than skipping it", () => {
    const pilot = read.deals.find((d) => d.name === "SyntheticOrchard_Analytics-Pilot");
    expect(pilot?.deal_id).toBeNull();
  });

  it("reads nothing from a column nobody mapped", () => {
    const only = readDeals(body, { name: mapping.name });
    expect(only.deals[0]?.tcv_usd).toBeUndefined();
    expect(only.deals[0]?.close_date).toBeUndefined();
    expect(only.deals[0]?.deal_id).toBeNull();
  });
});

describe("what it proposes", () => {
  let seed: Seed;
  beforeEach(() => {
    resetDbForTests();
    seed = seedAccount();
  });

  const state = (accountId: string) => ({
    account: { id: accountId, name: "Synthetic Orchard Lab" } as never,
    deals: listDeals(accountId, { includeArchived: true }),
    contacts: [],
    plays: [],
    installBaseAtAsOf: [],
  });

  it("proposes only the fields that differ", () => {
    // seedAccount's deal is SYN-DEAL-001 at stage 3, closing 2026-12-01, $1K.
    const drafts = diffSheet(
      [{ row: 2, deal_id: "SYN-DEAL-001", name: "EHR Refresh", stage: 3, close_date: "2026-12-01", tcv_usd: 1_200 }],
      state(seed.accountId),
      { documentId: "doc-1" },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.op).toBe("update");
    expect(drafts[0]!.payload).toEqual({ tcv_usd: 1_200 });
  });

  it("proposes nothing at all when the file matches", () => {
    expect(
      diffSheet([{ row: 2, deal_id: "SYN-DEAL-001", name: "EHR Refresh", stage: 3, close_date: "2026-12-01", tcv_usd: 1_000 }], state(seed.accountId), {
        documentId: "doc-1",
      }),
    ).toEqual([]);
  });

  it("never clears a field the export left blank", () => {
    // The row carries nothing but a name, and the deal on file has an owner, a
    // stage and a value. A blank cell is not a change.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { owner: "Gray Example", next_step: "Confirm the sizing" },
      actorUserId: USER,
    });
    expect(diffSheet([{ row: 2, deal_id: "SYN-DEAL-001", name: "EHR Refresh" }], state(seed.accountId), { documentId: "doc-1" })).toEqual([]);
  });

  it("creates a row with an id nobody has, and one with no id at all", () => {
    const drafts = diffSheet(
      [
        { row: 2, deal_id: "SYN-EXTRA-007", name: "New with an id" },
        { row: 3, deal_id: null, name: "New with none" },
      ],
      state(seed.accountId),
      { documentId: "doc-1" },
    );
    expect(drafts.map((d) => d.op)).toEqual(["create", "create"]);
    expect(drafts[0]!.payload).toMatchObject({ deal_id: "SYN-EXTRA-007" });
    // No deal_id key at all. That the *draft* looks like this is not the
    // interesting part and asserting only this is what let the bug through:
    // CREATE_REQUIRED listed deal_id, the local id was issued by the deal form
    // and nowhere else, and accepting this proposal threw
    // "deal.deal_id is required" — a review screen that looked right with a
    // button that did not work. So the draft is accepted here, not just read.
    expect(drafts[1]!.payload).not.toHaveProperty("deal_id");
    createProposalBatch(seed.accountId, { kind: "import", id: "doc-1", aiRunId: null }, [drafts[1]!]);
    const proposal = db().prepare(`SELECT id FROM proposals WHERE account_id = ? AND status = 'pending'`).get(seed.accountId) as { id: string };
    acceptProposal(proposal.id, USER);
    const made = listDeals(seed.accountId).find((d) => d.name === "New with none")!;
    expect(isLocalDealId(made.deal_id)).toBe(true);
  });

  it("offers an archived deal back rather than duplicating it", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "update",
      entityId: seed.dealId,
      payload: { archived_at: "2026-09-01" },
      actorUserId: USER,
    });
    const drafts = diffSheet([{ row: 2, deal_id: "SYN-DEAL-001", name: "EHR Refresh", tcv_usd: 1_500 }], state(seed.accountId), { documentId: "doc-1" });
    expect(drafts[0]!.op).toBe("update");
    expect(drafts[0]!.payload).toMatchObject({ archived_at: null, tcv_usd: 1_500 });
  });

  it("adds archived_at only when the row is actually archived", () => {
    // Unconditionally adding the key would change every update's payload bytes
    // and weaken the rejected-draft dedupe — the reasoning diffExtraction
    // already carries, restated here because this is a second writer.
    const drafts = diffSheet([{ row: 2, deal_id: "SYN-DEAL-001", name: "EHR Refresh", tcv_usd: 1_500 }], state(seed.accountId), { documentId: "doc-1" });
    expect(drafts[0]!.payload).not.toHaveProperty("archived_at");
  });

  it("follows a merged-away id to the survivor instead of resurrecting it", () => {
    // The failure the report import was fixed for, in the other importer: an
    // export still lists the id that ended up on the tombstone, the match
    // lands on an archived row, and one Accept all brings the duplicate back.
    const local = applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: "local-aaaabbbb", name: "EHR Refresh" },
      actorUserId: USER,
    }).entityId;
    db().prepare(`UPDATE deals SET merged_into = ?, archived_at = '2026-09-01' WHERE deal_id = ?`).run(seed.dealId, local);
    const drafts = diffSheet([{ row: 2, deal_id: "local-aaaabbbb", name: "EHR Refresh", tcv_usd: 1_500 }], state(seed.accountId), {
      documentId: "doc-1",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.entity_id).toBe(seed.dealId);
    expect(drafts[0]!.payload).not.toHaveProperty("archived_at");
  });

  it("warns that a row with no id will be a second copy on the next import", () => {
    // The honest consequence of "no id, nothing to match on". Matching such a
    // row by name instead would let a rename in the CRM overwrite an unrelated
    // deal, so it stays a create — and the card says what accepting it does
    // rather than leaving the duplicate to be found afterwards.
    const fresh = diffSheet([{ row: 2, deal_id: null, name: "Analytics Pilot" }], state(seed.accountId), { documentId: "doc-1" });
    expect(fresh[0]!.rationale).toMatch(/would add it a second time/);

    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { name: "Analytics Pilot" },
      actorUserId: USER,
    });
    const again = diffSheet([{ row: 2, deal_id: null, name: "Analytics Pilot" }], state(seed.accountId), { documentId: "doc-1" });
    expect(again[0]!.op).toBe("create");
    expect(again[0]!.rationale).toMatch(/Accepting adds a second row/);
  });

  it("says when a new id looks like the deal you already added without one", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "deal",
      op: "create",
      payload: { deal_id: "local-12345678", name: "Campus Wireless" },
      actorUserId: USER,
    });
    const drafts = diffSheet([{ row: 2, deal_id: "SYN-EXTRA-008", name: "Campus Wireless" }], state(seed.accountId), { documentId: "doc-1" });
    expect(drafts[0]!.rationale).toMatch(/merge them after accepting/);
  });
});

describe("the whole thing, through the stored file", () => {
  let seed: Seed;
  beforeEach(() => {
    resetDbForTests();
    seed = seedAccount();
  });

  const upload = (text = FIXTURE, filename = "pipeline-export.csv") =>
    storeSheetDocument({ accountId: seed.accountId, filename, bytes: Buffer.from(text, "utf8"), userId: USER });

  it("keeps the file, and the same file twice is the same document", () => {
    const first = upload();
    expect(listDocuments(seed.accountId, { kinds: ["other"] })).toHaveLength(1);
    expect(upload().id).toBe(first.id);
    expect(getDocument(first.id)?.mime).toBe("text/csv");
  });

  it("refuses a spreadsheet that is not a CSV, by name", () => {
    expect(() => upload("PKbinary")).toThrow(/saved as CSV/);
  });

  it("refuses a file it cannot parse before storing it", () => {
    expect(() => upload(`a,b\n"unclosed,2\n`)).toThrow(CsvError);
    expect(listDocuments(seed.accountId, { kinds: ["other"] })).toHaveLength(0);
  });

  it("previews the columns without proposing anything", () => {
    const p = previewSheet(upload());
    expect(p.headers).toContain("Opportunity ID");
    expect(p.rows).toBe(7);
    expect(p.sample).toHaveLength(5);
    expect(p.problems).toEqual([]);
    expect(db().prepare(`SELECT COUNT(*) AS n FROM proposals`).get()).toEqual({ n: 0 });
  });

  it("proposes the difference once the mapping is confirmed", () => {
    const doc = upload();
    const { mapping } = previewSheet(doc);
    const result = applySheet(doc, mapping, "deal");
    // Three rows are unusable and say why; the other four are read.
    expect(result.skipped.map((s) => s.row)).toEqual([6, 7, 8]);
    // One update (the seeded deal's value moved) and three creates.
    const proposals = db().prepare(`SELECT op, entity_id FROM proposals WHERE account_id = ?`).all(seed.accountId) as Array<{ op: string }>;
    expect(proposals.filter((p) => p.op === "update")).toHaveLength(1);
    expect(proposals.filter((p) => p.op === "create")).toHaveLength(3);
    expect(result.proposals).toBe(4);
  });

  it("refuses a mapping the screen should not have sent", () => {
    const doc = upload();
    expect(() => applySheet(doc, { name: null } as SheetMapping, "deal")).toThrow(SheetError);
    expect(() => applySheet(doc, { name: 0, tcv_usd: 0 }, "deal")).toThrow(/Pick one/);
  });

  it("costs nothing, because nothing here calls a model", () => {
    const doc = upload();
    applySheet(doc, previewSheet(doc).mapping, "deal");
    expect(db().prepare(`SELECT COUNT(*) AS n FROM ai_runs`).get()).toEqual({ n: 0 });
  });
});

describe("a cell the schema will not take", () => {
  // The reader refuses a date it cannot read and a stage outside 1-6, and says
  // which row. It does not bound the fields whose only limit lives in
  // DealPatch — a name over 400 characters, notes over 4000, a negative or
  // absurd value — and those reach createProposalBatch, which parses every
  // draft inside one transaction with no per-draft try (apply.ts:403-406).
  //
  // So one bad cell in a 300-row export throws a ZodError that rolls the whole
  // batch back: nothing is written, nothing is corrupted, and the person is
  // told nothing useful about which row to fix. That is the wrong half of
  // DECISIONS #27 — an unreadable cell must stop its own row by number and say
  // why, rather than taking the import down with it.
  let seed: Seed;
  beforeEach(() => {
    seed = seedAccount();
  });

  const importOf = (rows: string[][]) => {
    const header = "Deal Name,CRM ID,Value,Notes,Owner,Next Step,Competitor";
    const csv = [header, ...rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))].join("\n");
    const doc = storeSheetDocument({
      accountId: seed.accountId,
      filename: "export.csv",
      bytes: Buffer.from(csv, "utf8"),
      userId: USER,
    });
    return applySheet(doc, previewSheet(doc).mapping, "deal");
  };

  const GOOD_A = ["Alpha refresh", "A1", "250000", "", "", "", ""];
  const GOOD_B = ["Beta refresh", "B2", "310000", "", "", "", ""];

  it("lets the good rows through and names the bad one", () => {
    const bad: Array<[string, string[]]> = [
      ["a negative value", ["Negative", "N1", "-5000", "", "", "", ""]],
      ["a value too large to be one", ["Huge", "H1", "SYN-EXTRA-010SYN-EXTRA-0109999", "", "", "", ""]],
      ["notes past the field limit", ["Wordy", "W1", "", "x".repeat(5000), "", "", ""]],
      ["a name past the field limit", ["z".repeat(500), "Z1", "", "", "", "", ""]],
      ["an owner past the field limit", ["Owned", "O1", "", "", "y".repeat(500), "", ""]],
      ["a CRM id past the field limit", ["Ident", "i".repeat(100), "", "", "", "", ""]],
      ["a next step past the field limit", ["Stepper", "S1", "", "", "", "s".repeat(5000), ""]],
      ["a competitor past the field limit", ["Rivalled", "R1", "", "", "", "", "c".repeat(500)]],
    ];
    for (const [what, row] of bad) {
      const result = importOf([GOOD_A, row, GOOD_B]);
      // The two good rows are still proposed...
      expect(result.proposals, `${what}: the rest of the import should survive`).toBe(2);
      // ...and row 3 is reported by number, with a reason worth reading.
      expect(result.skipped.map((s) => s.row), `${what}: the bad row should be named`).toEqual([3]);
      expect(result.skipped[0]!.why.length, `${what}: should say why`).toBeGreaterThan(0);
    }
  });

  it("still imports a file whose every row is fine", () => {
    // The guard above must not start refusing ordinary values.
    const result = importOf([GOOD_A, GOOD_B]);
    expect(result.proposals).toBe(2);
    expect(result.skipped).toEqual([]);
  });
});

// A file of people, which is the other list a seller has lying around.
//
// The machinery is the deals machinery — same parser, same confirm-the-mapping
// screen, same "a blank cell is not a difference" rule. Two things are its own
// and both are enumerable: what a file is a list of (guessed from the headers,
// and read as the wrong kind it proposes the wrong records rather than
// failing), and how a person is matched, which has no id to work with.
describe("a spreadsheet of people", () => {
  const PEOPLE = readFileSync(join(process.cwd(), "tests/fixtures/people-export.csv"), "utf8");

  let seed: Seed;
  beforeEach(() => {
    resetDbForTests();
    seed = seedAccount();
  });

  const state = (accountId: string) => ({
    account: { id: accountId, name: "Synthetic Orchard Lab" } as never,
    deals: [],
    contacts: listContacts(accountId, { includeArchived: true }),
    plays: [],
    installBaseAtAsOf: [],
  });

  /** diffContacts returns drafts and refused rows; most cases here want the drafts. */
  const draftsOf = (...args: Parameters<typeof diffContacts>) => diffContacts(...args).drafts;

  it("tells the two kinds of file apart from their headers", () => {
    expect(guessKind(splitHeader(parseCsv(PEOPLE)).headers)).toBe("contact");
    expect(guessKind(splitHeader(parseCsv(FIXTURE)).headers)).toBe("deal");
    // Name and Notes are the only headers both kinds have, so a file carrying
    // nothing else cannot be told apart — and the tie goes to deals, which is
    // what this import was built for. The radio on the screen is the answer to
    // that, not a better guess.
    expect(guessKind(["Name", "Notes"])).toBe("deal");
  });

  it("maps the columns a person file has", () => {
    const { headers } = splitHeader(parseCsv(PEOPLE));
    const m = guessMapping(headers, "contact");
    expect(m).toMatchObject({ name: 0, email: 1, title: 2, org: 3, role: 4, notes: 5 });
    // The provenance column is nobody's field and stays unmapped rather than
    // being assigned to whatever is closest.
    expect(Object.values(m)).not.toContain(6);
  });

  it("reads the rows it can and stops the ones it cannot, by number", () => {
    const { body } = splitHeader(parseCsv(PEOPLE));
    const { contacts, skipped } = readContacts(body, guessMapping(splitHeader(parseCsv(PEOPLE)).headers, "contact"));
    expect(contacts.map((c) => c.name)).toEqual(["Finley Example", "Rowan Example", "Sasha Example", "Quinn Example"]);
    expect(skipped).toEqual([
      { row: 4, why: expect.stringContaining("not-an-address") },
      { row: 5, why: expect.stringContaining("earlier row") },
      { row: 6, why: "no name" },
    ]);
    expect(body).toHaveLength(7);
  });

  it("reads the words a spreadsheet writes a side and a role in", () => {
    const { body } = splitHeader(parseCsv(PEOPLE));
    const read = readContacts(body, guessMapping(splitHeader(parseCsv(PEOPLE)).headers, "contact"));
    const by = (name: string) => read.contacts.find((c) => c.name === name)!;
    expect(by("Sasha Example").org).toBe("partner");
    expect(by("Sasha Example").role).toBe("procurement");
    expect(by("Rowan Example").org).toBe("customer");
    expect(by("Finley Example").role).toBe("it_leader");
    // A role this app has no word for does not lose the person, and is not
    // guessed into one that sounds close. The job title keeps what they are.
    expect(by("Quinn Example").role).toBe("other");
    expect(by("Quinn Example").title).toBe("Head of Toy Things");
  });

  it("refuses exactly the addresses the write path would refuse", () => {
    // The reader exists to stop a cell the schema will not take, because
    // createProposalBatch parses a whole batch in one transaction with no
    // per-draft try — so one unusable address three hundred rows in throws a
    // ZodError and loses every other row with it.
    //
    // It hand-rolled "one @, something either side, a dot in the domain",
    // under a comment claiming nothing looser could get through. Ten of these
    // got through. The fix is not a better regex: it is running the schema's
    // own rule, so the two cannot disagree by construction.
    const bad = ["ari@example.c", "ari@-example.test", "ari@example..test", "ari@.com", ".ari@example.com", "ari.@example.com", "ari@example.com.", "äri@example.com", "ari@[1.2.3.4]", "ari@exa_mple.test", "not-an-address", "ari@@example.com"];
    const good = ["ari@example.test", "ari+tag@example.com", "ARI@EXAMPLE.COM", "very.long@sub.domain.example.com", "ari--b@example.net"];

    for (const email of bad) {
      const { contacts, skipped } = readContacts([["Ari Example", email]], { name: 0, email: 1 });
      expect(contacts, `${email} should not be read`).toEqual([]);
      expect(skipped[0]?.why, `${email} should say why`).toMatch(/email address/);
      // The assertion that matters: whatever the reader let through, the
      // schema has to accept. Anything else is an import that dies on row 3.
      expect(ContactPatch.safeParse({ email }).success, `${email} is refused by the schema`).toBe(false);
    }
    for (const email of good) {
      const { contacts, skipped } = readContacts([["Ari Example", email]], { name: 0, email: 1 });
      expect(skipped, `${email} should be read`).toEqual([]);
      expect(contacts[0]?.email).toBe(email);
      expect(ContactPatch.safeParse({ email }).success, `${email} is taken by the schema`).toBe(true);
    }
  });

  it("refuses a side it cannot read rather than filing them under a guess", () => {
    const { contacts, skipped } = readContacts([["Ari Example", "", "", "Somewhere else", "", ""]], { name: 0, email: 1, title: 2, org: 3, role: 4, notes: 5 });
    expect(contacts).toEqual([]);
    expect(skipped[0]?.why).toMatch(/customer, vendor or partner/);
  });

  it("matches somebody already here, and proposes only what differs", () => {
    // seedAccount's person is Finley Example, org customer, role it_leader,
    // with no title and no email.
    const drafts = draftsOf(
      [{ row: 2, name: "Finley Example", title: "Director of Infrastructure", org: "customer", role: "it_leader" }],
      state(seed.accountId),
      { documentId: "doc-1" },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.op).toBe("update");
    expect(drafts[0]!.entity_id).toBe(seed.contactId);
    expect(drafts[0]!.payload).toEqual({ title: "Director of Infrastructure" });
  });

  it("does not propose the name it matched them by", () => {
    // With no address, the name is the key. Proposing it back would be a
    // review card that says nothing and costs a decision.
    const drafts = draftsOf([{ row: 2, name: "finley  example" }], state(seed.accountId), { documentId: "doc-1" });
    expect(drafts).toEqual([]);
  });

  it("does not propose the name that matched them even when the row carries an address", () => {
    // The rule is "was the name what found them", and it used to be asked as
    // "does this row have an email" — which are different questions whenever
    // the address is one we do not have yet. The row then falls through to the
    // name match and proposes back the capitalisation that found it.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "rowan example", org: "customer" },
      actorUserId: USER,
    });
    const drafts = draftsOf([{ row: 2, name: "Rowan Example", email: "rowan@example.com" }], state(seed.accountId), { documentId: "doc-1" });
    // The address is real news and is proposed. The name is not.
    expect(drafts[0]!.payload).toEqual({ email: "rowan@example.com" });
  });

  it("proposes a rename when the address is what matched them", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      entityId: seed.contactId,
      op: "update",
      payload: { email: "finley@example.com" },
      actorUserId: USER,
    });
    const drafts = draftsOf([{ row: 2, name: "Finley Example-Marsh", email: "finley@example.com" }], state(seed.accountId), { documentId: "doc-1" });
    expect(drafts[0]!.payload).toEqual({ name: "Finley Example-Marsh" });
  });

  it("matches on the address before the name", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Rowan Example", org: "customer", email: "rowan@example.com" },
      actorUserId: USER,
    });
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Rowan Example", org: "customer", email: "other.rowan@example.com" },
      actorUserId: USER,
    });
    const drafts = draftsOf([{ row: 2, name: "Rowan Example", email: "other.rowan@example.com", title: "VP Platform" }], state(seed.accountId), {
      documentId: "doc-1",
    });
    const rows = listContacts(seed.accountId);
    expect(drafts[0]!.entity_id).toBe(rows.find((c) => c.email === "other.rowan@example.com")!.id);
  });

  it("stops a second row that turns out to be the same person", () => {
    // The reader dedupes on what the file says; a person is matched against
    // what is on file. So one row can match by name and the next by an address
    // the first row did not carry, and both resolve to one contact — two
    // update proposals on one record, the second of which becomes a conflict
    // when you accept it, because its before_json predates the first.
    //
    // Deals cannot do this: their dedupe key is their match key, so the reader
    // catches every collision itself. Only the diff can see this one.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      entityId: seed.contactId,
      op: "update",
      payload: { email: "finley@example.com" },
      actorUserId: USER,
    });
    const { drafts, skipped } = diffContacts(
      [
        { row: 2, name: "Finley Example", title: "Director" },
        { row: 3, name: "F. Example", email: "finley@example.com", title: "Head of Infrastructure" },
      ],
      state(seed.accountId),
      { documentId: "doc-1" },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.entity_id).toBe(seed.contactId);
    expect(drafts[0]!.payload).toEqual({ title: "Director" });
    // Named by number, and told which row it collided with, because "one of
    // your rows was ignored" is not something anybody can act on.
    expect(skipped).toEqual([{ row: 3, why: expect.stringContaining("same person as row 2") }]);
  });

  it("keeps two rows with distinct addresses apart when the match on file has none", () => {
    // The collision refusal above fires when two rows are one person reached
    // by different columns. Two rows that each carry a *different* explicit
    // address are two identities, not one — but against an email-less record
    // they both name-match it, and the second used to be refused as a
    // collision, making a distinct person vanish from the import.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      entityId: seed.contactId,
      op: "update",
      payload: { name: "Synthetic Sam", email: null },
      actorUserId: USER,
    });
    const { drafts, skipped } = diffContacts(
      [
        { row: 2, name: "Synthetic Sam", email: "sam.a@example.test", title: "Director" },
        { row: 3, name: "Synthetic Sam", email: "sam.b@example.test", title: "Engineer" },
      ],
      state(seed.accountId),
      { documentId: "doc-1" },
    );
    expect(skipped).toEqual([]);
    // Row 2 claims the email-less record (an omission, not a different
    // identity); row 3's distinct address is a distinct person and is created.
    expect(drafts).toHaveLength(2);
    const update = drafts.find((d) => d.op === "update")!;
    const create = drafts.find((d) => d.op === "create")!;
    expect(update.entity_id).toBe(seed.contactId);
    expect(update.payload).toMatchObject({ email: "sam.a@example.test" });
    expect(create.payload).toMatchObject({ name: "Synthetic Sam", email: "sam.b@example.test" });
  });

  it("still refuses a collision when only one of the rows carries an address", () => {
    // One address between two rows is not evidence of two people: the
    // address-less row is the omission case the match rule deliberately keeps.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      entityId: seed.contactId,
      op: "update",
      payload: { name: "Synthetic Sam", email: null },
      actorUserId: USER,
    });
    const { drafts, skipped } = diffContacts(
      [
        { row: 2, name: "Synthetic Sam", title: "Director" },
        { row: 3, name: "Synthetic Sam", email: "sam.b@example.test", title: "Engineer" },
      ],
      state(seed.accountId),
      { documentId: "doc-1" },
    );
    expect(drafts).toHaveLength(1);
    expect(skipped).toEqual([{ row: 3, why: expect.stringContaining("same person as row 2") }]);
  });

  it("and the refused row reaches the screen with the unreadable ones, in file order", () => {
    // The reader's refusals and the diff's are two lists of rows a person has
    // to be told about. They are one list on the screen, or the second one is
    // a silent drop wearing a different name.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      entityId: seed.contactId,
      op: "update",
      payload: { email: "finley@example.com" },
      actorUserId: USER,
    });
    const csv = [
      "Name,Email",
      "Finley Example,",
      "Ari Example,not-an-address",
      "F. Example,finley@example.com",
    ].join("\n");
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "people.csv", bytes: Buffer.from(csv, "utf8"), userId: USER });
    const result = applySheet(doc, { name: 0, email: 1 }, "contact");
    expect(result.skipped.map((s) => s.row)).toEqual([3, 4]);
    expect(result.skipped[0]!.why).toMatch(/email address/);
    expect(result.skipped[1]!.why).toMatch(/same person as row 2/);
  });

  it("creates a new person at the customer, not on our own team", () => {
    // The report import creates a `vendor`, because that block of a report is
    // the seller team. A spreadsheet is the customer's people far more often,
    // and filing them as colleagues would put them in the wrong half of every
    // screen that groups by side.
    const drafts = draftsOf([{ row: 3, name: "Rowan Example", email: "rowan@example.com", title: "VP Platform" }], state(seed.accountId), {
      documentId: "doc-1",
    });
    expect(drafts[0]!.op).toBe("create");
    expect(drafts[0]!.payload).toEqual({ name: "Rowan Example", org: "customer", email: "rowan@example.com", title: "VP Platform" });
  });

  it("says on the card when a row has no address to match on next time", () => {
    const [withEmail] = draftsOf([{ row: 2, name: "Rowan Example", email: "rowan@example.com" }], state(seed.accountId), { documentId: "doc-1" });
    const [without] = draftsOf([{ row: 2, name: "Rowan Example" }], state(seed.accountId), { documentId: "doc-1" });
    expect(without!.rationale).toMatch(/no email address/);
    expect(withEmail!.rationale).not.toMatch(/no email address/);
  });

  it("offers an archived person back rather than duplicating them", () => {
    archiveEntity({ accountId: seed.accountId, entityType: "contact", entityId: seed.contactId, actorUserId: USER });
    const drafts = draftsOf([{ row: 2, name: "Finley Example", title: "Director of Infrastructure" }], state(seed.accountId), { documentId: "doc-1" });
    expect(drafts[0]!.op).toBe("update");
    expect(drafts[0]!.payload).toEqual({ title: "Director of Infrastructure", archived_at: null });
    expect(drafts[0]!.rationale).toMatch(/Archived/);
  });

  it("never carries archived_at on an ordinary update, so the dedupe keeps working", () => {
    const drafts = draftsOf([{ row: 2, name: "Finley Example", title: "Director of Infrastructure" }], state(seed.accountId), { documentId: "doc-1" });
    expect(Object.keys(drafts[0]!.payload)).not.toContain("archived_at");
  });

  it("never clears a field from a blank cell", () => {
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      entityId: seed.contactId,
      op: "update",
      payload: { title: "Director of Infrastructure", notes: "Typed by a person" },
      actorUserId: USER,
    });
    // A file carrying names and nothing else.
    expect(draftsOf([{ row: 2, name: "Finley Example" }], state(seed.accountId), { documentId: "doc-1" })).toEqual([]);
  });

  it("goes the whole way through the stored file, and the second import is quiet", () => {
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "people-export.csv", bytes: Buffer.from(PEOPLE, "utf8"), userId: USER });
    const preview = previewSheet(doc);
    expect(preview.kind).toBe("contact");

    const first = applySheet(doc, preview.mapping, "contact");
    expect(first.kind).toBe("contact");
    expect(first.skipped.map((s) => s.row)).toEqual([4, 5, 6]);
    // One update (Finley gains a title) and three people who were not here.
    expect(first.proposals).toBe(4);
    for (const id of db().prepare(`SELECT id FROM proposals WHERE account_id = ?`).pluck().all(seed.accountId) as string[]) {
      acceptProposal(id, USER);
    }
    expect(listContacts(seed.accountId).map((c) => c.name).sort()).toEqual(["Finley Example", "Quinn Example", "Rowan Example", "Sasha Example"]);

    // The same file again proposes nothing, which is the matching working: no
    // id in the file, and four people found by address and by name.
    const again = applySheet(doc, preview.mapping, "contact");
    expect(again.proposals).toBe(0);
  });

  it("proposes what the confirmed kind says, not what the headers hint", () => {
    // The kind is not re-guessed at apply time — it is what the person
    // confirmed, and the field table follows it. A file of names read as deals
    // proposes a pipeline named after colleagues, which is exactly why the
    // radio exists, and why this is worth pinning: nothing downstream second-
    // guesses the answer.
    const both = "Name,Notes\nRowan Example,Toy note\n";
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "both.csv", bytes: Buffer.from(both, "utf8"), userId: USER });
    const headers = splitHeader(parseCsv(both)).headers;

    applySheet(doc, guessMapping(headers, "contact"), "contact");
    expect(db().prepare(`SELECT entity_type FROM proposals`).pluck().all()).toEqual(["contact"]);

    db().prepare(`DELETE FROM proposals`).run();
    applySheet(doc, guessMapping(headers, "deal"), "deal");
    expect(db().prepare(`SELECT entity_type FROM proposals`).pluck().all()).toEqual(["deal"]);
  });

  it("keeps two people of one name apart when each row carries its own address", () => {
    // A name is not an identifier and two people do share one. Both of these
    // rows say which person they are, so there is nothing to guess — and the
    // reader used to drop the second anyway, advising a separate address for
    // each when each already had one.
    const { contacts, skipped } = readContacts(
      [
        ["Synthetic Sam", "sam.a@example.test"],
        ["Synthetic Sam", "sam.b@example.test"],
      ],
      { name: 0, email: 1 },
    );
    expect(contacts.map((c) => c.email)).toEqual(["sam.a@example.test", "sam.b@example.test"]);
    expect(skipped).toEqual([]);
  });

  it("still refuses a repeated address, and a name nothing can tell apart, whichever row is first", () => {
    const repeated = readContacts(
      [
        ["Synthetic Sam", "sam@example.test"],
        ["Sam, Synthetic", "SAM@example.test"],
      ],
      { name: 0, email: 1 },
    );
    expect(repeated.contacts).toHaveLength(1);
    expect(repeated.skipped[0]).toMatchObject({ row: 3, why: expect.stringContaining("earlier row") });

    // Neither row says which person it is.
    const neither = readContacts([["Synthetic Sam", ""], ["Synthetic  sam ", ""]], { name: 0, email: 1 });
    expect(neither.contacts).toHaveLength(1);
    expect(neither.skipped[0]!.why).toMatch(/no address to tell them apart/);

    // One does and one does not, both ways round: the pair is still ambiguous,
    // because the row with no address could be either of them.
    const addressFirst = readContacts([["Synthetic Sam", "sam.a@example.test"], ["synthetic sam", ""]], { name: 0, email: 1 });
    expect(addressFirst.contacts.map((c) => c.email)).toEqual(["sam.a@example.test"]);
    expect(addressFirst.skipped[0]!.why).toMatch(/no address to tell them apart/);

    const blankFirst = readContacts([["Synthetic Sam", ""], ["synthetic sam", "sam.b@example.test"]], { name: 0, email: 1 });
    expect(blankFirst.contacts.map((c) => c.email)).toEqual([undefined]);
    expect(blankFirst.skipped[0]!.why).toMatch(/that row has no address/);
  });

  it("does not let a row it refused hold the name or the address of the next good one", () => {
    const { contacts, skipped } = readContacts(
      [
        ["Rowan Example", "rowan@example.test", "x".repeat(401)],
        ["Rowan Example", "rowan@example.test", "Head of Platform"],
      ],
      { name: 0, email: 1, title: 2 },
    );
    expect(skipped.map((s) => s.row)).toEqual([2]);
    expect(contacts).toEqual([{ row: 3, name: "Rowan Example", email: "rowan@example.test", title: "Head of Platform" }]);
  });

  it("carries two people of one name the whole way through applySheet, without collapsing them onto one record", () => {
    // The end of the same defect: past the reader, `matchContact` fell back to
    // the name for the second row, landed on the person the first row had just
    // matched, and diffContacts refused it as the same human reached by a
    // different column — so one of the two was never proposed at all.
    applyEntityChange({
      accountId: seed.accountId,
      entityType: "contact",
      op: "create",
      payload: { name: "Synthetic Sam", org: "customer", email: "sam.a@example.test" },
      actorUserId: USER,
    });
    const csv = "Name,Email,Title\nSynthetic Sam,sam.a@example.test,Director of Infrastructure\nSynthetic Sam,sam.b@example.test,Head of Networks\n";
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "people.csv", bytes: Buffer.from(csv, "utf8"), userId: USER });
    const result = applySheet(doc, { name: 0, email: 1, title: 2 }, "contact");
    expect(result.skipped).toEqual([]);
    expect(result.proposals).toBe(2);
    for (const id of db().prepare(`SELECT id FROM proposals WHERE account_id = ?`).pluck().all(seed.accountId) as string[]) {
      acceptProposal(id, USER);
    }
    const sams = listContacts(seed.accountId).filter((c) => c.name === "Synthetic Sam");
    expect(sams.map((c) => c.email).sort()).toEqual(["sam.a@example.test", "sam.b@example.test"]);
    expect(sams.map((c) => c.title).sort()).toEqual(["Director of Infrastructure", "Head of Networks"]);
  });

  it("still matches by name when the person on file has no address to disagree with", () => {
    // The other half of the rule: a blank column is an omission, not evidence
    // of a different person, so the archived-and-nameless case still matches
    // rather than duplicating them.
    const drafts = draftsOf([{ row: 2, name: "Finley Example", email: "finley@example.test" }], state(seed.accountId), { documentId: "doc-1" });
    expect(drafts[0]!.op).toBe("update");
    expect(drafts[0]!.entity_id).toBe(seed.contactId);
    expect(drafts[0]!.payload).toEqual({ email: "finley@example.test" });
  });

  it("refuses a people file sent as deals when it has no deal name column", () => {
    // Not the defence — the kind is — but worth knowing it lands as a refusal
    // naming the missing column rather than as rows read from nothing.
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "people-export.csv", bytes: Buffer.from(PEOPLE, "utf8"), userId: USER });
    expect(() => applySheet(doc, guessMapping(splitHeader(parseCsv(PEOPLE)).headers, "deal"), "deal")).toThrow(/mapped to Name/);
  });
});

// A spreadsheet of install base, which is the third kind.
//
// The machinery is the machinery. What is its own is the date — one answer for
// the whole file, typed, because a snapshot is filed under the date it
// describes (DECISIONS #19) and the trend is read off exactly that — and the
// fact that a *partial* file filed under a new date makes every family it does
// not mention read as a fall to zero.
describe("a spreadsheet of install base", () => {
  const SHEET = readFileSync(join(process.cwd(), "tests/fixtures/install-base-export.csv"), "utf8");

  let seed: Seed;
  beforeEach(() => {
    resetDbForTests();
    seed = seedAccount();
  });

  const headersOf = () => splitHeader(parseCsv(SHEET)).headers;
  const bodyOf = () => splitHeader(parseCsv(SHEET)).body;

  it("is told apart from the other two by its headers", () => {
    expect(guessKind(headersOf())).toBe("install_base");
    // "Product family" is an install base's subject and also a deal's
    // architecture, so it decides nothing on its own — the share is the tell.
    expect(guessKind(["Product Family", "Amount", "Stage", "Close Date"])).toBe("deal");
    expect(guessKind(["Product Family", "Our Share"])).toBe("install_base");
  });

  it("maps its columns and leaves the provenance one alone", () => {
    const m = guessMapping(headersOf(), "install_base");
    expect(m).toMatchObject({ product_family: 0, value_usd: 1, share_pct: 2, role_note: 3 });
    expect(Object.values(m)).not.toContain(4);
  });

  it("reads the rows it can and stops the rest by number", () => {
    const { lines, skipped } = readInstallBase(bodyOf(), guessMapping(headersOf(), "install_base"));
    expect(lines.map((l) => l.product_family)).toEqual(["Compute", "Storage", "Networking"]);
    expect(skipped).toEqual([
      // A snapshot holds one line per family: the second would violate
      // UNIQUE (account_id, product_family, as_of) at accept time.
      { row: 5, why: expect.stringContaining("earlier row") },
      { row: 6, why: "no product family" },
      { row: 7, why: expect.stringContaining("as an amount") },
      { row: 8, why: expect.stringContaining("between 0 and 100") },
    ]);
  });

  it("reads money and a share the way a person writes them", () => {
    const { lines } = readInstallBase(bodyOf(), guessMapping(headersOf(), "install_base"));
    expect(lines[0]).toMatchObject({ value_usd: 4_100_000, share_pct: 34, role_note: "Refresh due next year" });
    expect(lines[1]).toMatchObject({ value_usd: 900_000, share_pct: 12 });
    expect(lines[2]?.value_usd).toBe(2_400_000);
  });

  it("refuses a date that is not one, rather than filing a snapshot under it", () => {
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "ib.csv", bytes: Buffer.from(SHEET, "utf8"), userId: USER });
    const m = guessMapping(headersOf(), "install_base");
    expect(() => applySheet(doc, m, "install_base", "2026-13-45")).toThrow(/real calendar date|date this snapshot describes/i);
    expect(() => applySheet(doc, m, "install_base", "")).toThrow(/date this snapshot describes/i);
    expect(() => applySheet(doc, m, "install_base", "2099-01-01")).toThrow(/future/i);
  });

  it("files a new snapshot, and a second import of the same file proposes nothing", () => {
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "ib.csv", bytes: Buffer.from(SHEET, "utf8"), userId: USER });
    const m = guessMapping(headersOf(), "install_base");
    const first = applySheet(doc, m, "install_base", "2026-06-30");
    expect(first.proposals).toBe(3);
    expect(first.skipped.map((s) => s.row)).toEqual([5, 6, 7, 8]);
    for (const id of db().prepare(`SELECT id FROM proposals WHERE account_id = ?`).pluck().all(seed.accountId) as string[]) {
      acceptProposal(id, USER);
    }
    const stored = latestInstallBase(seed.accountId);
    expect(stored.asOf).toBe("2026-06-30");
    expect(stored.rows.map((r) => r.product_family).sort()).toEqual(["Compute", "Networking", "Storage"]);

    // The same file under the same date is a diff, and nothing differs. This is
    // the behaviour the report path was fixed for last round, and it is shared
    // code now rather than a second copy of the rule.
    expect(applySheet(doc, m, "install_base", "2026-06-30").proposals).toBe(0);
  });

  it("proposes an update for a figure that changed, not a create that cannot be applied", () => {
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "ib.csv", bytes: Buffer.from(SHEET, "utf8"), userId: USER });
    const m = guessMapping(headersOf(), "install_base");
    applySheet(doc, m, "install_base", "2026-06-30");
    for (const id of db().prepare(`SELECT id FROM proposals WHERE account_id = ?`).pluck().all(seed.accountId) as string[]) {
      acceptProposal(id, USER);
    }
    const corrected = SHEET.replace('"$4,100,000"', "4250000");
    const doc2 = storeSheetDocument({ accountId: seed.accountId, filename: "ib2.csv", bytes: Buffer.from(corrected, "utf8"), userId: USER });
    const again = applySheet(doc2, m, "install_base", "2026-06-30");
    expect(again.proposals).toBe(1);
    const draft = db().prepare(`SELECT op, payload_json FROM proposals WHERE status = 'pending'`).get() as { op: string; payload_json: string };
    expect(draft.op).toBe("update");
    expect(JSON.parse(draft.payload_json)).toEqual({ value_usd: 4_250_000 });
  });

  it("says what a partial file will do to the trend before anything is proposed", () => {
    // installBaseTrend renders a family that was there before and is absent now
    // as gone, with a value of zero. Right for a report that stopped listing
    // it; a lie for a sheet that only ever covered part of the estate. Every
    // review card for it is an ordinary create, so the review screen cannot
    // tell you — this is the only place it can be said.
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "ib.csv", bytes: Buffer.from(SHEET, "utf8"), userId: USER });
    const m = guessMapping(headersOf(), "install_base");
    applySheet(doc, m, "install_base", "2026-03-31");
    for (const id of db().prepare(`SELECT id FROM proposals WHERE account_id = ?`).pluck().all(seed.accountId) as string[]) {
      acceptProposal(id, USER);
    }
    const partial = "Product Family,Installed Value,Our Share\nCompute,4200000,35\n";
    const doc2 = storeSheetDocument({ accountId: seed.accountId, filename: "partial.csv", bytes: Buffer.from(partial, "utf8"), userId: USER });
    const headers2 = splitHeader(parseCsv(partial)).headers;
    const later = applySheet(doc2, guessMapping(headers2, "install_base"), "install_base", "2026-06-30");
    expect(later.warning).toMatch(/other 2 will read as/);
    expect(later.warning).toMatch(/2026-03-31/);
  });

  it("stops a value cell the patch would refuse, by row, instead of losing the file to it", () => {
    // The reader took readMoney's answer as final, and readMoney returns -1 and
    // 1e21 quite happily. InstallBasePatch takes neither, and
    // createProposalBatch parses the whole batch in one transaction — so one
    // negative cell threw a ZodError naming a Zod path and the valid rows
    // above it were never stored at all. Same three refusals as a deal's TCV,
    // shared rather than described.
    const m: SheetMapping = { product_family: 0, value_usd: 1 };
    const { lines, skipped } = readInstallBase(
      [
        ["Compute", "100"],
        ["Storage", "-1"],
        ["Networking", "9007199254740993"],
        ["Services", "0"],
        ["Support", ""],
      ],
      m,
    );
    expect(lines).toEqual([
      { row: 2, product_family: "Compute", value_usd: 100 },
      // Zero is a figure somebody measured, not a missing one.
      { row: 5, product_family: "Services", value_usd: 0 },
      // A blank cell is an omission and never reaches the payload.
      { row: 6, product_family: "Support" },
    ]);
    expect(skipped).toEqual([
      { row: 3, why: expect.stringContaining("negative") },
      { row: 4, why: expect.stringContaining("too large") },
    ]);
    expect(skipped[0]!.why).toContain("install-base line");
  });

  it("does not let a row it refused claim the family of the next good one", () => {
    const { lines, skipped } = readInstallBase(
      [
        ["Compute", "-1"],
        ["Compute", "100"],
      ],
      { product_family: 0, value_usd: 1 },
    );
    expect(lines).toEqual([{ row: 3, product_family: "Compute", value_usd: 100 }]);
    expect(skipped).toEqual([{ row: 2, why: expect.stringContaining("negative") }]);
  });

  it("proposes the valid rows of a file whose other rows are refused", () => {
    const csv = "Product Family,Value\nCompute,100\nStorage,-1\n";
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "mixed.csv", bytes: Buffer.from(csv, "utf8"), userId: USER });
    const headers = splitHeader(parseCsv(csv)).headers;
    const result = applySheet(doc, guessMapping(headers, "install_base"), "install_base", "2026-06-30");
    expect(result.proposals).toBe(1);
    expect(result.skipped).toEqual([{ row: 3, why: expect.stringContaining("negative") }]);
    for (const id of db().prepare(`SELECT id FROM proposals WHERE account_id = ?`).pluck().all(seed.accountId) as string[]) {
      acceptProposal(id, USER);
    }
    expect(latestInstallBase(seed.accountId).rows.map((r) => [r.product_family, r.value_usd])).toEqual([["Compute", 100]]);
  });

  it("says nothing when the file is not partial, or when the date is already filed", () => {
    const doc = storeSheetDocument({ accountId: seed.accountId, filename: "ib.csv", bytes: Buffer.from(SHEET, "utf8"), userId: USER });
    const m = guessMapping(headersOf(), "install_base");
    // A first snapshot has nothing to be partial against.
    expect(applySheet(doc, m, "install_base", "2026-03-31").warning).toBeUndefined();
    for (const id of db().prepare(`SELECT id FROM proposals WHERE account_id = ?`).pluck().all(seed.accountId) as string[]) {
      acceptProposal(id, USER);
    }
    // And filing under a date already on file is a diff, so a family the file
    // does not mention is left alone rather than reading as gone.
    const partial = "Product Family,Installed Value\nCompute,4200000\n";
    const doc2 = storeSheetDocument({ accountId: seed.accountId, filename: "p.csv", bytes: Buffer.from(partial, "utf8"), userId: USER });
    const headers2 = splitHeader(parseCsv(partial)).headers;
    expect(applySheet(doc2, guessMapping(headers2, "install_base"), "install_base", "2026-03-31").warning).toBeUndefined();
  });
});
