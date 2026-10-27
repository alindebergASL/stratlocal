// The neutral starter and synthetic accounts only. AI_FAKE replay only.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedAccount, USER } from "./helpers";
import { db } from "@/lib/db";
import { getRun } from "@/lib/ai/guard";
import { applyEntityChange } from "@/lib/proposals/apply";
import { getAccount, listPendingProposals } from "@/lib/queries/accounts";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { pendingArchetype } from "@/lib/playbook/archetype";
import { REFRESH_EVERY_DAYS, refreshCandidates, refreshNotes, runQuarterlyRefresh } from "@/lib/assistants/quarterlyRefresh";
import { supersedePendingPlanDrafts } from "@/lib/plan/run";
import { icsCalendar } from "@/lib/calendar/icsWrite";
import { parseIcs } from "@/lib/calendar/ics";

beforeEach(() => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
});
afterEach(() => vi.unstubAllEnvs());

it("writes an all-day calendar file that a calendar reader reads back", () => {
  const long = "Synthetic milestone, with a comma; a semicolon and a long description ".repeat(3);
  const text = icsCalendar("Synthetic plan", [
    { uid: "a@strategy", day: "2026-11-03", title: "Synthetic pilot readout", description: long },
    { uid: "b@strategy", day: "not a day", title: "Skipped" },
  ], new Date("2026-10-23T12:00:00Z"));
  expect(text.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  expect(text).toContain("DTSTART;VALUE=DATE:20261103");
  expect(text).toContain("DTEND;VALUE=DATE:20261104");
  expect(text).toContain("TRIGGER:-PT15H");
  const read = parseIcs(text, { from: "2026-10-01", to: "2026-12-31" }, "UTC");
  expect(read.events.map((e) => e.title)).toEqual(["Synthetic pilot readout"]);
});

it("refreshes each account on the playbook once a quarter, as proposals", async () => {
  const { accountId: off } = seedAccount({ name: "Synthetic Untouched County", dealId: "SYN-DEAL-OFF" });
  expect(runQuarterlyRefresh("manual", USER)).toMatchObject({ started: false, reason: "The team has no playbook yet." });
  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  expect(runQuarterlyRefresh("schedule", null)).toMatchObject({ started: false, reason: "No account on the playbook is due a refresh." });

  const { accountId } = seedAccount();
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: "builder", meddpicc_e: { status: "partial", evidence: "Synthetic finance lead." } }, actorUserId: USER });
  expect(refreshCandidates().map((c) => c.id)).toEqual([accountId]);
  db().prepare(`UPDATE change_log SET created_at = created_at - ? WHERE entity_id = ? AND field = 'meddpicc_e'`).run((REFRESH_EVERY_DAYS + 5) * 86_400_000, accountId);
  const notes = refreshNotes(getAccount(accountId)!, Date.now());
  expect(notes[0]).toBe('Is it still "Building their own"?');
  expect(notes).toContain("Re-check, unchanged for a quarter: Economic buyer (partial).");
  expect(notes.some((n) => n.startsWith("Still not found out: Metrics"))).toBe(true);

  const r = runQuarterlyRefresh("schedule", null);
  expect(r).toMatchObject({ started: true, reason: expect.stringContaining("Synthetic Orchard Lab") });
  const followUp = listPendingProposals(accountId).find((p) => p.origin_id === "playbook_refresh")!;
  expect(JSON.parse(followUp.payload_json)).toMatchObject({ text: "Quarterly refresh: Synthetic Orchard Lab", notes: expect.stringContaining("Economic buyer") });
  await vi.waitFor(() => expect(pendingArchetype(accountId)).not.toBeNull());
  const archetypeRun = db().prepare(`SELECT id, assistant FROM ai_runs WHERE account_id = ? AND kind = 'playbook_archetype'`).get(accountId) as { id: string; assistant: string };
  expect(archetypeRun.assistant).toBe("quarterly_refresh");
  await vi.waitFor(() => expect(getRun(archetypeRun.id)?.status).toBe("done"));
  supersedePendingPlanDrafts(accountId);
  expect(listPendingProposals(accountId).some((p) => p.origin_id === "playbook_refresh")).toBe(true);

  // Done for this quarter: the schedule passes it over; nothing touches the account off the playbook.
  expect(runQuarterlyRefresh("schedule", null)).toMatchObject({ started: false });
  expect(listPendingProposals(off)).toEqual([]);
});
