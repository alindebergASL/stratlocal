// Synthetic account records only.
import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { localAccountAttention } from "@/lib/local/attention";
import { applyEntityChange, createProposalBatch } from "@/lib/proposals/apply";
import { seedAccount, USER } from "./helpers";

const NOW = new Date("2026-10-30T00:30:00Z"); // October 29 at 17:30 Pacific.
afterEach(() => vi.unstubAllEnvs());
function create(accountId: string, entityType: "action_item" | "meeting" | "deal", payload: Record<string, unknown>) {
  return applyEntityChange({ accountId, entityType, op: "create", payload, actorUserId: USER }).entityId;
}

it("shows pending reviews and due work only for this account in the app's calendar day", () => {
  vi.stubEnv("APP_TIMEZONE", "America/Los_Angeles");
  const a = seedAccount();
  const other = seedAccount({ name: "Synthetic Other", dealId: "SYN-OTHER" });
  createProposalBatch(a.accountId, { kind: "import", id: "synthetic", aiRunId: null }, [{ entity_type: "account", op: "update", entity_id: a.accountId, payload: { region: "West" }, rationale: "Synthetic evidence" }]);
  createProposalBatch(other.accountId, { kind: "import", id: "synthetic-other", aiRunId: null }, [{ entity_type: "account", op: "update", entity_id: other.accountId, payload: { region: "East" }, rationale: "Synthetic evidence" }]);
  const late = create(a.accountId, "action_item", { text: "Synthetic late task", due: "2026-10-28" });
  const today = create(a.accountId, "action_item", { text: "Synthetic today task", due: "2026-10-29", owner: "Synthetic owner" });
  create(a.accountId, "action_item", { text: "Synthetic tomorrow task", due: "2026-10-30" });
  create(a.accountId, "action_item", { text: "Synthetic undated task" });
  create(a.accountId, "action_item", { text: "Synthetic finished task", due: "2026-10-28", status: "done" });
  const archived = create(a.accountId, "action_item", { text: "Synthetic archived task", due: "2026-10-28" });
  db().prepare("UPDATE action_items SET archived_at='2026-10-28' WHERE id=?").run(archived);
  create(other.accountId, "action_item", { text: "Synthetic other account task", due: "2026-10-28" });

  const result = localAccountAttention(a.accountId, NOW);
  expect(result).toMatchObject({ today: "2026-10-29", pending: 1, overdue: 1, dueToday: 1 });
  expect(result.followUps.map(row => row.id)).toEqual([late, today]);
  db().prepare("UPDATE proposals SET status='rejected' WHERE account_id=?").run(a.accountId);
  expect(localAccountAttention(a.accountId, NOW).pending).toBe(0);
});

it("respects deal next-step waivers, closed status, archives and merges", () => {
  vi.stubEnv("APP_TIMEZONE", "America/Los_Angeles");
  const a = seedAccount();
  for (const [id, patch] of Object.entries({
    info: { next_step_waived: "info" },
    until: { next_step_waived: "until", next_step_waived_until: "2026-10-29" },
    expired: { next_step_waived: "until", next_step_waived_until: "2026-10-28" },
    written: { next_step: "Schedule discovery" },
    closed: { status: "won" },
  })) create(a.accountId, "deal", { deal_id: `SYN-${id}`, name: `Synthetic ${id}`, ...patch });
  create(a.accountId, "deal", { deal_id: "SYN-archived", name: "Synthetic archived" });
  create(a.accountId, "deal", { deal_id: "SYN-merged", name: "Synthetic merged" });
  db().prepare("UPDATE deals SET archived_at='2026-10-28' WHERE deal_id='SYN-archived'").run();
  db().prepare("UPDATE deals SET merged_into=? WHERE deal_id='SYN-merged'").run(a.dealId);
  expect(localAccountAttention(a.accountId, NOW).missingNextStep).toBe(2); // Initial + expired waiver.
});

it("finds today's current or next meeting without resurfacing completed, archived or merged meetings", () => {
  vi.stubEnv("APP_TIMEZONE", "America/Los_Angeles");
  const a = seedAccount();
  create(a.accountId, "meeting", { title: "Synthetic finished", held_at: "2026-10-29", held_time: "16:30" });
  const archived = create(a.accountId, "meeting", { title: "Synthetic archived", held_at: "2026-10-29", held_time: "17:00" });
  const merged = create(a.accountId, "meeting", { title: "Synthetic merged", held_at: "2026-10-29", held_time: "17:05" });
  db().prepare("UPDATE meetings SET archived_at='2026-10-29' WHERE id=?").run(archived);
  db().prepare("UPDATE meetings SET merged_into=? WHERE id=?").run(a.meetingId, merged);
  const current = create(a.accountId, "meeting", { title: "Synthetic current", held_at: "2026-10-29", held_time: "17:15" });
  const next = create(a.accountId, "meeting", { title: "Synthetic next", held_at: "2026-10-29", held_time: "18:00" });
  const unknownTime = create(a.accountId, "meeting", { title: "Synthetic time unknown", held_at: "2026-10-29" });
  create(a.accountId, "meeting", { title: "Synthetic tomorrow", held_at: "2026-10-30", held_time: "09:00" });
  expect(localAccountAttention(a.accountId, NOW).nextMeeting?.id).toBe(current);
  expect(localAccountAttention(a.accountId, new Date("2026-10-30T01:30:00Z")).nextMeeting?.id).toBe(next);
  expect(localAccountAttention(a.accountId, new Date("2026-10-30T02:30:00Z")).nextMeeting?.id).toBe(unknownTime);
});

it("keeps complete due counts while limiting the oldest follow-up preview", () => {
  vi.stubEnv("APP_TIMEZONE", "America/Los_Angeles");
  const a = seedAccount();
  for (let day = 20; day <= 26; day++) create(a.accountId, "action_item", { text: `Synthetic task ${day}`, due: `2026-10-${day}` });
  const result = localAccountAttention(a.accountId, NOW);
  expect(result.overdue).toBe(7);
  expect(result.followUps.map(row => row.due)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  expect(localAccountAttention("missing-account", NOW)).toMatchObject({ pending: 0, overdue: 0, dueToday: 0, missingNextStep: 0, followUps: [], nextMeeting: null });
});

it("shows the assigned app user even when no free-text owner was entered", () => {
  vi.stubEnv("APP_TIMEZONE", "America/Los_Angeles");
  const a = seedAccount();
  db().prepare("INSERT INTO users(id,email,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run("synthetic-assignee", "assignee@example.test", "fake", "Synthetic Assignee", 1, 1);
  const assigned = create(a.accountId, "action_item", { text: "Synthetic assigned task", due: "2026-10-29", owner_user_id: "synthetic-assignee" });
  const customer = create(a.accountId, "action_item", { text: "Synthetic customer task", due: "2026-10-29", owner: "Synthetic Customer" });
  const result = localAccountAttention(a.accountId, NOW);
  expect(result.followUps.find(row => row.id === assigned)?.owner).toBe("Synthetic Assignee");
  expect(result.followUps.find(row => row.id === customer)?.owner).toBe("Synthetic Customer");
});
