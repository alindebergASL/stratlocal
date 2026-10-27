import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { addDays, todayISO } from "@/lib/clock";
import { currentFiscalQuarter } from "@/lib/fiscal";
// Separate from layoutFixture: existing reading-width invariants keep their shapes.
export function glanceFixture(userId: string, now = new Date()) {
  const create = (accountId: string, entityType: Parameters<typeof applyEntityChange>[0]["entityType"], payload: Record<string, unknown>) => applyEntityChange({ accountId, entityType, op: "create", payload, actorUserId: userId }).entityId;
  const today = todayISO(now), tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
  const accounts = Array.from({ length: 4 }, (_, i) => create("", "account", { name: `Synthetic Glance ${i + 1}`, owner_user_id: userId }));
  for (const id of accounts) createProposalBatch(id, { kind: "plan_draft", id: null, aiRunId: null }, [0, 1].map(i => ({ entity_type: "action_item" as const, op: "create" as const, payload: { text: `Synthetic proposed work ${i}` } })));
  const accountId = accounts[0]!;
  const upcoming = Array.from({ length: 12 }, (_, i) => create(accountId, "meeting", { title: `Synthetic scheduled call ${i + 1}`, held_at: tomorrow, held_time: `${String(i + 8).padStart(2, "0")}:00` }));
  const notes = Array.from({ length: 8 }, (_, i) => create(accountId, "meeting", { title: `Synthetic missing notes ${i + 1}`, held_at: yesterday, held_time: "09:00" }));
  for (let i = 0; i < 3; i++) create(accountId, "action_item", { text: `Synthetic overdue follow-up ${i + 1}`, due: yesterday, status: "open" });
  create(accountId, "play", { title: "Synthetic overdue play", status: "active", next_step: "Confirm dates", next_step_due: yesterday });
  for (let i = 0; i < 2; i++) create(accountId, "deal", { name: `Synthetic deal needing a next step ${i + 1}`, status: "open", fiscal_quarter: currentFiscalQuarter(now).label, next_step: null });
  const sharedId = create("", "account", { name: "Synthetic shared review" });
  createProposalBatch(sharedId, { kind: "plan_draft", id: null, aiRunId: null }, [{ entity_type: "action_item", op: "create", payload: { text: "Shared only proposed work" } }]);
  return { accountId, accounts, upcoming, notes, sharedId };
}
