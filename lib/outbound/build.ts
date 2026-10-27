// Drafts made by code from what is on file (DECISIONS #103): the recap of a
// meeting, an invite to it, and a chaser for a promise a customer made. No
// model is called here. Each is only a draft: the person reads it, can edit
// every word and every recipient, and sends it or not.
import { db } from "../db";
import { getAccount, listContacts } from "../queries/accounts";
import { getMeeting } from "../queries/meetings";
import { latestRecapRun, meetingAttendees } from "../meetings/run";
import { recapText } from "../meetings/recap";
import { fmtDay } from "../format";
import { createDraft, DraftError, type OutboundDraft, type Recipient } from "./drafts";

const contactRecipient = (c: { id: string; name: string; email: string | null }): Recipient | null => (c.email ? { email: c.email, name: c.name, contactId: c.id } : null);

/** The meeting's recap as a draft to the customer attendees with an address. */
export function draftFromRecap(accountId: string, meetingId: string, userId: string, sender: string): OutboundDraft {
  const recap = latestRecapRun(accountId, meetingId)?.recap;
  if (!recap) throw new DraftError("Draft the recap first.");
  const contacts = listContacts(accountId);
  const to = recap.to
    .map((name) => contacts.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()))
    .map((c) => (c ? contactRecipient(c) : null))
    .filter((r): r is Recipient => !!r);
  if (to.length === 0) throw new DraftError("None of the people the recap is for has an email address on file. Add one on their page, or type it in the draft.");
  return createDraft({ userId, accountId, kind: "email", source: "recap", sourceId: meetingId, to, subject: recap.subject, body: recapText(recap, sender) });
}

/** An invite to a meeting on file, to its customer attendees with an address. */
export function draftInvite(accountId: string, meetingId: string, userId: string): OutboundDraft {
  const meeting = getMeeting(meetingId);
  if (!meeting || meeting.account_id !== accountId) throw new DraftError("No such meeting.");
  const contacts = new Map(listContacts(accountId).map((c) => [c.id, c]));
  const to = meetingAttendees(meeting)
    .map((a) => (a.contact_id ? contacts.get(a.contact_id) : undefined))
    .filter((c): c is NonNullable<typeof c> => !!c && c.org === "customer")
    .map(contactRecipient)
    .filter((r): r is Recipient => !!r);
  if (to.length === 0) throw new DraftError("Nobody from the customer on this meeting has an email address on file. Add one on their page, or type it in the draft.");
  const account = getAccount(accountId);
  return createDraft({
    userId,
    accountId,
    kind: "invite",
    source: "meeting",
    sourceId: meetingId,
    to,
    subject: meeting.title,
    // Never the brief: it is ours, not theirs. A line to replace.
    body: `${meeting.title}${account ? ` · ${account.name}` : ""}\n\nAgenda to follow.`,
    startsAt: `${meeting.held_at}T${meeting.held_time ?? "09:00"}`,
    minutes: 30,
  });
}

/** A polite chaser for something a customer said they would do. */
export function draftChaser(actionItemId: string, userId: string, sender: string): OutboundDraft {
  const item = db().prepare(`SELECT id, account_id, text, owner, due FROM action_items WHERE id = ? AND archived_at IS NULL`).get(actionItemId) as
    | { id: string; account_id: string; text: string; owner: string | null; due: string | null }
    | undefined;
  if (!item) throw new DraftError("No such follow-up.");
  const owner = (item.owner ?? "").trim().toLowerCase();
  const contact = owner ? listContacts(item.account_id).find((c) => c.org === "customer" && (c.name.trim().toLowerCase() === owner || c.name.trim().toLowerCase().split(/\s+/)[0] === owner)) : undefined;
  const to = contact ? contactRecipient(contact) : null;
  if (!to) throw new DraftError("Whoever owes this has no email address on file. Add one on their page, or type it in the draft.");
  const first = contact!.name.trim().split(/\s+/)[0];
  const what = item.text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const when = item.due ? `, which you mentioned for ${fmtDay(item.due)}` : "";
  return createDraft({
    userId,
    accountId: item.account_id,
    kind: "email",
    source: "promise",
    sourceId: item.id,
    to: [to],
    subject: `Checking in: ${what.length > 60 ? `${what.slice(0, 57)}…` : what}`,
    body: `Hi ${first},\n\nJust checking in on ${what.charAt(0).toLowerCase()}${what.slice(1)}${when}. Is there anything you need from us?\n\nBest,\n${sender}`,
  });
}
