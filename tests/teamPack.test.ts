// The neutral starter and synthetic settings only.
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { currentPlaybook, playbookHistory, savePlaybook } from "@/lib/playbook/store";
import { STARTER_PLAYBOOK } from "@/lib/playbook/starter";
import { currentDirection, saveDirection } from "@/lib/teamDirection";
import { listTemplates, saveTemplate } from "@/lib/ask/templates";
import { assistantSetting, saveAssistant } from "@/lib/assistants/settings";
import { branding, saveBranding } from "@/lib/team/branding";
import { salesforceSettings, saveSalesforceSettings } from "@/lib/salesforce/config";
import { applyPack, exportPack, readPack, starterPack } from "@/lib/team/pack";

const A = "team-a-admin";
const B = "team-b-admin";
const seed = (id: string, email: string, admin = 1) =>
  db().prepare("INSERT INTO users (id, email, password_hash, display_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, 'Synthetic', ?, 0, 0)").run(id, email, hashPassword("synthetic-pass-123"), admin);

it("ships a neutral starter pack that matches the code and names nobody", () => {
  const file = JSON.parse(readFileSync("starter/team-pack.json", "utf8"));
  expect(file).toEqual(starterPack());
  const r = readPack(JSON.stringify(file));
  expect(r.ok && r.lines[0]).toMatch(/^Playbook "AI outcome starter": 7 steps, 5 archetypes/);
});

it("moves a team's setup to another team, shown first and applied by an admin", () => {
  seed(A, "a@example.test");
  savePlaybook({ playbook: { ...STARTER_PLAYBOOK, name: "Synthetic team playbook" }, userId: A, basisId: null });
  saveDirection({ focusAreas: ["Synthetic focus"], goals: "Synthetic goal", signals: null, avoid: null, userId: A, basisId: null });
  saveTemplate({ name: "Synthetic weekly", question: "Write the synthetic weekly.", sections: ["One", "Two"], scope: "all", userId: A });
  saveAssistant("account_watch", { mode: "auto", monthlyCents: 500 }, A);
  saveBranding({ appName: "Synthetic Desk", teamName: "Synthetic Team A", accent: "123456", logo: "data:image/png;base64,iVBORw0KGgo=" }, A);
  saveSalesforceSettings({ enabled: true, qualification: { combined: "MEDDPICC_Notes__c", fields: {} } }, A);
  const text = JSON.stringify(exportPack());
  const pack = JSON.parse(text);
  expect(pack).toMatchObject({ kind: "team_pack", name: "Synthetic Team A", branding: { appName: "Synthetic Desk", accent: "123456" }, salesforce: { enabled: false } });
  expect(text).not.toContain("iVBORw0KGgo"); // the logo stays behind
  expect(text).not.toContain("a@example.test");

  // Another team, on a fresh database.
  db().exec("DELETE FROM playbooks; DELETE FROM team_direction; DELETE FROM ask_templates; DELETE FROM assistant_settings; DELETE FROM settings;");
  seed(B, "b@example.test");
  seed("team-b-member", "m@example.test", 0);
  const preview = readPack(text);
  expect(preview.ok && preview.lines.join("\n")).toContain('Playbook "Synthetic team playbook"');
  expect(() => applyPack(text, "team-b-member")).toThrow(/Only an admin/);
  const r = applyPack(text, B);
  expect(r.applied).toEqual(["playbook", "team direction", "1 report template", "assistant settings", "name and colour", "Salesforce mapping"]);
  expect(currentPlaybook()?.playbook.name).toBe("Synthetic team playbook");
  expect(playbookHistory(5)[0]?.note).toContain("team pack");
  expect(currentDirection()?.focusAreas).toEqual(["Synthetic focus"]);
  expect(listTemplates().some((t) => t.name === "Synthetic weekly")).toBe(true);
  expect(assistantSetting("account_watch").mode).toBe("auto");
  expect(branding()).toMatchObject({ appName: "Synthetic Desk", logo: null });
  expect(salesforceSettings()).toMatchObject({ enabled: false, qualification: { combined: "MEDDPICC_Notes__c" } });

  // Loading again adds no second copy of a template.
  applyPack(text, B);
  expect(listTemplates().filter((t) => t.name === "Synthetic weekly")).toHaveLength(1);
});

it("refuses what is not a team pack, and says what it is", () => {
  expect(readPack("not json")).toEqual({ ok: false, error: "That file is not JSON." });
  expect(readPack(JSON.stringify({ kind: "playbook", version: 1, playbook: {} }))).toMatchObject({ ok: false, error: expect.stringContaining("Playbook page") });
  const broken = readPack(JSON.stringify({ kind: "team_pack", version: 1, playbook: { name: "" } }));
  expect(broken.ok && broken.problems.length > 0).toBe(true);
});
