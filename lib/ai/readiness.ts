// What a run needs before it is worth paying for, decided in one place so the
// button can be disabled with the reason showing rather than the server
// refusing after the press.
//
// The prerequisites used to live only inside the run functions, reaching the
// user as an HTTP 429 and a line of red text — and two of the four billable
// actions had no prerequisite at all: you could bill a brief over an empty
// account, and the plan-draft guard passed with a single contact and nothing
// else, which is enough for the model to invent three-to-six plays out of an
// account name.
import { listContacts, listDeals, listPlays, getAccount } from "../queries/accounts";
import { listNotes, keptFindings } from "../research/notes";
import type { MeetingRow } from "../db";
import { listActionItems } from "../queries/meetings";

export type Readiness = string | null;

// A plan is drafted from what is on file. A name and a region is not enough
// to build one from, and the model will produce plays regardless if asked.
export function planReadiness(accountId: string): Readiness {
  const account = getAccount(accountId);
  if (!account) return "That account no longer exists.";
  if (account.archived_at) return "That account is archived.";
  const has =
    listDeals(accountId).length > 0 ||
    listPlays(accountId).length > 0 ||
    listNotes(accountId, "accepted").some((n) => keptFindings(n.meta).length > 0) ||
    (account.thesis ?? "").trim().length > 0;
  // Contacts alone used to be enough. Knowing who someone is is not knowing
  // what to do about them.
  if (!has) {
    return "There is nothing to draft a plan from yet. Import a report, add a deal, or run research first.";
  }
  return null;
}

// A brief is about a conversation with people, built from what the account
// knows. On an empty account it is a paid-for page of nothing.
export function briefReadiness(meeting: MeetingRow): Readiness {
  const accountId = meeting.account_id;
  if (meeting.archived_at) return "That meeting is archived.";
  const somethingToSay =
    listDeals(accountId).length > 0 ||
    listPlays(accountId).length > 0 ||
    listContacts(accountId).length > 0 ||
    listActionItems(accountId).some(t => t.status === "open") ||
    listNotes(accountId, "accepted").some((n) => keptFindings(n.meta).length > 0);
  if (!somethingToSay) {
    return "There is nothing on this account to brief from yet. Add a task, deal or person, import a report, or run research first.";
  }
  return null;
}
