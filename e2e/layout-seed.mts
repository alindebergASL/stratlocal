// This helper is deliberately restricted to the runner's disposable database.
if (!process.env.DB_PATH?.includes("strategy-e2e-")) throw Error("Disposable e2e DB required");
// Keep the receipt channel machine-readable; database startup diagnostics use stderr.
console.log = (...args: unknown[]) => console.error(...args);
const { db } = await import("../lib/db");
const { layoutFixture } = await import("../tests/layoutFixtures");
const user = db().prepare("SELECT id FROM users WHERE email=?").get(process.env.E2E_USER1_EMAIL) as { id: string } | undefined;
if (!user) throw Error("Synthetic runner user required");
const fixture = layoutFixture(user.id);
const { storeDraftNote, acceptNote } = await import("../lib/research/notes");
const otherNoteIds: string[] = [];
for (let note = 1; note <= 2; note++) {
  const rows = Array.from({ length: 7 }, (_, i) => ({ text: `Synthetic reading note ${note}, finding ${i}. ` + "The planning record describes an option, not an independently verified outcome. ".repeat(3) + `Reading ending ${note}-${i}.`, quote: "Synthetic generated report quotation.", url: `https://example.test/reading/${note}/${i}`, date: "2026-09-01", confidence: "medium" as const, topic: "technology" as const }));
  const doc = storeDraftNote({ accountId: fixture.accountId, userId: user.id, aiRunId: `synthetic-reading-${note}`, note: { title: `Synthetic planning note ${note}`, summary: "Original unreviewed synthetic model summary.", open_questions: [], findings: rows }, prose: "Full original synthetic planning report.", capture: { status: "partial", reasons: ["max_tokens"] }, focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });
  acceptNote(doc.id, [1, 2, 3, 4, 5, 6], user.id);
  otherNoteIds.push(doc.id);
}
const findings = Array.from({ length: 105 }, (_, i) => ({ text: `Synthetic retained finding ${i}. ` + "Complete supporting detail for the synthetic planning record. ".repeat(8) + `Full ending ${i}.`, quote: "Synthetic supporting quotation.", url: `https://example.test/research/${i}`, date: "2026-09-02", confidence: "low" as const, topic: i < 35 ? "technology" as const : i < 70 ? "strategy" as const : "leadership" as const }));
const retained = storeDraftNote({ accountId: fixture.accountId, userId: user.id, aiRunId: "synthetic-overview-run", note: { title: "Synthetic retained dossier", summary: "Synthetic model summary.", open_questions: [], findings }, prose: "Complete synthetic research report.", focus: null, depth: "standard", searches: 0, fetches: 0, dropped: [] });
acceptNote(retained.id, findings.map((_, i) => i).filter(i => ![0, 35, 70].includes(i)), user.id);
// storeDraftNote archives older drafts; restore this fixture's review queue.
db().prepare("UPDATE documents SET archived_at=NULL WHERE id=?").run(fixture.noteId);
// Creating later drafts archives the original draft and rejects pending plan batches
// (lib/documents.ts). Seed a current plan after research, never revive stale proposals.
const { createProposalBatch, applyEntityChange } = await import("../lib/proposals/apply");
applyEntityChange({ accountId: fixture.accountId, entityType: "deal", op: "create", actorUserId: user.id, payload: { name: "Synthetic planning opportunity with a preserved title", stage: 2, tcv_usd: 42000, close_date: "2030-11-21", status: "open" } });
const planBatch = createProposalBatch(fixture.accountId, { kind: "plan_draft", id: null, aiRunId: null }, [{ entity_type: "account", op: "update", entity_id: fixture.accountId, payload: { thesis: "Synthetic current proposed plan thesis" } }]);
if (planBatch.ids.length !== 1) throw Error("Current pending plan fixture missing");
process.stdout.write(JSON.stringify({ ...fixture, planBatch, retainedNoteId: retained.id, otherNoteIds }));
