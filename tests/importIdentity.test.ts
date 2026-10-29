import { afterEach, expect, it, vi } from "vitest";
import { assertImportAccountIdentity } from "@/lib/import/accountIdentity";
import { db } from "@/lib/db";
import { getRun } from "@/lib/ai/guard";
import { startImportRun, storeReportDocument } from "@/lib/import/run";
import { listPendingProposals } from "@/lib/queries/accounts";
import { seedAccount, USER } from "./helpers";

afterEach(() => vi.unstubAllEnvs());

it("allows only case/whitespace variations in names and preserves case-sensitive CRM IDs", () => {
  const reported = { name: "  SYNTHETIC   ORCHARD LAB ", crm_id: "SYN-001", legal_entity: null, region: null, segment: null, hq: null, summary: null };
  expect(() => assertImportAccountIdentity(reported, { name: "Synthetic Orchard Lab", crm_id: "SYN-001" })).not.toThrow();
  expect(() => assertImportAccountIdentity(reported, { name: "Synthetic Orchard Lab", crm_id: "syn-001" })).toThrow(/CRM ID/);
});

it.each(["name", "crm_id", "other_account"])("blocks a %s conflict before creating any proposals", async (conflict) => {
  vi.stubEnv("AI_FAKE", "1");
  vi.stubEnv("AI_DAILY_CAP_CENTS", "10000");
  const { accountId } = seedAccount();
  if (conflict === "crm_id") db().prepare("UPDATE accounts SET crm_id = ? WHERE id = ?").run("SYN-CURRENT", accountId);
  if (conflict === "other_account") {
    const other = seedAccount({ name: "Synthetic River County", dealId: "SYN-OTHER-001" });
    db().prepare("UPDATE accounts SET crm_id = ? WHERE id = ?").run("SYN-REPORTED", other.accountId);
  }
  const bytes = Buffer.from(JSON.stringify({
    account: { name: conflict === "name" ? "Synthetic River County" : "Synthetic Orchard Lab", crm_id: "SYN-REPORTED" },
    deals: [{ deal_id: "SYN-NEW-001", name: "Must not be proposed" }],
  }));
  const doc = await storeReportDocument({ accountId, filename: "conflict.json", bytes, userId: USER });
  const runId = startImportRun(doc, USER);
  await vi.waitFor(() => expect(getRun(runId)?.status).toBe("failed"));
  expect(getRun(runId)?.error).toMatch(/Account identity conflict/);
  expect(listPendingProposals(accountId)).toEqual([]);
  expect(db().prepare("SELECT 1 FROM deals WHERE deal_id = 'SYN-NEW-001'").get()).toBeUndefined();
  expect(db().prepare("SELECT id FROM documents WHERE id = ?").get(doc.id)).toBeDefined();
});
