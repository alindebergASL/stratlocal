// Synthetic, in-memory records only; no model or network calls.
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { CitableSet, runReadTool, type ToolContext } from "@/lib/ask/tools";
import { createThread } from "@/lib/ask/threads";
import { createReport, getReport } from "@/lib/ask/report";
import { proposeChanges } from "@/lib/ask/propose";
import { acceptProposal, applyEntityChange } from "@/lib/proposals/apply";
import { moveToAccount } from "@/lib/proposals/move";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { seedAccount, USER } from "./helpers";

function fixture() {
  const seed = seedAccount();
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  applyEntityChange({ accountId: seed.accountId, entityType: "play", op: "update", entityId: seed.playId, payload: { phase: 1 }, actorUserId: USER });
  const itemId = applyEntityChange({ accountId: seed.accountId, entityType: "action_item", op: "create", payload: { text: "Synthetic roadmap milestone", due: "2026-11-01", play_id: seed.playId }, actorUserId: USER }).entityId;
  const thread = createThread({ accountId: seed.accountId, question: "Synthetic roadmap", saved: true, userId: USER });
  const ctx: ToolContext = { userId: USER, now: new Date("2026-10-24T12:00:00Z"), cites: new CitableSet(), threadId: thread.id, accountId: seed.accountId, runId: null, batches: [] };
  const read = () => JSON.parse(runReadTool("playbook", { account_id: seed.accountId }, ctx).content);
  const shown = read();
  expect(shown.roadmap[0].plays).toContain("EHR platform defense");
  expect(shown.action_plan).toContainEqual(expect.objectContaining({ milestone: "Synthetic roadmap milestone", for: "EHR platform defense" }));
  return { ...seed, itemId, ctx, read };
}

const report = (accountId: string) => ({
  title: "Synthetic roadmap report", account_id: accountId,
  sections: [{ heading: "Next", body: "Synthetic roadmap milestone for EHR platform defense [1]." }],
  // Deliberately cite only the account: uncited context must still be guarded.
  citations: [{ n: 1, kind: "account", id: accountId }],
});
const proposal = (accountId: string) => ({ account_id: accountId, changes: [
  { record: "contact", op: "create", fields: { name: "Synthetic proposed owner" }, why: "Follow the roadmap milestone" },
] });
const writes = () => ({
  documents: db().prepare("SELECT * FROM documents ORDER BY id").all(),
  proposals: db().prepare("SELECT * FROM proposals ORDER BY id").all(),
});

it("retains exactly the exposed account, plays and action items", () => {
  const f = fixture();
  expect([...f.ctx.cites.map.keys()].sort()).toEqual([
    `account:${f.accountId}`, `play:${f.playId}`, `action_item:${f.itemId}`,
  ].sort());
  expect(f.ctx.readState!.values("play", f.playId, ["title"])).toEqual({ title: "EHR platform defense" });
  expect(f.ctx.readState!.values("action_item", f.itemId, ["due"])).toEqual({ due: "2026-11-01" });
});

it("permits an unchanged playbook report and proposal", () => {
  const f = fixture();
  expect(getReport(createReport(report(f.accountId), f.ctx).docId)?.doc.account_id).toBe(f.accountId);
  expect(proposeChanges(proposal(f.accountId), f.ctx).batch?.count).toBe(1);
});

for (const kind of ["play", "action_item"] as const) {
  for (const change of ["archive", "move", "delete", "move back and reread"] as const) {
    it.each(["report", "proposal"] as const)(`refuses %s after exposed ${kind} ${change}, even without citing it`, (write) => {
      const f = fixture();
      const id = kind === "play" ? f.playId : f.itemId;
      const table = kind === "play" ? "plays" : "action_items";
      if (change === "archive") applyEntityChange({ accountId: f.accountId, entityType: kind, op: "update", entityId: id, payload: { archived_at: "2026-10-24" }, actorUserId: USER });
      if (change === "delete") db().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (change.startsWith("move")) {
        const to = seedAccount({ name: "Synthetic destination", dealId: "SYN-DEST" });
        moveToAccount({ entity: kind, id, from: f.accountId, to: to.accountId, actorUserId: USER });
        if (change === "move back and reread") {
          moveToAccount({ entity: kind, id, from: to.accountId, to: f.accountId, actorUserId: USER });
          f.read();
        }
      }
      const before = writes();
      expect(() => write === "report" ? createReport(report(f.accountId), f.ctx) : proposeChanges(proposal(f.accountId), f.ctx)).toThrow(/context changed or is unavailable/);
      expect(writes()).toEqual(before);
      expect(f.ctx.reportDocId).toBeUndefined();
      expect(f.ctx.batches).toEqual([]);
    });
  }

  it(`keeps the first ${kind} field baseline across repeated and broader reads`, () => {
    const f = fixture();
    const id = kind === "play" ? f.playId : f.itemId;
    const field = kind === "play" ? "title" : "due";
    const original = kind === "play" ? "EHR platform defense" : "2026-11-01";
    const edited = kind === "play" ? "Synthetic human title" : "2026-11-02";
    const suggested = kind === "play" ? "Synthetic model title" : "2026-11-03";
    applyEntityChange({ accountId: f.accountId, entityType: kind, op: "update", entityId: id, payload: { [field]: edited }, actorUserId: USER });
    f.read();
    runReadTool("account", { account_id: f.accountId }, f.ctx);
    const out = proposeChanges({ account_id: f.accountId, changes: [{ record: kind, op: "update", id, fields: { [field]: suggested }, why: "Synthetic suggestion" }] }, f.ctx);
    const saved = db().prepare("SELECT id, before_json FROM proposals WHERE batch_id = ?").get(out.batch!.batchId) as { id: string; before_json: string };
    expect(JSON.parse(saved.before_json)).toEqual({ [field]: original });
    expect(acceptProposal(saved.id, USER).status).toBe("conflict");
    expect(db().prepare(`SELECT ${field} AS value FROM ${kind === "play" ? "plays" : "action_items"} WHERE id = ?`).get(id)).toEqual({ value: edited });
  });
}

it("does not guard unrelated records that the playbook did not expose", () => {
  const f = fixture();
  // The seed's deal/contact/meeting are not in this tool's compact output.
  applyEntityChange({ accountId: f.accountId, entityType: "contact", op: "update", entityId: f.contactId, payload: { archived_at: "2026-10-24" }, actorUserId: USER });
  expect(getReport(createReport(report(f.accountId), f.ctx).docId)).not.toBeNull();
  expect(proposeChanges(proposal(f.accountId), f.ctx).batch?.count).toBe(1);
});
