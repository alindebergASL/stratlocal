// Synthetic accounts and findings only.
import { expect, it } from "vitest";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { acceptNote, dropKeptFinding, listNotes, markStillTrue, storeDraftNote } from "@/lib/research/notes";
import { briefItemsOf } from "@/lib/research/brief";
import { stillTrue } from "@/lib/research/current";
import { nextToWatch, setWatched } from "@/lib/assistants/accountWatch";
import { keptFindings, type ResearchFinding } from "@/lib/research/schema";

const f = (i: number, date: string | null): ResearchFinding => ({ text: `Synthetic finding ${i}.`, quote: "Synthetic quote here.", url: `https://example.test/${i}`, confidence: "medium", date, topic: "strategy" });

function note(accountId: string) {
  const doc = storeDraftNote({
    accountId, userId: USER, aiRunId: "synthetic", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [], prose: "P",
    note: { title: "T", summary: "S", open_questions: [], findings: [f(0, "2023-05-01"), f(1, "2026-10-01"), f(2, "2026-06-01"), f(3, "2026-09-01")], reads: { "2": { signal: "compelling_event", owner: null, fits: [], so_what: null } } },
  });
  acceptNote(doc.id, [0, 1, 2, 3], USER);
  return doc.id;
}
const items = (accountId: string) => {
  const notes = listNotes(accountId, "accepted");
  const checked = new Map(notes.map((n) => [n.doc.id, n.meta.checked_at ?? {}]));
  return briefItemsOf(notes).map((k) => ({ ...k, checkedAt: checked.get(k.noteId)?.[String(k.index)] ?? null }));
};

it("asks whether old findings and passed events are still true, and remembers the answer", () => {
  const { accountId } = seedAccount();
  const noteId = note(accountId);
  const asked = stillTrue(items(accountId), "2026-10-22");
  expect(asked.map((r) => [r.item.index, r.why])).toEqual([[0, "3 years old"], [2, "its date, 2026-06-01, has passed"]]);

  markStillTrue(noteId, 0, USER);
  expect(stillTrue(items(accountId), "2026-10-22").map((r) => r.item.index)).toEqual([2]);
  // Six months on, it is asked again.
  expect(stillTrue(items(accountId), "2026-10-22", Date.now() + 200 * 86400000).map((r) => r.item.index)).toEqual([0, 2]);

  const acceptedAt = listNotes(accountId, "accepted")[0]!.meta.accepted_at;
  dropKeptFinding(noteId, 2, USER);
  const after = listNotes(accountId, "accepted")[0]!;
  expect(keptFindings(after.meta).map((x) => x.text)).toEqual(["Synthetic finding 0.", "Synthetic finding 1.", "Synthetic finding 3."]);
  expect(after.meta.findings).toHaveLength(4);
  // Not a new review of the whole note: the others do not turn up as new.
  expect(after.meta.accepted_at).toBe(acceptedAt);
  expect(() => dropKeptFinding(noteId, 2, USER)).toThrow(/no longer kept/);
});

it("on the clock, Account watch passes over an account researched by hand this month", () => {
  const { accountId } = seedAccount({ name: "Synthetic Watched", dealId: "SYN-W-1" });
  setWatched(accountId, true, USER);
  expect(nextToWatch(Date.now())?.id).toBe(accountId);
  const run = "synthetic-hand-run";
  db().prepare("INSERT INTO ai_runs (id, account_id, kind, provider, model, status, started_at) VALUES (?, ?, 'research', 'anthropic', 'm', 'done', ?)").run(run, accountId, Date.now());
  const doc = storeDraftNote({ accountId, userId: USER, aiRunId: run, focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [], prose: "P", note: { title: "T", summary: "S", open_questions: [], findings: [f(9, "2026-10-01")] } });
  acceptNote(doc.id, [0], USER);
  expect(nextToWatch(Date.now())).toBeNull();
  // Pressed by hand, it still looks.
  expect(nextToWatch(Date.now(), true)?.id).toBe(accountId);
});
