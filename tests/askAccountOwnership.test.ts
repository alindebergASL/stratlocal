// SYNTHETIC ONLY. Conversations follow account merges; reports stay snapshots.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { addMessage, archiveThread, createThread, getThread, listMessages, listThreads } from "@/lib/ask/threads";
import { getReport, storeReport } from "@/lib/ask/report";
import { resolveSources } from "@/lib/ask/sources";
import { mergeAccounts, previewAccountMerge, unmergeAccount } from "@/lib/proposals/mergeAccount";
import { moveToAccount } from "@/lib/proposals/move";
import { seedAccount, USER } from "./helpers";

it("moves account conversations with their reports, and undo restores ownership without rewriting snapshots or later messages", () => {
  const keep = seedAccount();
  const lose = seedAccount({ name: "Synthetic Ask Source", dealId: "SYN-SECOND" });
  const thread = createThread({ accountId: lose.accountId, question: "Synthetic report?", saved: true, userId: USER });
  const temporary = createThread({ accountId: lose.accountId, question: "Synthetic temporary?", saved: false, userId: USER });
  const archived = createThread({ accountId: lose.accountId, question: "Synthetic archived?", saved: true, userId: USER });
  archiveThread(archived.id);
  const global = createThread({ accountId: null, question: "Synthetic portfolio?", saved: true, userId: USER });
  const citation = { n: 1, kind: "deal", id: lose.dealId, accountId: lose.accountId, label: "Synthetic deal snapshot" };
  const stored = storeReport({ accountId: lose.accountId, userId: USER, report: {
    title: "Synthetic report", summary: null, sections: [{ heading: "Snapshot", body: "A deal [1]." }], citations: [citation], threadId: thread.id,
  } });
  addMessage({ threadId: thread.id, role: "assistant", text: "A deal [1].", citations: [citation], reportDocId: stored.doc.id, userId: null });
  const messagesBefore = listMessages(thread.id);
  const preview = previewAccountMerge(keep.accountId, lose.accountId);
  const { receiptId } = mergeAccounts({ keeperId: keep.accountId, loserId: lose.accountId, actorUserId: USER });
  expect(getThread(thread.id)?.accountId).toBe(keep.accountId);
  expect(preview).toMatchObject({ ok: true, counts: expect.arrayContaining([{ entity: "ask_thread", n: 3, noun: "conversations" }]) });
  expect(getThread(temporary.id)).toMatchObject({ accountId: keep.accountId, saved: false });
  expect(db().prepare("SELECT account_id FROM ask_threads WHERE id = ?").get(archived.id)).toEqual({ account_id: keep.accountId });
  expect(getThread(archived.id)).toBeNull();
  expect(getThread(global.id)?.accountId).toBeNull();
  expect(listThreads({ accountId: keep.accountId }).map((t) => t.id)).toContain(thread.id);
  expect(listThreads({ accountId: lose.accountId })).toEqual([]);
  expect(getReport(stored.doc.id)).toMatchObject({ doc: { account_id: keep.accountId, meta_json: stored.doc.meta_json }, report: stored.report });
  expect(listMessages(thread.id)).toEqual(messagesBefore);
  // Old citation scope is not silently retargeted to another customer's data.
  expect(resolveSources([citation])[0]).toMatchObject({ href: null });
  const later = addMessage({ threadId: thread.id, role: "user", text: "Synthetic later question", userId: USER });
  const newThread = createThread({ accountId: keep.accountId, question: "Synthetic new conversation?", saved: true, userId: USER });
  unmergeAccount({ keeperId: keep.accountId, receiptId, actorUserId: USER });
  expect(getThread(thread.id)?.accountId).toBe(lose.accountId);
  expect(getThread(temporary.id)?.accountId).toBe(lose.accountId);
  expect(getThread(newThread.id)?.accountId).toBe(keep.accountId);
  expect(getReport(stored.doc.id)).toMatchObject({ doc: { account_id: lose.accountId, meta_json: stored.doc.meta_json }, report: stored.report });
  expect(listMessages(thread.id)).toEqual([...messagesBefore, later]);
  expect(resolveSources([citation])[0]?.href).toBe(`/accounts/${lose.accountId}/deals/${lose.dealId}`);
  const history = db().prepare("SELECT account_id, actor_user_id FROM change_log WHERE entity_type = 'ask_thread' AND entity_id = ? AND field = 'account_id'").all(thread.id);
  expect(history).toHaveLength(4);
  expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ account_id: keep.accountId, actor_user_id: USER }), expect.objectContaining({ account_id: lose.accountId, actor_user_id: USER })]));
});

it("moving a report alone preserves its snapshot and originating conversation", () => {
  const from = seedAccount();
  const to = seedAccount({ name: "Synthetic Report Destination", dealId: "SYN-SECOND" });
  const thread = createThread({ accountId: from.accountId, question: "Synthetic report?", saved: true, userId: USER });
  const stored = storeReport({ accountId: from.accountId, userId: USER, report: { title: "Synthetic snapshot", summary: null, sections: [{ heading: "Snapshot", body: "Synthetic text." }], citations: [], threadId: thread.id } });
  moveToAccount({ entity: "document", id: stored.doc.id, from: from.accountId, to: to.accountId, actorUserId: USER });
  expect(getReport(stored.doc.id)).toMatchObject({ doc: { account_id: to.accountId, meta_json: stored.doc.meta_json }, report: { threadId: thread.id, accountName: stored.report.accountName } });
  expect(getThread(thread.id)?.accountId).toBe(from.accountId);
});
