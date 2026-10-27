// Synthetic accounts and findings only.
import { expect, it } from "vitest";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { acceptNote, storeDraftNote } from "@/lib/research/notes";
import { reasonsKeptThisWeek } from "@/lib/queries/needsALook";
import { fridayQuestion } from "@/lib/assistants/fridayReview";

function keep(accountId: string, signal: "compelling_event" | "trigger" | null, date: string) {
  const doc = storeDraftNote({
    accountId, userId: USER, aiRunId: "synthetic", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [], prose: "P",
    note: { title: "T", summary: "S", open_questions: [], findings: [{ text: `Synthetic ${signal ?? "plain"} ${date}.`, quote: "Synthetic quote here.", url: "https://example.test/x", confidence: "high", date, topic: "risk" }], ...(signal ? { reads: { "0": { signal, owner: null, fits: [], so_what: null } } } : {}) },
  });
  acceptNote(doc.id, [0], USER);
  return doc.id;
}

it("names the reasons to act kept this week, compelling events first, and not older ones", () => {
  const a = seedAccount({ name: "Synthetic Trigger Co", dealId: "SYN-FR-1" });
  const b = seedAccount({ name: "Synthetic Event Co", dealId: "SYN-FR-2" });
  const c = seedAccount({ name: "Synthetic Old Co", dealId: "SYN-FR-3" });
  keep(a.accountId, "trigger", "2026-10-15");
  keep(b.accountId, "compelling_event", "2026-11-30");
  keep(a.accountId, null, "2026-10-16");
  const old = keep(c.accountId, "compelling_event", "2026-10-01");
  // Kept a fortnight ago: not this week's news.
  const meta = JSON.parse((db().prepare("SELECT meta_json FROM documents WHERE id = ?").get(old) as { meta_json: string }).meta_json);
  db().prepare("UPDATE documents SET meta_json = ? WHERE id = ?").run(JSON.stringify({ ...meta, accepted_at: new Date(Date.now() - 14 * 86400000).toISOString() }), old);

  const reasons = reasonsKeptThisWeek(USER);
  expect(reasons.map((r) => [r.accountName, r.kind])).toEqual([["Synthetic Event Co", "compelling_event"], ["Synthetic Trigger Co", "trigger"]]);
  const q = fridayQuestion([], 0, reasons);
  expect(q).toContain("No deal matched the look rule this week.");
  expect(q).toContain(`- Synthetic Event Co (account_id ${b.accountId}): compelling event, 2026-11-30: Synthetic compelling_event 2026-11-30.`);
});
