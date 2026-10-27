// Talking to Salesforce: through its REST API with an OAuth client-credentials
// connected app, or through a Salesforce MCP server. Both answer the same two
// things: a SOQL query, and an update to one record. A fake stands in for
// tests and for trying the screens (SALESFORCE_FAKE=1).
import { isFakeSalesforce, salesforceProblem, salesforceSettings, type SalesforceSettings } from "./config";

export type SfRecord = Record<string, unknown>;
export interface SalesforceClient {
  query(soql: string): Promise<SfRecord[]>;
  update(object: string, id: string, fields: Record<string, unknown>): Promise<void>;
}

export class SalesforceError extends Error {}

const API = "v62.0";
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 10;

async function call(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e: unknown) => {
    throw new SalesforceError(`Salesforce could not be reached: ${e instanceof Error ? e.message : String(e)}`);
  });
  return res;
}

async function failure(res: Response, what: string): Promise<SalesforceError> {
  const text = (await res.text().catch(() => "")).slice(0, 300);
  return new SalesforceError(`${what} failed (${res.status})${text ? `: ${text}` : ""}`);
}

class RestClient implements SalesforceClient {
  private token: { access: string; instance: string } | null = null;

  private async auth() {
    if (this.token) return this.token;
    const login = process.env.SALESFORCE_LOGIN_URL!.replace(/\/+$/, "");
    if (!/^https:\/\//.test(login)) throw new SalesforceError("SALESFORCE_LOGIN_URL must start with https://");
    const res = await call(`${login}/services/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SALESFORCE_CLIENT_ID!, client_secret: process.env.SALESFORCE_CLIENT_SECRET! }),
    });
    if (!res.ok) throw await failure(res, "Signing in to Salesforce");
    const body = (await res.json()) as { access_token?: string; instance_url?: string };
    if (!body.access_token || !body.instance_url?.startsWith("https://")) throw new SalesforceError("Salesforce's sign-in answer had no token or instance.");
    this.token = { access: body.access_token, instance: body.instance_url.replace(/\/+$/, "") };
    return this.token;
  }

  async query(soql: string): Promise<SfRecord[]> {
    const t = await this.auth();
    const out: SfRecord[] = [];
    let next: string | null = `/services/data/${API}/query?q=${encodeURIComponent(soql)}`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const res = await call(`${t.instance}${next}`, { headers: { authorization: `Bearer ${t.access}`, accept: "application/json" } });
      if (!res.ok) throw await failure(res, "A Salesforce query");
      const body = (await res.json()) as { records?: SfRecord[]; nextRecordsUrl?: string; done?: boolean };
      out.push(...(body.records ?? []));
      next = body.done === false && body.nextRecordsUrl?.startsWith("/services/") ? body.nextRecordsUrl : null;
    }
    return out;
  }

  async update(object: string, id: string, fields: Record<string, unknown>): Promise<void> {
    const t = await this.auth();
    const res = await call(`${t.instance}/services/data/${API}/sobjects/${encodeURIComponent(object)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${t.access}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw await failure(res, `Updating ${object} ${id}`);
  }
}

// MCP over streamable HTTP: initialize, then tools/call. The answer may come
// as JSON or as a server-sent event stream; either way it is one JSON-RPC
// result whose text content is the records as JSON.
class McpClient implements SalesforceClient {
  private session: string | null = null;
  private id = 0;
  constructor(private s: SalesforceSettings) {}

  private async rpc(method: string, params: unknown, notify = false): Promise<unknown> {
    const url = process.env.SALESFORCE_MCP_URL!;
    if (!/^https:\/\//.test(url) && !(process.env.SALESFORCE_MCP_ALLOW_HTTP === "1" && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))) throw new SalesforceError("SALESFORCE_MCP_URL must start with https://");
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++this.id, method, params };
    const res = await call(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SALESFORCE_MCP_TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.session ? { "mcp-session-id": this.session } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, `The Salesforce MCP server (${method})`);
    this.session = res.headers.get("mcp-session-id") ?? this.session;
    if (notify) return null;
    const text = await res.text();
    const json = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).at(-1) ?? "{}"
      : text;
    const msg = JSON.parse(json) as { result?: unknown; error?: { message?: string } };
    if (msg.error) throw new SalesforceError(`The Salesforce MCP server said: ${msg.error.message ?? "an error"}`);
    return msg.result;
  }

  private async ready() {
    if (this.session !== null || this.id > 0) return;
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "strategy", version: "1" } });
    await this.rpc("notifications/initialized", {}, true);
  }

  private async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ready();
    const result = (await this.rpc("tools/call", { name, arguments: args })) as { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean };
    const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
    if (result?.isError) throw new SalesforceError(`The Salesforce MCP tool ${name} failed: ${text.slice(0, 300)}`);
    if (result?.structuredContent !== undefined) return result.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      throw new SalesforceError(`The Salesforce MCP tool ${name} did not answer with JSON.`);
    }
  }

  async query(soql: string): Promise<SfRecord[]> {
    const out = (await this.tool(this.s.mcpQueryTool, { query: soql })) as { records?: SfRecord[] } | SfRecord[];
    return Array.isArray(out) ? out : (out.records ?? []);
  }

  async update(object: string, id: string, fields: Record<string, unknown>): Promise<void> {
    if (!this.s.mcpUpdateTool) throw new SalesforceError("No update tool is named for the MCP server, so nothing can be written through it.");
    await this.tool(this.s.mcpUpdateTool, { sobject: object, id, fields });
  }
}

// Synthetic records shaped like Salesforce's, for tests and the fake mode.
export class FakeSalesforce implements SalesforceClient {
  updates: Array<{ object: string; id: string; fields: Record<string, unknown> }> = [];
  async query(soql: string): Promise<SfRecord[]> {
    const from = /\bFROM\s+(\w+)/i.exec(soql)?.[1]?.toLowerCase();
    if (from === "account") return [{ Id: "001000000000001AAA", Name: "Synthetic Account" }];
    if (from === "opportunity")
      return [
        { Id: "006000000000001AAA", Name: "Synthetic platform renewal", StageName: "3 - Qualify", Amount: 250000, CloseDate: "2027-03-31", NextStep: "Synthetic workshop", IsClosed: false, IsWon: false },
        { Id: "006000000000002AAA", Name: "Synthetic pilot", StageName: "Closed Won", Amount: 40000, CloseDate: "2026-09-30", NextStep: null, IsClosed: true, IsWon: true },
      ];
    if (from === "contact") return [{ Id: "003000000000001AAA", Name: "Synthetic Records Chief", Title: "Chief Information Officer", Email: "records.chief@example.test" }];
    return [
      { Id: "02i000000000001AAA", Product2: { Name: "Synthetic Switching" }, Price: 120000, Quantity: 40 },
      { Id: "02i000000000002AAA", Product2: { Name: "Synthetic Storage" }, Price: 60000, Quantity: 2 },
    ];
  }
  async update(object: string, id: string, fields: Record<string, unknown>): Promise<void> {
    this.updates.push({ object, id, fields });
  }
}

let fake: FakeSalesforce | null = null;
export function fakeSalesforce(): FakeSalesforce {
  return (fake ??= new FakeSalesforce());
}

export function salesforceClient(s: SalesforceSettings = salesforceSettings()): SalesforceClient {
  const problem = salesforceProblem(s);
  if (problem) throw new SalesforceError(problem);
  if (isFakeSalesforce()) return fakeSalesforce();
  return s.mode === "mcp" ? new McpClient(s) : new RestClient();
}

/** A SOQL string literal. Only ever given a Salesforce id, but quoted properly regardless. */
export const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
