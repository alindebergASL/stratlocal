// The neutral starter and synthetic accounts only.
import { expect, it, vi } from "vitest";
import { seedAccount, USER } from "./helpers";
import { savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { moveToStep } from "@/lib/playbook/lifecycle";
import { saveWorkshop } from "@/lib/playbook/workshop";
import { Playbook } from "@/lib/playbook/schema";
import { getTemplate, listTemplates, playbookTemplates } from "@/lib/ask/templates";
import { runReadTool, CitableSet, type ToolContext } from "@/lib/ask/tools";
import { applyEntityChange } from "@/lib/proposals/apply";

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePageUser: async () => ({ id: USER, name: "Synthetic User", email: "synthetic@example.test" }) }));

const ctx = (): ToolContext => ({ now: new Date("2026-10-23T12:00:00Z"), userId: USER, cites: new CitableSet(), accountId: null }) as unknown as ToolContext;

it("offers the playbook's artifacts as account templates only while there is a playbook", () => {
  expect(playbookTemplates(null)).toEqual([]);
  expect(listTemplates("account").some((t) => t.id.startsWith("playbook_"))).toBe(false);
  expect(getTemplate("playbook_intelligence_brief")).toBeNull();

  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const names = listTemplates("account").filter((t) => t.id.startsWith("playbook_")).map((t) => t.name);
  expect(names).toEqual(["Intelligence brief", "Question guide", "Outcome readout", "Workshop pack", "Roadmap and action plan", "Quarterly refresh"]);
  const brief = getTemplate("playbook_intelligence_brief")!;
  expect(brief.sections).toEqual(["Strategic plan and mandates read", "Budget calendar found", "Leaders' own words captured", "Installed base reviewed", "Peers and competitors", "Hypothesis to test"]);
  expect(brief.question).toContain("playbook tool");
  expect(getTemplate("playbook_workshop_pack")!.sections[0]).toBe("Confirm targets");
  const noWorkshop = Playbook.parse({ ...STARTER_PLAYBOOK, workshop: [] });
  expect(playbookTemplates(noWorkshop).some((t) => t.id === "playbook_workshop_pack")).toBe(false);
});

it("gives Ask the account through the playbook", () => {
  const { accountId } = seedAccount();
  expect(JSON.parse(runReadTool("playbook", { account_id: accountId }, ctx()).content)).toEqual({ error: expect.stringContaining("no playbook") });

  savePlaybook({ playbook: STARTER_PLAYBOOK, userId: USER, basisId: null });
  const playbook = Playbook.parse(STARTER_PLAYBOOK);
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { archetype_id: "stuck-in-pilots", archetype_hypothesis: "Synthetic hypothesis.", meddpicc_e: { status: "confirmed", evidence: "Synthetic finance lead owns it." }, fiscal_year_start_month: 7 }, actorUserId: USER });
  moveToStep(accountId, playbook, "readout", USER);
  saveWorkshop(accountId, { use_cases: [{ id: "u", name: "Synthetic triage", relevance: { speed: 3 }, phase: 1 }] }, USER, null);

  const c = ctx();
  const r = runReadTool("playbook", { account_id: accountId }, c);
  const out = JSON.parse(r.content);
  expect(r.step).toBe("Read Synthetic Orchard Lab through the playbook");
  expect(out.archetype).toMatchObject({ name: "Stuck in pilots", hypothesis: "Synthetic hypothesis." });
  expect(out.lifecycle).toMatchObject({ step: "5 of 7: Outcome readout", next: "Readout sent", next_step: "Joint roadmap and action plan" });
  expect(out.still_to_find_out).not.toContain("Economic buyer");
  expect(out.still_to_find_out).toContain("Champion");
  expect(out.workshop.use_cases[0]).toMatchObject({ name: "Synthetic triage", run: "In an application" });
  expect(out.budget.fiscal_year_starts).toBe("2027-07-01");
  expect(out.discovery_questions.flatMap((g: { questions: string[] }) => g.questions)).toContain("What has stopped your pilots reaching production?");
  expect(c.cites.size).toBe(1);
});
