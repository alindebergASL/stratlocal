// SYNTHETIC ONLY. Permanent regressions for Ask's read/write boundary.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyEntityChange, acceptProposal } from "@/lib/proposals/apply";
import { CitableSet, runReadTool, type ToolContext } from "@/lib/ask/tools";
import { proposeChanges } from "@/lib/ask/propose";
import { createReport, getReport } from "@/lib/ask/report";
import { createThread } from "@/lib/ask/threads";
import { mergeAccounts } from "@/lib/proposals/mergeAccount";
import { moveToAccount } from "@/lib/proposals/move";
import { AskReadState } from "@/lib/ask/writeContext";
import { seedAccount, USER } from "./helpers";

function context(accountId: string | null): ToolContext {
  const thread = createThread({ accountId, question: "Synthetic safety question", saved: true, userId: USER });
  const ctx: ToolContext = { userId: USER, now: new Date(), cites: new CitableSet(), threadId: thread.id, accountId, runId: null, batches: [] };
  ctx.readState = new AskReadState(ctx);
  return ctx;
}

it("must conflict rather than accept an Ask update based on a pre-edit tool read", () => {
  const seed = seedAccount();
  const ctx = context(seed.accountId);
  runReadTool("account", { account_id: seed.accountId }, ctx); // model saw stage 3
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload: { stage: 6 }, actorUserId: USER });
  const result = proposeChanges({ account_id: seed.accountId, changes: [{ record: "deal", op: "update", id: seed.dealId, fields: { stage: 4 }, why: "Synthetic stale suggestion" }] }, ctx);
  const proposal = db().prepare("SELECT id, before_json FROM proposals WHERE batch_id = ?").get(result.batch!.batchId) as { id: string; before_json: string };
  const decision = acceptProposal(proposal.id, USER);
  expect(decision.status).toBe("conflict");
  expect(JSON.parse(proposal.before_json)).toEqual({ stage: 3 });
  expect(db().prepare("SELECT stage FROM deals WHERE deal_id = ?").get(seed.dealId)).toEqual({ stage: 6 });
});

it("must refuse an in-flight report filed on the merged-away account", () => {
  const keep = seedAccount();
  const lose = seedAccount({ name: "Synthetic Inflight Source", dealId: "SYN-SECOND" });
  const ctx = context(lose.accountId);
  runReadTool("account", { account_id: lose.accountId }, ctx); // tool context before await
  mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });
  const before = db().prepare("SELECT COUNT(*) AS n FROM documents").get();
  expect(() => createReport({ title: "Synthetic late report", account_id: lose.accountId, sections: [{ heading: "Snapshot", body: "A deal [1]." }], citations: [{ n: 1, kind: "deal", id: lose.dealId }] }, ctx)).toThrow();
  expect(db().prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual(before);
  expect(ctx.reportDocId).toBeUndefined();
});

const proposals = () => db().prepare("SELECT * FROM proposals ORDER BY id").all();
const documents = () => db().prepare("SELECT * FROM documents ORDER BY id").all();
const draft = (id: string, fields: Record<string, unknown> = { stage: 4 }) => ({ record: "deal", op: "update", id, fields, why: "Synthetic suggested change" });
const newContact = { record: "contact", op: "create", fields: { name: "Synthetic New Person" }, why: "Synthetic requested addition" };
const report = (accountId?: string, dealId?: string) => ({
  title: "Synthetic snapshot", account_id: accountId,
  sections: [{ heading: "Snapshot", body: dealId ? "A deal [1]." : "Synthetic summary." }],
  citations: dealId ? [{ n: 1, kind: "deal", id: dealId }] : [],
});
const filedProposal = (ctx: ToolContext, accountId: string, changes: unknown[]) => {
  const out = proposeChanges({ account_id: accountId, changes }, ctx);
  return db().prepare("SELECT id, before_json FROM proposals WHERE batch_id = ?").get(out.batch!.batchId) as { id: string; before_json: string };
};

it.each(["pipeline", "search", "what_moved", "activity"] as const)("%s preserves a broad tool's first-read deal baseline", (tool) => {
  const seed = seedAccount();
  const ctx = context(null);
  runReadTool(tool, tool === "search" ? { query: "EHR" } : {}, ctx);
  expect(ctx.cites.get("deal", seed.dealId)).toBeDefined();
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload: { stage: 6 }, actorUserId: USER });
  const p = filedProposal(ctx, seed.accountId, [draft(seed.dealId)]);
  expect(JSON.parse(p.before_json)).toEqual({ stage: 3 });
  expect(acceptProposal(p.id, USER).status).toBe("conflict");
});

it("accounts and follow_ups preserve account and action-item baselines", () => {
  const seed = seedAccount();
  const item = applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic follow-up", due: "2026-11-01" }, actorUserId: USER }).entityId;
  const ctx = context(null);
  runReadTool("accounts", {}, ctx);
  runReadTool("follow_ups", {}, ctx);
  applyEntityChange({ accountId: seed.accountId, entityType: "account", op: "update", entityId: seed.accountId, payload: { region: "West" }, actorUserId: USER });
  applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "update", entityId: item, payload: { due: "2026-11-02" }, actorUserId: USER });
  proposeChanges({ account_id: seed.accountId, changes: [
    { record: "account", op: "update", fields: { region: "East" }, why: "Synthetic region update" },
    { record: "action_item", op: "update", id: item, fields: { due: "2026-11-03" }, why: "Synthetic due-date update" },
  ] }, ctx);
  const rows = db().prepare("SELECT id, entity_type, before_json FROM proposals").all() as Array<{ id: string; entity_type: string; before_json: string }>;
  expect(rows).toHaveLength(2);
  for (const p of rows) {
    expect(JSON.parse(p.before_json)).toEqual(p.entity_type === "account" ? { region: "Central" } : { due: "2026-11-01" });
    expect(acceptProposal(p.id, USER).status).toBe("conflict");
  }
});

it.each(["contact", "play"] as const)("account reads retain the %s baseline, including null fields", (record) => {
  const seed = seedAccount();
  const id = record === "contact" ? seed.contactId : seed.playId;
  const ctx = context(seed.accountId);
  runReadTool("account", { account_id: seed.accountId }, ctx);
  applyEntityChange({ accountId: seed.accountId, entityType: record, op: "update", entityId: id, payload: { title: "Synthetic human title" }, actorUserId: USER });
  const p = filedProposal(ctx, seed.accountId, [{ record, op: "update", id, fields: { title: "Synthetic suggested title" }, why: "Synthetic suggestion" }]);
  expect(JSON.parse(p.before_json)).toEqual({ title: record === "contact" ? null : "EHR platform defense" });
  expect(acceptProposal(p.id, USER).status).toBe("conflict");
});

it("repeated and broader reads cannot refresh first-read fields; new records use their own read time", () => {
  const seed = seedAccount();
  const ctx = context(seed.accountId);
  runReadTool("pipeline", {}, ctx);
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload: { stage: 6, next_step: "Synthetic human step" }, actorUserId: USER });
  applyEntityChange({ accountId: seed.accountId, entityType: "contact", op: "update", entityId: seed.contactId, payload: { title: "Synthetic read-time title" }, actorUserId: USER });
  runReadTool("account", { account_id: seed.accountId }, ctx);
  runReadTool("pipeline", {}, ctx);
  // A caller cannot mutate the retained snapshot via values().
  ctx.readState!.values("deal", seed.dealId, ["stage"]).stage = 6;
  proposeChanges({ account_id: seed.accountId, changes: [draft(seed.dealId, { stage: 4, next_step: "Synthetic suggested step" }),
    { record: "contact", op: "update", id: seed.contactId, fields: { title: "Synthetic proposed title" }, why: "Synthetic proposal" },
  ] }, ctx);
  const rows = db().prepare("SELECT id, entity_type, before_json FROM proposals").all() as Array<{ id: string; entity_type: string; before_json: string }>;
  expect(rows).toHaveLength(2);
  for (const p of rows) {
    expect(JSON.parse(p.before_json)).toEqual(p.entity_type === "deal" ? { stage: 3, next_step: null } : { title: "Synthetic read-time title" });
    expect(acceptProposal(p.id, USER).status).toBe(p.entity_type === "deal" ? "conflict" : "accepted");
  }
});

it("unchanged touched fields accept despite an unrelated human edit; unchanged reports still save", () => {
  const seed = seedAccount();
  const ctx = context(seed.accountId);
  runReadTool("account", { account_id: seed.accountId }, ctx);
  applyEntityChange({ accountId: seed.accountId, entityType: "deal", op: "update", entityId: seed.dealId, payload: { notes: "Synthetic later human note" }, actorUserId: USER });
  const p = filedProposal(ctx, seed.accountId, [draft(seed.dealId)]);
  expect(acceptProposal(p.id, USER).status).toBe("accepted");
  expect(db().prepare("SELECT stage, notes FROM deals WHERE deal_id = ?").get(seed.dealId)).toEqual({ stage: 4, notes: "Synthetic later human note" });
  expect(getReport(createReport(report(seed.accountId, seed.dealId), ctx).docId)?.doc.account_id).toBe(seed.accountId);
});

it("a missing record/field baseline fails closed without a partially filed batch", () => {
  const seed = seedAccount();
  const ctx = context(seed.accountId);
  runReadTool("accounts", {}, ctx); // account shown, but no deal snapshot
  ctx.cites.add({ kind: "deal", id: seed.dealId, accountId: seed.accountId, label: "Synthetic citation without read snapshot" });
  const before = proposals();
  expect(() => proposeChanges({ account_id: seed.accountId, changes: [newContact, draft(seed.dealId)] }, ctx)).toThrow(/baseline unavailable/);
  // Even a no-op update must not bypass the missing-baseline check.
  expect(() => proposeChanges({ account_id: seed.accountId, changes: [newContact, draft(seed.dealId, { stage: 3 })] }, ctx)).toThrow(/baseline unavailable/);
  expect(() => ctx.readState!.values("account", seed.accountId, ["not_captured"])).toThrow(/baseline unavailable/);
  expect(proposals()).toEqual(before);
  expect(ctx.batches).toEqual([]);
});

it("an absent read state cannot fall back to filing-time values", () => {
  const seed = seedAccount();
  const ctx = context(seed.accountId);
  runReadTool("account", { account_id: seed.accountId }, ctx);
  ctx.readState = undefined;
  const before = proposals();
  expect(() => proposeChanges({ account_id: seed.accountId, changes: [newContact, draft(seed.dealId)] }, ctx)).toThrow(/context changed or is unavailable/);
  expect(proposals()).toEqual(before);
  expect(ctx.batches).toEqual([]);
});

it.each(["account archived", "thread moved", "thread unscoped", "thread archived", "thread deleted", "deal moved", "deal archived", "thread round trip", "deal round trip"])("rejects both write tools atomically when %s", (change) => {
  const from = seedAccount();
  const to = seedAccount({ name: "Synthetic Destination", dealId: "SYN-DEST" });
  const ctx = context(from.accountId);
  runReadTool("account", { account_id: from.accountId }, ctx);
  if (change === "account archived") db().prepare("UPDATE accounts SET archived_at = '2026-10-01' WHERE id = ?").run(from.accountId);
  if (change === "thread unscoped") db().prepare("UPDATE ask_threads SET account_id = NULL WHERE id = ?").run(ctx.threadId);
  if (change === "thread archived") db().prepare("UPDATE ask_threads SET archived_at = '2026-10-01' WHERE id = ?").run(ctx.threadId);
  if (change === "thread deleted") db().prepare("DELETE FROM ask_threads WHERE id = ?").run(ctx.threadId);
  if (change === "deal archived") db().prepare("UPDATE deals SET archived_at = '2026-10-01' WHERE deal_id = ?").run(from.dealId);
  if (["thread moved", "deal moved", "thread round trip", "deal round trip"].includes(change)) {
    const entity = change.startsWith("thread") ? "ask_thread" : "deal";
    const id = entity === "ask_thread" ? ctx.threadId : from.dealId;
    moveToAccount({ entity, id, from: from.accountId, to: to.accountId, actorUserId: USER });
    if (change.endsWith("round trip")) moveToAccount({ entity, id, from: to.accountId, to: from.accountId, actorUserId: USER });
    // Later reads must not launder changed ownership into the old turn.
    runReadTool("pipeline", {}, ctx);
  }
  const beforeProposals = proposals();
  const beforeDocuments = documents();
  expect(() => proposeChanges({ account_id: from.accountId, changes: [newContact, draft(from.dealId)] }, ctx)).toThrow(/context changed/);
  expect(() => createReport(report(from.accountId, from.dealId), ctx)).toThrow(/context changed/);
  expect(() => createReport(report(), ctx)).toThrow(/context changed/);
  expect(proposals()).toEqual(beforeProposals);
  expect(documents()).toEqual(beforeDocuments);
  expect(ctx.batches).toEqual([]);
  expect(ctx.reportDocId).toBeUndefined();
});

it.each(["old account", "keeper", "own work"])("a global turn cannot file old merged context under %s", (destination) => {
  const keep = seedAccount();
  const lose = seedAccount({ name: "Synthetic Source", dealId: "SYN-SOURCE" });
  const ctx = context(null);
  runReadTool("pipeline", {}, ctx);
  mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });
  runReadTool("account", { account_id: keep.accountId }, ctx);
  const target = destination === "old account" ? lose.accountId : destination === "keeper" ? keep.accountId : undefined;
  const beforeDocuments = documents();
  const beforeProposals = proposals();
  expect(() => createReport(report(target, lose.dealId), ctx)).toThrow();
  expect(() => proposeChanges({ account_id: target ?? keep.accountId, changes: [newContact] }, ctx)).toThrow();
  expect(documents()).toEqual(beforeDocuments);
  expect(proposals()).toEqual(beforeProposals);
  expect(ctx.batches).toEqual([]);
  expect(ctx.reportDocId).toBeUndefined();
});

it("checks thread ownership established before the first read and does not accept explicit retargeting", () => {
  const from = seedAccount();
  const to = seedAccount({ name: "Synthetic Destination", dealId: "SYN-DEST" });
  const ctx = context(from.accountId);
  moveToAccount({ entity: "ask_thread", id: ctx.threadId, from: from.accountId, to: to.accountId, actorUserId: USER });
  ctx.accountId = to.accountId;
  runReadTool("account", { account_id: to.accountId }, ctx);
  expect(() => createReport(report(to.accountId, to.dealId), ctx)).toThrow(/context changed/);
  expect(() => proposeChanges({ account_id: to.accountId, changes: [newContact] }, ctx)).toThrow(/context changed/);
  expect(documents()).toEqual([]);
  expect(proposals()).toEqual([]);
});

it("unchanged global context supports cross-account proposals and a report under Own work", () => {
  const first = seedAccount();
  const second = seedAccount({ name: "Synthetic Second", dealId: "SYN-SECOND" });
  const ctx = context(null);
  runReadTool("pipeline", {}, ctx);
  for (const seed of [first, second]) {
    const p = filedProposal(ctx, seed.accountId, [draft(seed.dealId)]);
    expect(acceptProposal(p.id, USER).status).toBe("accepted");
  }
  const saved = getReport(createReport(report(undefined, second.dealId), ctx).docId)!;
  expect(db().prepare("SELECT kind FROM accounts WHERE id = ?").get(saved.doc.account_id)).toEqual({ kind: "own_work" });
  expect(saved.report.threadId).toBe(ctx.threadId);
  expect(ctx.batches).toHaveLength(2);
});
