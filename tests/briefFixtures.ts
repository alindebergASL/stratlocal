// SYNTHETIC ONLY: an accepted research note, for the brief tests.
//
// In its own file rather than exported from a test file: importing a helper
// out of a *.test.ts runs that file's suites again inside the importer.
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { acceptNote } from "@/lib/research/notes";
import { USER } from "./helpers";

export function insertResearchNote(accountId: string, opts: { sourceExcerpt?: boolean; accepted?: number[] } = {}): string {
  const id = newId();
  const finding = (text: string) => ({
    text,
    quote: text,
    url: "https://www.example.com/a",
    confidence: "high",
    date: "2026-08-01",
    topic: "strategy",
    ...(opts.sourceExcerpt ? { evidence: { kind: "source_excerpt", text, location: "page 4" } } : {}),
  });
  const meta = {
    title: "Synthetic Orchard: public signals",
    summary: "What is published about them.",
    findings: [finding("A capital plan runs to 2029."), finding("A new CIO started in May.")],
    open_questions: [],
    focus: null,
    depth: "standard",
    generated_at: "2026-09-12",
    searches: 3,
    fetches: 1,
    dropped: [],
    sources: ["https://www.example.com/a"],
  };
  db()
    .prepare(
      `INSERT INTO documents (id, account_id, kind, filename, byte_size, content_text, meta_json, status, created_by, created_at)
       VALUES (?, ?, 'research_note', 'research.md', 10, 'prose', ?, 'draft', ?, ?)`,
    )
    .run(id, accountId, JSON.stringify(meta), USER, Date.now());
  acceptNote(id, opts.accepted ?? [0, 1], USER);
  return id;
}

// Twenty-five distinct retained statements plus a duplicate-text finding at
// a different exact index/date. Prompt selection must still cap/deduplicate.
export function insertLargeResearchNote(accountId: string): string {
  const id = insertResearchNote(accountId, { sourceExcerpt: true });
  const row = db().prepare("SELECT meta_json FROM documents WHERE id = ?").get(id) as { meta_json: string };
  const meta = JSON.parse(row.meta_json);
  meta.findings = Array.from({ length: 26 }, (_, i) => ({
    ...meta.findings[0],
    text: `Synthetic retained statement ${i === 25 ? 0 : i}.`,
    date: i === 25 ? "2026-07-25" : "2026-07-24",
  }));
  meta.accepted_finding_indexes = meta.findings.map((_: unknown, i: number) => i);
  db().prepare("UPDATE documents SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), id);
  return id;
}
