// Which account an event is about, decided by code from who is invited
// (DECISIONS #27). In order:
//   1. Nobody from outside: an internal event. Skipped and counted.
//   2. An invited address is a contact's: that contact's account. When
//      contacts from two accounts are invited, the one with more wins; a tie
//      is a question.
//   3. An invited address shares a domain with one account's contacts: that
//      account. A domain two accounts share is a question.
//   4. Otherwise: a question, "Which account?".
// Public mail domains never identify an account.
import type { CalEvent } from "./types";

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "web.de", "mail.com", "zoho.com", "fastmail.com", "hey.com", "yandex.com",
]);

export type MatchIndex = {
  /** Lower-cased email to the accounts that have a contact with it. */
  byEmail: Map<string, Array<{ accountId: string; contactName: string }>>;
  /** Domain to the accounts whose contacts use it. */
  byDomain: Map<string, Set<string>>;
  internalDomains: Set<string>;
  freeMail: Set<string>;
  accountNames: Map<string, string>;
};

export const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

export function buildIndex(input: {
  contacts: Array<{ accountId: string; email: string | null; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  internalDomains: Iterable<string>;
  /** Public mail domains; FREE_MAIL unless a test supplies its own. */
  freeMail?: Set<string>;
}): MatchIndex {
  const freeMail = input.freeMail ?? FREE_MAIL;
  const live = new Map(input.accounts.map((a) => [a.id, a.name]));
  const internal = new Set([...input.internalDomains].map((d) => d.toLowerCase()));
  const byEmail = new Map<string, Array<{ accountId: string; contactName: string }>>();
  const byDomain = new Map<string, Set<string>>();
  for (const c of input.contacts) {
    const email = c.email?.trim().toLowerCase();
    if (!email || !email.includes("@") || !live.has(c.accountId)) continue;
    const list = byEmail.get(email) ?? [];
    if (!list.some((x) => x.accountId === c.accountId)) list.push({ accountId: c.accountId, contactName: c.name });
    byEmail.set(email, list);
    const d = domainOf(email);
    if (freeMail.has(d) || internal.has(d)) continue;
    const set = byDomain.get(d) ?? new Set<string>();
    set.add(c.accountId);
    byDomain.set(d, set);
  }
  return { byEmail, byDomain, internalDomains: internal, freeMail, accountNames: live };
}

export type Match =
  | { kind: "internal" }
  | { kind: "account"; accountId: string; reason: string }
  | { kind: "question"; reason: string; candidates: string[] };

export function matchEvent(e: Pick<CalEvent, "attendees" | "organizer">, index: MatchIndex, ownAddresses: Iterable<string> = []): Match {
  const own = new Set([...ownAddresses].map((a) => a.toLowerCase()));
  const everyone = [...e.attendees, ...(e.organizer ? [e.organizer] : [])].filter((p) => !own.has(p.email));
  const outside = everyone.filter((p) => !index.internalDomains.has(domainOf(p.email)));
  if (outside.length === 0) return { kind: "internal" };

  const votes = new Map<string, string[]>();
  for (const p of outside) for (const hit of index.byEmail.get(p.email) ?? []) votes.set(hit.accountId, [...(votes.get(hit.accountId) ?? []), hit.contactName]);
  if (votes.size > 0) {
    const ranked = [...votes].sort((a, b) => b[1].length - a[1].length);
    if (ranked.length === 1 || ranked[0]![1].length > ranked[1]![1].length) {
      const [accountId, names] = ranked[0]!;
      return { kind: "account", accountId, reason: names.length === 1 ? `${names[0]} is invited` : `${names.length} of its contacts are invited` };
    }
    return { kind: "question", reason: "Contacts from more than one account are invited", candidates: ranked.filter((r) => r[1].length === ranked[0]![1].length).map((r) => r[0]) };
  }

  const domains = [...new Set(outside.map((p) => domainOf(p.email)).filter((d) => !index.freeMail.has(d)))];
  const accounts = new Set<string>();
  let via = "";
  for (const d of domains) {
    for (const a of index.byDomain.get(d) ?? []) {
      accounts.add(a);
      via = d;
    }
  }
  if (accounts.size === 1) return { kind: "account", accountId: [...accounts][0]!, reason: `someone from ${via} is invited` };
  if (accounts.size > 1) return { kind: "question", reason: `${via} is used by more than one account`, candidates: [...accounts] };
  return { kind: "question", reason: domains.length ? `nobody from ${domains.slice(0, 2).join(" or ")} is a contact yet` : "only personal addresses are invited", candidates: [] };
}

// Time off, from a person's own calendar only: the calendar says out of
// office, or it is an all-day block whose title says so.
const OFF_WORDS = /\b(out of (the )?office|ooo|pto|vacation|holiday|annual leave|parental leave|sick|day off|time off|off work)\b/i;

export function isTimeOff(e: Pick<CalEvent, "busy" | "outOfOffice" | "allDay" | "title" | "cancelled">): boolean {
  if (e.cancelled) return false;
  if (e.busy === "oof" || e.outOfOffice) return true;
  return e.allDay && OFF_WORDS.test(e.title);
}
