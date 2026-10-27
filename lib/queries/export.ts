// What each export contains.
//
// Separate from the routes so the shape can be tested without a request, and
// separate from the queries so that neither the pipeline page nor the account
// page has to grow an opinion about spreadsheets.
//
// Raw values throughout: numbers as numbers, dates as YYYY-MM-DD, empty where
// the record is empty. Every formatting helper in lib/format.ts is wrong here,
// which is the point of writing it down.
import { getAccount, listContacts, listDeals, listOpenDeals, type DealStatusFilter, type ListOpts } from "./accounts";
import { listActionItems, listOpenFollowUps } from "./meetings";
import type { OwnerScope } from "./owner";
import { toCsv } from "../csv";
import { quarterLabel } from "../fiscal";

export type Sheet = { headers: string[]; rows: Array<Array<string | number | null>> };

// The cross-account pipeline, filtered exactly as the page filters it.
//
// The quarter is derived rather than stored for most deals, so the page does
// that filter in JS (app/pipeline/page.tsx) rather than in SQL. This mirrors
// it deliberately: an export that quietly used a different rule from the
// screen it was reached from would be worse than no export.
export function pipelineSheet(filter: {
  stage?: number;
  owner?: string;
  accountId?: string;
  fq?: string;
  status?: DealStatusFilter;
  scope?: OwnerScope;
}): Sheet {
  const all = listOpenDeals({
    stage: filter.stage,
    owner: filter.owner,
    accountId: filter.accountId,
    status: filter.status,
    scope: filter.scope,
  });
  // The same quarter spelling the pipeline groups by, so the export holds what the screen showed.
  const deals = filter.fq ? all.filter((d) => quarterLabel(d.fiscal_quarter) === quarterLabel(filter.fq)) : all;
  return {
    headers: [
      "account",
      "deal_id",
      "name",
      "stage",
      "stage_label",
      "close_date",
      "fiscal_quarter",
      "tcv_usd",
      "owner",
      "competitor",
      "partner",
      "architecture",
      "next_step",
      "notes",
      "status",
    ],
    rows: deals.map((d) => [
      d.account_name,
      // The raw id, including an app-issued local- one. crmIdText() hides
      // those because printing one at a customer would be worse than saying
      // nothing — but a spreadsheet is a working document, and a row with no
      // identifier in it cannot be matched back to anything.
      d.deal_id,
      d.name,
      d.stage,
      d.stage_label,
      d.close_date,
      d.fiscal_quarter,
      d.tcv_usd,
      d.owner,
      d.competitor,
      d.partner,
      d.architecture,
      d.next_step,
      d.notes,
      d.status,
    ]),
  };
}

export function accountDealsSheet(accountId: string, opts?: ListOpts): Sheet {
  return {
    headers: ["deal_id", "name", "stage", "stage_label", "close_date", "fiscal_quarter", "tcv_usd", "owner", "competitor", "partner", "architecture", "next_step", "notes", "status", "archived_at"],
    rows: listDeals(accountId, opts).map((d) => [
      d.deal_id,
      d.name,
      d.stage,
      d.stage_label,
      d.close_date,
      d.fiscal_quarter,
      d.tcv_usd,
      d.owner,
      d.competitor,
      d.partner,
      d.architecture,
      d.next_step,
      d.notes,
      d.status,
      d.archived_at ?? null,
    ]),
  };
}

export function accountContactsSheet(accountId: string, opts?: ListOpts): Sheet {
  return {
    headers: ["name", "title", "org", "role", "email", "notes", "archived_at"],
    rows: listContacts(accountId, opts).map((c) => [c.name, c.title, c.org, c.role, c.email, c.notes, c.archived_at ?? null]),
  };
}

// Open follow-ups: one account's, or everyone's.
//
// `owner` is what the notes said and can be anybody, including someone at the
// customer; `owner_user_id` is one of the two of us or nothing. Both columns,
// because dropping either loses something a person would want to sort on.
export function followUpsSheet(accountId?: string): Sheet {
  const rows = accountId
    ? listActionItems(accountId, { status: "open" }).map((i) => ({ ...i, account_name: getAccount(accountId)?.name ?? "" }))
    : listOpenFollowUps({});
  return {
    headers: ["account", "text", "owner", "owner_user_id", "due", "status"],
    rows: rows.map((i) => [i.account_name, i.text, i.owner, i.owner_user_id ?? null, i.due, i.status]),
  };
}

export function sheetToCsv(sheet: Sheet): string {
  return toCsv(sheet.headers, sheet.rows);
}
