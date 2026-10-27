// Synthetic Salesforce records only: the fake client and a local fake MCP server.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { seedAccount, USER } from "./helpers";
import { applyEntityChange, acceptProposal } from "@/lib/proposals/apply";
import { getAccount, listDeals, listPendingProposals } from "@/lib/queries/accounts";
import { saveSalesforceSettings, salesforceProblem, salesforceSettings } from "@/lib/salesforce/config";
import { fakeSalesforce, salesforceClient } from "@/lib/salesforce/client";
import { checkSalesforce, qualificationPayload, readFromSalesforce, salesforceLog, sendQualification } from "@/lib/salesforce/sync";
import { scorecard } from "@/lib/playbook/qualification";

const SF_ACCOUNT = "001000000000001AAA";
let server: Server | null = null;

beforeEach(() => vi.stubEnv("SALESFORCE_FAKE", "1"));
afterEach(() => {
  vi.unstubAllEnvs();
  server?.close();
  server = null;
});

it("stays off until turned on, and says which credentials the box lacks", () => {
  expect(salesforceProblem()).toMatch(/is off/);
  vi.stubEnv("SALESFORCE_FAKE", "0");
  saveSalesforceSettings({ enabled: true }, USER);
  expect(salesforceProblem()).toBe("The box is missing SALESFORCE_LOGIN_URL, SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET. Set them in the environment and restart.");
  expect(() => saveSalesforceSettings({ enabled: true, installBase: { object: "Asset; DROP", product: "x" } }, USER)).toThrow();
});

it("reads an account in as proposals, and sends the scorecard only when pressed", async () => {
  saveSalesforceSettings({ enabled: true, installBase: { object: "Asset", product: "Product2.Name", value: "Price", quantity: null }, qualification: { combined: "MEDDPICC_Notes__c", fields: { E: "Economic_Buyer__c" } } }, USER);
  const { accountId } = seedAccount();
  await expect(readFromSalesforce(accountId, USER)).rejects.toThrow(/CRM ID/);
  applyEntityChange({ accountId, entityType: "account", op: "update", entityId: accountId, payload: { crm_id: SF_ACCOUNT, meddpicc_e: { status: "confirmed", evidence: "Synthetic finance lead signs." } }, actorUserId: USER });
  expect(await checkSalesforce(USER)).toMatchObject({ ok: true });

  const { proposals } = await readFromSalesforce(accountId, USER);
  const pending = listPendingProposals(accountId);
  expect(proposals).toBe(pending.length);
  const kinds = pending.map((p) => `${p.entity_type}:${p.op}`);
  expect(kinds.filter((k) => k === "deal:create")).toHaveLength(2);
  expect(kinds).toContain("contact:create");
  expect(kinds.filter((k) => k === "install_base:create")).toHaveLength(2);
  const won = pending.find((p) => p.payload_json.includes("Synthetic pilot"))!;
  expect(JSON.parse(won.payload_json)).toMatchObject({ deal_id: "006000000000002AAA", status: "won", stage_label: "Closed Won" });
  const open = pending.find((p) => p.payload_json.includes("Synthetic platform renewal"))!;
  expect(JSON.parse(open.payload_json)).toMatchObject({ stage: 3, tcv_usd: 250000, close_date: "2027-03-31" });
  expect(listDeals(accountId).some((d) => d.deal_id === "006000000000001AAA")).toBe(false);

  acceptProposal(open.id, USER);
  // Read again: what now matches is not proposed twice.
  await readFromSalesforce(accountId, USER);
  expect(listPendingProposals(accountId).filter((p) => p.payload_json.includes("Synthetic platform renewal") && p.status === "pending")).toHaveLength(0);

  const payload = qualificationPayload(scorecard(getAccount(accountId)!), salesforceSettings(), "2026-10-23")!;
  expect(payload.Economic_Buyer__c).toBe("[Confirmed] Synthetic finance lead signs.");
  expect(payload.MEDDPICC_Notes__c!.split("\n")[0]).toBe("MEDDPICC (2026-10-23)");
  await expect(sendQualification(accountId, "006000000000009AAA", USER)).rejects.toThrow(/Choose one of this account/);
  expect(await sendQualification(accountId, "006000000000001AAA", USER)).toEqual({ fields: 2 });
  expect(fakeSalesforce().updates.at(-1)).toMatchObject({ object: "Opportunity", id: "006000000000001AAA", fields: { Economic_Buyer__c: "[Confirmed] Synthetic finance lead signs." } });
  expect(salesforceLog(10, accountId).map((l) => `${l.direction}:${l.status}`)).toEqual(["write:done", "read:done", "read:done"]);
});

it("talks to an MCP server: initialize, then a query tool, answered as an event stream", async () => {
  const seen: Array<{ method: string; session: string | undefined }> = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: { query?: string } } };
      seen.push({ method: msg.method, session: req.headers["mcp-session-id"] as string | undefined });
      if (msg.id === undefined) return void res.writeHead(202).end();
      const result = msg.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {} } : { content: [{ type: "text", text: JSON.stringify({ records: [{ Id: "001000000000001AAA", query: msg.params?.arguments?.query }] }) }] };
      res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "synthetic-session" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  vi.stubEnv("SALESFORCE_FAKE", "0");
  vi.stubEnv("SALESFORCE_MCP_URL", `http://127.0.0.1:${port}/mcp`);
  vi.stubEnv("SALESFORCE_MCP_ALLOW_HTTP", "1");
  vi.stubEnv("SALESFORCE_MCP_TOKEN", "synthetic-token");
  saveSalesforceSettings({ enabled: true, mode: "mcp", mcpQueryTool: "soql_query" }, USER);
  const client = salesforceClient();
  const rows = await client.query("SELECT Id FROM Account LIMIT 1");
  expect(rows).toEqual([{ Id: "001000000000001AAA", query: "SELECT Id FROM Account LIMIT 1" }]);
  expect(seen.map((s) => s.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  expect(seen.at(-1)?.session).toBe("synthetic-session");
  await expect(client.update("Opportunity", "006000000000001AAA", {})).rejects.toThrow(/No update tool/);
});
