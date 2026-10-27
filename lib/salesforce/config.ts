// The optional Salesforce connection: off until someone turns it on here and
// the box has its credentials. What to read and where to write is kept in
// settings (no secrets); the credentials are only ever environment variables
// (DECISIONS #78).
import { z } from "zod";
import { db } from "../db";
import { MEDDPICC } from "../playbook/schema";

const apiName = z.string().trim().max(80).regex(/^[A-Za-z][A-Za-z0-9_.]*$/, "a Salesforce API name, such as Asset or Product2.Name");
const optName = apiName.nullable().default(null);

export const SalesforceSettings = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["rest", "mcp"]).default("rest"),
    /** The object that holds what a customer has installed, and its fields. Null skips it. */
    installBase: z
      .object({ object: apiName, product: apiName, value: optName, quantity: optName })
      .nullable()
      .default(null),
    /**
     * Where the qualification scorecard is written on an Opportunity: one
     * field per element, or one long text field for all of them.
     */
    qualification: z
      .object({
        combined: optName,
        fields: z.partialRecord(z.enum(MEDDPICC), apiName).default({}),
      })
      .default({ combined: null, fields: {} }),
    /** MCP only: the server's tool names for a SOQL query and a record update. */
    mcpQueryTool: z.string().trim().max(80).default("soql_query"),
    mcpUpdateTool: z.string().trim().max(80).nullable().default(null),
  })
  .strict();
export type SalesforceSettings = z.infer<typeof SalesforceSettings>;

const KEY = "salesforce";

export function salesforceSettings(): SalesforceSettings {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  const parsed = row ? SalesforceSettings.safeParse(JSON.parse(row.value)) : null;
  return parsed?.success ? parsed.data : SalesforceSettings.parse({});
}

export function saveSalesforceSettings(input: unknown, userId: string): SalesforceSettings {
  const s = SalesforceSettings.parse(input);
  db()
    .prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(KEY, JSON.stringify(s), userId, Date.now());
  return s;
}

/** Which environment variables each mode needs. Names only: values are never shown. */
export const ENV_NEEDED = {
  rest: ["SALESFORCE_LOGIN_URL", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET"],
  mcp: ["SALESFORCE_MCP_URL", "SALESFORCE_MCP_TOKEN"],
} as const;

export const isFakeSalesforce = () => process.env.SALESFORCE_FAKE === "1";

/** Why Salesforce cannot be used right now, or null when it can. */
export function salesforceProblem(s: SalesforceSettings = salesforceSettings()): string | null {
  if (!s.enabled) return "The Salesforce connection is off. Turn it on under Settings, Salesforce.";
  if (isFakeSalesforce()) return null;
  const missing = ENV_NEEDED[s.mode].filter((k) => !process.env[k]?.trim());
  return missing.length ? `The box is missing ${missing.join(", ")}. Set ${missing.length === 1 ? "it" : "them"} in the environment and restart.` : null;
}

/** A Salesforce record id: 15 or 18 letters and digits. */
export const isSalesforceId = (v: string | null | undefined): v is string => !!v && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(v);
