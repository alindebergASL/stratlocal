import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDbForTests, type DocumentRow } from "@/lib/db";
import { newId } from "@/lib/ids";
import { archiveDocument, restoreDocument } from "@/lib/documents";
import { createProposalBatch } from "@/lib/proposals/apply";
import { buildContextPack, evidenceIds } from "@/lib/meetings/contextPack";
import { entityHistory, getDocument, listArchivedDocuments, listDocuments } from "@/lib/queries/accounts";
import { acceptNote, listNotes, researchForPrompt } from "@/lib/research/notes";
import { seedAccount, USER, type Seed } from "./helpers";

const URL_A = "https://www.example.com/a";
const URL_B = "https://www.example.com/b";

function insertNote(accountId: string, status: "draft" | "accepted"): string {
  const id = newId();
  const finding = (url: string, text: string) => ({
    text,
    quote: text,
    url,
    confidence: "high",
    date: null,
    topic: "strategy",
  });
  const meta = {
    title: "SyntheticOrchard: public signals",
    summary: "What is published about them.",
    findings: [finding(URL_A, "A capital plan runs to 2029."), finding(URL_B, "A new CIO started in May.")],
    open_questions: [],
    focus: null,
    depth: "standard",
    generated_at: "2026-09-12",
    searches: 3,
    fetches: 1,
    dropped: [],
    ...(status === "accepted" ? { accepted_finding_indexes: [0, 1] } : {}),
  };
  db()
    .prepare(
      `INSERT INTO documents (id, account_id, kind, filename, byte_size, content_text, meta_json, status, created_by, created_at)
       VALUES (?, ?, 'research_note', 'research.md', 10, 'prose', ?, ?, ?, ?)`,
    )
    .run(id, accountId, JSON.stringify(meta), status, USER, Date.now());
  return id;
}

// Every surface that must stop showing an archived document, in one object.
// A missed filter is a silent bug, and the dangerous one here is inPrompt:
// a note someone retracted would otherwise keep feeding Bedrock forever.
function visibility(accountId: string, docId: string) {
  const pack = buildContextPack(accountId);
  return {
    listed: listDocuments(accountId, { kinds: ["research_note"] }).some((d) => d.id === docId),
    inArchivedList: listArchivedDocuments(accountId).some((d) => d.id === docId),
    inNotes: listNotes(accountId).some((n) => n.doc.id === docId),
    inPack: pack.research.some((r) => r.id.startsWith(`${docId}#`)),
    citable: evidenceIds(pack).has(`${docId}#0`),
    inPrompt: researchForPrompt(accountId).includes(docId),
    resolvesDirectly: getDocument(docId) !== null,
  };
}

let seed: Seed;

beforeEach(() => {
  resetDbForTests();
  seed = seedAccount();
});

describe("archiving a document", () => {
  it("takes an accepted note out of every surface at once, and brings it back", () => {
    const id = insertNote(seed.accountId, "accepted");
    expect(visibility(seed.accountId, id)).toEqual({
      listed: true,
      inArchivedList: false,
      inNotes: true,
      inPack: true,
      citable: true,
      inPrompt: true,
      resolvesDirectly: true,
    });

    archiveDocument(id, USER);
    expect(visibility(seed.accountId, id)).toEqual({
      listed: false,
      inArchivedList: true,
      inNotes: false,
      inPack: false,
      citable: false,
      inPrompt: false,
      // Unfiltered on purpose, like getAccount and getMeeting: a direct link
      // must still resolve so it can be read and restored.
      resolvesDirectly: true,
    });

    restoreDocument(id, USER);
    expect(visibility(seed.accountId, id).inPack).toBe(true);
  });

  it("never lets a draft note reach a prompt, archived or not", () => {
    const id = insertNote(seed.accountId, "draft");
    expect(visibility(seed.accountId, id)).toMatchObject({
      listed: true,
      inPack: false,
      inPrompt: false,
    });
    archiveDocument(id, USER);
    expect(visibility(seed.accountId, id)).toMatchObject({
      listed: false,
      inPack: false,
      inPrompt: false,
    });
  });

  it("records who hid it and when", () => {
    const id = insertNote(seed.accountId, "accepted");
    archiveDocument(id, USER, "2026-09-12");
    const rows = entityHistory("document", id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      field: "archived_at",
      old_value: null,
      new_value: '"2026-09-12"',
      actor_user_id: USER,
    });
  });

  it("rejects the account's pending plan drafts when a note is retracted", () => {
    // Otherwise a note you no longer trust can still become the plan an hour
    // from now: the proposals outlive the evidence they were built on.
    const id = insertNote(seed.accountId, "accepted");
    createProposalBatch(seed.accountId, { kind: "plan_draft", id: null, aiRunId: null }, [
      {
        entity_type: "play",
        op: "create",
        payload: { title: "From the research", status: "proposed" },
        rationale: null,
        source_ref: null,
      },
    ]);
    const pending = () => (db().prepare(`SELECT COUNT(*) AS n FROM proposals WHERE account_id = ? AND status = 'pending'`).get(seed.accountId) as { n: number }).n;
    expect(pending()).toBe(1);
    archiveDocument(id, USER);
    expect(pending()).toBe(0);
  });
});

describe("accepting a note", () => {
  it("keeps only the ticked findings, without losing the rest", () => {
    const id = insertNote(seed.accountId, "draft");
    acceptNote(id, [0], USER);
    const prompt = researchForPrompt(seed.accountId);
    expect(prompt).toContain("A capital plan runs to 2029.");
    expect(prompt).not.toContain("A new CIO started in May.");
    // The model's original answer survives, so an untick can be undone.
    const meta = JSON.parse((getDocument(id) as DocumentRow).meta_json!) as {
      findings: unknown[];
    };
    expect(meta.findings).toHaveLength(2);
    acceptNote(id, [0, 1], USER);
    expect(researchForPrompt(seed.accountId)).toContain("A new CIO started in May.");
  });

  it("tells two findings on the same page apart", () => {
    // One article can support two facts. Keeping findings by URL meant one
    // tick governed both, so unticking either silently dropped the other.
    const id = newId();
    const one = (text: string) => ({
      text,
      quote: text,
      url: URL_A,
      confidence: "high",
      date: null,
      topic: "strategy",
    });
    db()
      .prepare(
        `INSERT INTO documents (id, account_id, kind, filename, byte_size, content_text, meta_json, status, created_by, created_at)
         VALUES (?, ?, 'research_note', 'research.md', 10, 'prose', ?, 'draft', ?, ?)`,
      )
      .run(
        id,
        seed.accountId,
        JSON.stringify({
          title: "One page, two facts",
          summary: "",
          findings: [one("They opened a second site."), one("They named a new CIO.")],
          open_questions: [],
          focus: null,
          depth: "standard",
          generated_at: "2026-09-12",
          searches: 1,
          fetches: 1,
          dropped: [],
        }),
        USER,
        Date.now(),
      );
    acceptNote(id, [1], USER);
    const prompt = researchForPrompt(seed.accountId);
    expect(prompt).toContain("They named a new CIO.");
    expect(prompt).not.toContain("They opened a second site.");
  });

  it("refuses to accept an archived note", () => {
    const id = insertNote(seed.accountId, "draft");
    archiveDocument(id, USER);
    expect(() => acceptNote(id, [0], USER)).toThrow(/archived/);
  });
});

describe("documents saved in the same millisecond", () => {
  // Notes saved back to back share a created_at on a fast machine; the one
  // saved last is still the latest, or the research panel reads an older note.
  it("list the one saved last first", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const first = insertNote(seed.accountId, "accepted");
      const second = insertNote(seed.accountId, "accepted");
      expect(listDocuments(seed.accountId, { kinds: ["research_note"] }).map((d) => d.id)).toEqual([second, first]);
      archiveDocument(first, USER);
      archiveDocument(second, USER);
      expect(listArchivedDocuments(seed.accountId, ["research_note"]).map((d) => d.id)).toEqual([second, first]);
    } finally {
      vi.useRealTimers();
    }
  });
});
