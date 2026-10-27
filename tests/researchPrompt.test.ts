// Synthetic accounts, findings and roles only.
import { expect, it } from "vitest";
import { seedAccount, USER } from "./helpers";
import { acceptNote, researchForPrompt, researchSelection, storeDraftNote } from "@/lib/research/notes";
import type { ResearchFinding } from "@/lib/research/schema";

const finding = (i: number, over: Partial<ResearchFinding> = {}): ResearchFinding => ({ text: `Synthetic statement ${i}.`, quote: `Synthetic quote number ${i}.`, url: `https://example.test/page/${i}`, date: "2026-09-01", confidence: "medium", topic: "technology", ...over });

function note(findings: ResearchFinding[], extra: Record<string, unknown> = {}) {
  const { accountId } = seedAccount();
  const doc = storeDraftNote({ accountId, userId: USER, aiRunId: "synthetic", note: { title: "Synthetic", summary: "S.", open_questions: [], findings, ...extra }, prose: "P", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });
  acceptNote(doc.id, findings.map((_, i) => i), USER);
  return { accountId, noteId: doc.id };
}

it("tells briefs, plans and Ask the earlier read, the date, the entity and the guesses, each for what it is", () => {
  const { accountId, noteId } = note([finding(0), finding(1, { date: null, page_age: "3 days ago" })], {
    reads: { "0": { signal: "compelling_event", owner: "the CIO", fits: ["Synthetic agents"], so_what: "It funds the work." } },
    entity: { name: "Synthetic Org", domain: "synthetic.example", ticker: null, parent: null, hq: null, url: null },
    buying_group: [{ role: "Synthetic CFO", likely: "blocker", basis: "Likely guards the budget.", question: "What would the CFO need to see?" }],
  });
  const text = researchForPrompt(accountId);
  expect(text).toContain(`[${noteId}#0]`);
  expect(text).toContain("Earlier read (model's, not verified): compelling event, owned by the CIO; touches Synthetic agents; so what: It funds the work.");
  expect(text).toContain("Published: 2026-09-01");
  expect(text).toContain("Published: 3 days ago (search index)");
  expect(text).toContain("Researched as: Synthetic Org · synthetic.example");
  expect(text).toContain("HYPOTHESES ONLY");
  expect(text).toContain("- Synthetic CFO (blocker): Likely guards the budget. Ask: What would the CFO need to see?");
  // Wrapped as untrusted, like every other piece of research.
  expect(text.match(/<untrusted_source/g)?.length).toBe(4);
  // A guess is never something the model may cite.
  expect(researchSelection(accountId).included.map((e) => e.id)).toEqual([`${noteId}#0`, `${noteId}#1`]);
});

it("keeps a reason to act among what is sent when there is more than fits", () => {
  const findings = Array.from({ length: 30 }, (_, i) => finding(i));
  const { accountId, noteId } = note(findings, { reads: { "29": { signal: "compelling_event", owner: null, fits: [], so_what: null } } });
  const ids = researchSelection(accountId).included.map((e) => e.id);
  expect(ids).toHaveLength(24);
  expect(ids).toContain(`${noteId}#29`);
});
