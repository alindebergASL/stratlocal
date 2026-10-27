// What a conversation is about, when it started from somewhere in particular:
// a record ("Ask about this" on a deal, a play, a meeting, a person or a
// follow-up), or the page someone was on when they asked from ⌘K.
//
// A focus is resolved against the records every time it is used, never
// trusted as stored: a record that has gone, or moved account, is simply no
// focus. A page focus is only ever a path inside this app, described in plain
// words with every value cut short and stripped to safe characters — it goes
// into the system prompt, and a URL is text anyone can type.
import { db } from "../db";
import { getAccount } from "../queries/accounts";
import type { AskFocus, FocusKind } from "./focusPath";
export { focusForPath, focusParam, parseFocus, type AskFocus, type FocusKind } from "./focusPath";

export type ResolvedFocus = { focus: AskFocus; label: string; href: string; accountId: string | null; recordAccountId?: string; prompt: string };

const RECORD: Record<Exclude<FocusKind, "page">, { table: string; pk: string; name: string; noun: string }> = {
  deal: { table: "deals", pk: "deal_id", name: "name", noun: "deal" },
  play: { table: "plays", pk: "id", name: "title", noun: "play" },
  meeting: { table: "meetings", pk: "id", name: "title", noun: "meeting" },
  contact: { table: "contacts", pk: "id", name: "name", noun: "person" },
  action_item: { table: "action_items", pk: "id", name: "text", noun: "follow-up" },
};

const PAGE_NAMES: Array<[RegExp, string]> = [
  [/^\/pipeline\/owners/, "deal owner names"],
  [/^\/pipeline/, "pipeline"],
  [/^\/follow-ups\/sort/, "follow-up sorting"],
  [/^\/follow-ups/, "tasks (follow-ups across every account)"],
  [/^\/activity/, "what changed (activity)"],
  [/^\/promises/, "promises"],
  [/^\/calendar/, "calendar"],
  [/^\/plans/, "plan check-in"],
  [/^\/handoff/, "cover while away"],
  [/^\/search/, "search results"],
  [/^\/reports/, "reports"],
  [/^\/assistants/, "assistants"],
  [/^\/accounts\/[^/]+\/deals/, "the account's deals tab"],
  [/^\/accounts\/[^/]+\/plays/, "the account's plan tab"],
  [/^\/accounts\/[^/]+\/people/, "the account's people tab"],
  [/^\/accounts\/[^/]+\/meetings/, "the account's meetings tab"],
  [/^\/accounts\/[^/]+\/follow-ups/, "the account's follow-ups tab"],
  [/^\/accounts\/[^/]+\/research/, "the account's research tab"],
  [/^\/accounts\/[^/]+\/details/, "the account's details tab"],
  [/^\/accounts\/[^/]+\/review/, "the account's proposed changes"],
  [/^\/accounts\/[^/]+$/, "the account's overview"],
  [/^\/accounts$/, "the list of accounts"],
];

const PARAM_WORDS: Record<string, string> = {
  fq: "fiscal quarter",
  stage: "stage",
  owner: "deal owner",
  status: "status",
  moved: "moved in the last N days",
  hand: "hand edits only",
  who: "whose (mine, theirs, shared)",
  days: "last N days",
  q: "search words",
  account: "account id",
  all: "show all",
};

const safe = (s: string) => s.replace(/[^\p{L}\p{N} .:/_@-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);

function describePage(pathAndQuery: string): { name: string; filters: string[]; accountId: string | null } {
  const url = new URL(pathAndQuery, "http://app.invalid");
  const name = PAGE_NAMES.find(([re]) => re.test(url.pathname))?.[1] ?? "a page in the app";
  const filters = [...url.searchParams.entries()].slice(0, 8).map(([k, v]) => `${PARAM_WORDS[k] ?? safe(k)}: ${safe(v)}`);
  const onAccount = /^\/accounts\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  const account = onAccount ? getAccount(onAccount) : null;
  return { name, filters, accountId: account && account.kind === "customer" ? account.id : null };
}

export function resolveFocus(focus: AskFocus | null, expectedAccountId?: string | null): ResolvedFocus | null {
  if (!focus) return null;
  if (focus.kind === "page") {
    const page = describePage(focus.id);
    if (expectedAccountId !== undefined && page.accountId !== expectedAccountId) return null;
    const account = page.accountId ? getAccount(page.accountId) : null;
    const where = account ? ` on the account "${account.name}" (account_id ${account.id})` : "";
    return {
      focus,
      label: `${page.name[0]!.toUpperCase()}${page.name.slice(1)}${page.filters.length ? ` · ${page.filters.join(", ")}` : ""}`,
      href: focus.id,
      accountId: page.accountId,
      prompt: `The question was asked from ${page.name}${where}${page.filters.length ? `, filtered to ${page.filters.join("; ")}` : ""}. "This", "these" and "here" mean what that page shows: look it up first with the matching tool and the same filters.`,
    };
  }
  const t = RECORD[focus.kind];
  const row = db().prepare(`SELECT account_id, ${t.name} AS name, archived_at FROM ${t.table} WHERE ${t.pk} = ?`).get(focus.id) as
    | { account_id: string; name: string; archived_at: string | null }
    | undefined;
  if (!row || row.archived_at) return null;
  const account = getAccount(row.account_id);
  if (!account) return null;
  if (expectedAccountId !== undefined && (account.kind === "customer" ? account.id : null) !== expectedAccountId) return null;
  const label = row.name.length > 80 ? `${row.name.slice(0, 78)}…` : row.name;
  const href =
    focus.kind === "action_item"
      ? `/follow-ups/${focus.id}`
      : `/accounts/${account.id}/${{ deal: "deals", play: "plays", meeting: "meetings", contact: "contacts" }[focus.kind]}/${encodeURIComponent(focus.id)}`;
  return {
    focus,
    label: `${t.noun[0]!.toUpperCase()}${t.noun.slice(1)}: ${label}`,
    href,
    accountId: account.kind === "customer" ? account.id : null,
    recordAccountId: account.id,
    prompt: `This conversation is about the ${t.noun} "${safe(label)}" (${t.pk === "deal_id" ? "deal_id" : "id"} ${focus.id}) on the account "${account.name}" (account_id ${account.id}). Read the account first; questions are about this ${t.noun} unless they say otherwise.`,
  };
}
