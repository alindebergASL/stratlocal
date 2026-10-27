// Salesforce in and out. In: an account's opportunities, contacts and
// installed base arrive as proposals in the ordinary review, never written
// directly (DECISIONS #1). Out: the qualification scorecard goes to one
// opportunity only when a person presses send after seeing exactly what will
// be written. Every read and write is logged.
import { db } from "../db";
import { newId } from "../ids";
import { todayISO } from "../clock";
import { createProposalBatch } from "../proposals/apply";
import type { ProposalDraft } from "../proposals/schema";
import { getAccount, latestInstallBase, listContacts, listDeals } from "../queries/accounts";
import { MEDDPICC_LABELS } from "../playbook/schema";
import { scorecard, type ScoreRow } from "../playbook/qualification";
import { isSalesforceId, salesforceSettings, type SalesforceSettings } from "./config";
import { salesforceClient, SalesforceError, soqlString, type SfRecord } from "./client";

export type LogRow = { id: string; account_id: string | null; direction: "check" | "read" | "write"; summary: string; payload_json: string | null; status: "done" | "failed"; error: string | null; user_id: string | null; at: number };

function log(entry: Omit<LogRow, "id" | "at" | "payload_json"> & { payload?: unknown }) {
  db()
    .prepare(`INSERT INTO salesforce_log (id, account_id, direction, summary, payload_json, status, error, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(newId(), entry.account_id, entry.direction, entry.summary.slice(0, 500), entry.payload === undefined ? null : JSON.stringify(entry.payload).slice(0, 20000), entry.status, entry.error?.slice(0, 1000) ?? null, entry.user_id, Date.now());
}

export function salesforceLog(limit = 20, accountId?: string): LogRow[] {
  return (accountId
    ? db().prepare(`SELECT * FROM salesforce_log WHERE account_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`).all(accountId, limit)
    : db().prepare(`SELECT * FROM salesforce_log ORDER BY at DESC, rowid DESC LIMIT ?`).all(limit)) as LogRow[];
}

export async function checkSalesforce(userId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const rows = await salesforceClient().query("SELECT Id FROM Account LIMIT 1");
    const message = `Salesforce answered${rows.length ? "" : ", though no account was visible to this connection"}.`;
    log({ account_id: null, direction: "check", summary: message, status: "done", error: null, user_id: userId });
    return { ok: true, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log({ account_id: null, direction: "check", summary: "The check failed.", status: "failed", error: message, user_id: userId });
    return { ok: false, message };
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** "Product2.Name" read from a nested record. */
const path = (r: SfRecord, p: string): unknown => p.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), r);

/** Salesforce records → proposals, compared with what the account already has. Pure apart from reading the account. */
export function salesforceDrafts(accountId: string, data: { opportunities: SfRecord[]; contacts: SfRecord[]; installed: SfRecord[] | null }, s: SalesforceSettings, today: string): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const ref = (id: unknown, what: string) => ({ kind: "document" as const, id: null, quote: `Salesforce ${what} ${String(id)}` });
  const deals = new Map(listDeals(accountId).map((d) => [d.deal_id, d]));
  for (const o of data.opportunities) {
    const id = str(o.Id);
    if (!isSalesforceId(id)) continue;
    const stageLabel = str(o.StageName);
    const stageNum = stageLabel && /^([1-6])\b/.exec(stageLabel)?.[1];
    const fields: Record<string, unknown> = {
      name: str(o.Name) ?? id,
      stage_label: stageLabel,
      ...(stageNum ? { stage: Number(stageNum) } : {}),
      close_date: day(o.CloseDate),
      tcv_usd: num(o.Amount),
      next_step: str(o.NextStep),
      status: o.IsClosed ? (o.IsWon ? "won" : "lost") : "open",
    };
    const current = deals.get(id) as Record<string, unknown> | undefined;
    if (!current) {
      drafts.push({ entity_type: "deal", op: "create", payload: { deal_id: id, ...fields }, rationale: "In Salesforce and not on the account.", source_ref: ref(id, "opportunity") });
      continue;
    }
    const patch = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== null && v !== (current[k] ?? null)));
    if (Object.keys(patch).length) drafts.push({ entity_type: "deal", op: "update", entity_id: id, payload: patch, rationale: `Salesforce has a different ${Object.keys(patch).join(", ").replace(/_/g, " ")}.`, source_ref: ref(id, "opportunity") });
  }
  const people = listContacts(accountId);
  for (const c of data.contacts) {
    const name = str(c.Name);
    if (!name) continue;
    const email = str(c.Email)?.toLowerCase() ?? null;
    const known = people.find((p) => (email && p.email?.toLowerCase() === email) || p.name.trim().toLowerCase() === name.toLowerCase());
    const title = str(c.Title);
    if (!known) drafts.push({ entity_type: "contact", op: "create", payload: { name, title, email, org: "customer" }, rationale: "A contact in Salesforce not yet on the account.", source_ref: ref(c.Id, "contact") });
    else if (title && title !== known.title) drafts.push({ entity_type: "contact", op: "update", entity_id: known.id, payload: { title }, rationale: "Salesforce has a different title.", source_ref: ref(c.Id, "contact") });
  }
  if (data.installed && s.installBase) {
    const ib = s.installBase;
    const latest = new Map(latestInstallBase(accountId).rows.map((r) => [r.product_family.toLowerCase(), r]));
    const byFamily = new Map<string, number>();
    for (const r of data.installed) {
      const family = str(path(r, ib.product));
      if (!family) continue;
      const value = ib.value ? (num(path(r, ib.value)) ?? 0) * (ib.quantity ? (num(path(r, ib.quantity)) ?? 1) : 1) : 0;
      byFamily.set(family, (byFamily.get(family) ?? 0) + value);
    }
    const changed = [...byFamily].some(([f, v]) => latest.get(f.toLowerCase())?.value_usd !== (ib.value ? v : null)) || latest.size !== byFamily.size;
    if (changed) {
      for (const [family, value] of byFamily) {
        drafts.push({ entity_type: "install_base", op: "create", payload: { product_family: family, value_usd: ib.value ? value : null, as_of: today }, rationale: "Installed base as Salesforce has it today.", source_ref: ref(ib.object, "installed base") });
      }
    }
  }
  return drafts;
}

export async function readFromSalesforce(accountId: string, userId: string, now = new Date()): Promise<{ proposals: number }> {
  const account = getAccount(accountId);
  if (!account || account.archived_at) throw new SalesforceError("That account is missing or archived.");
  if (!isSalesforceId(account.crm_id)) throw new SalesforceError("Put the account's Salesforce id in its CRM ID (Details) first.");
  const s = salesforceSettings();
  try {
    const client = salesforceClient(s);
    const acct = soqlString(account.crm_id);
    const opportunities = await client.query(`SELECT Id, Name, StageName, Amount, CloseDate, NextStep, IsClosed, IsWon FROM Opportunity WHERE AccountId = ${acct} AND (IsClosed = false OR CloseDate = LAST_N_DAYS:365) ORDER BY CloseDate LIMIT 200`);
    const contacts = await client.query(`SELECT Id, Name, Title, Email FROM Contact WHERE AccountId = ${acct} ORDER BY LastModifiedDate DESC LIMIT 200`);
    const ib = s.installBase;
    const installed = ib ? await client.query(`SELECT ${[...new Set(["Id", ib.product, ib.value, ib.quantity].filter((x): x is string => !!x))].join(", ")} FROM ${ib.object} WHERE AccountId = ${acct} LIMIT 2000`) : null;
    const drafts = salesforceDrafts(accountId, { opportunities, contacts, installed }, s, todayISO(now));
    const batch = drafts.length ? createProposalBatch(accountId, { kind: "import", id: "salesforce", aiRunId: null }, drafts) : { ids: [] };
    log({ account_id: accountId, direction: "read", summary: `Read ${opportunities.length} opportunities, ${contacts.length} contacts${installed ? `, ${installed.length} installed items` : ""}; ${batch.ids.length} proposed.`, status: "done", error: null, user_id: userId });
    return { proposals: batch.ids.length };
  } catch (e) {
    log({ account_id: accountId, direction: "read", summary: "The read failed.", status: "failed", error: e instanceof Error ? e.message : String(e), user_id: userId });
    throw e;
  }
}

/** Exactly what would be written to the opportunity, from the scorecard as it stands. */
export function qualificationPayload(rows: ScoreRow[], s: SalesforceSettings, asOf: string): Record<string, string> | null {
  const word = (r: ScoreRow) => `[${r.status[0]!.toUpperCase()}${r.status.slice(1)}] ${r.evidence || "—"}`;
  const out: Record<string, string> = {};
  for (const r of rows) {
    const field = s.qualification.fields[r.element];
    if (field) out[field] = word(r).slice(0, 255);
  }
  if (s.qualification.combined) out[s.qualification.combined] = [`MEDDPICC (${asOf})`, ...rows.map((r) => `${MEDDPICC_LABELS[r.element]}: ${word(r)}`)].join("\n").slice(0, 32000);
  return Object.keys(out).length ? out : null;
}

export async function sendQualification(accountId: string, opportunityId: string, userId: string, now = new Date()): Promise<{ fields: number }> {
  const account = getAccount(accountId);
  if (!account) throw new SalesforceError("That account is missing.");
  if (!isSalesforceId(opportunityId) || !listDeals(accountId).some((d) => d.deal_id === opportunityId)) throw new SalesforceError("Choose one of this account's Salesforce opportunities.");
  const s = salesforceSettings();
  const payload = qualificationPayload(scorecard(account), s, todayISO(now));
  if (!payload) throw new SalesforceError("No Salesforce fields are named for the scorecard. Name them under Settings, Salesforce.");
  try {
    await salesforceClient(s).update("Opportunity", opportunityId, payload);
    log({ account_id: accountId, direction: "write", summary: `Wrote the qualification scorecard to opportunity ${opportunityId}.`, payload, status: "done", error: null, user_id: userId });
    return { fields: Object.keys(payload).length };
  } catch (e) {
    log({ account_id: accountId, direction: "write", summary: `Writing the scorecard to opportunity ${opportunityId} failed.`, payload, status: "failed", error: e instanceof Error ? e.message : String(e), user_id: userId });
    throw e;
  }
}
