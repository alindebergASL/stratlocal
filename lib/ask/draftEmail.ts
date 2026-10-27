// Ask may draft an email; it never sends one (DECISIONS #103). The draft is
// addressed only to people on the account that this question actually read,
// with the address on file, and waits in the person's Inbox under To send,
// where they read it, change it and send it or not.
import { z } from "zod";
import { listContacts } from "../queries/accounts";
import { ApplyError } from "../proposals/apply";
import { createDraft, DraftError } from "../outbound/drafts";
import type { ToolContext, ToolResult } from "./tools";

export const DraftEmail = z.object({
  account_id: z.string().min(1),
  to_contact_ids: z.array(z.string().min(1)).min(1).max(10).describe("Contact ids from what you read this turn; each must have an email address on file."),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000).describe("The whole email in plain text, signed with the asker's name as it appears in the conversation, or unsigned."),
});

export const DRAFT_EMAIL_DESCRIPTION =
  "Draft an email to people on one account, when asked to write or send one. It is saved as a draft in the asker's Inbox to read, change and send themselves; it is never sent by you. Address only contacts you read this turn. Say in the answer that a draft is waiting in the Inbox under To send.";

export function draftEmail(raw: unknown, ctx: ToolContext): ToolResult {
  const input = DraftEmail.parse(raw ?? {});
  if (ctx.webUsed) throw new ApplyError("Nothing was drafted: this question looked at the web.", "validation");
  const contacts = new Map(listContacts(input.account_id).map((c) => [c.id, c]));
  const to = input.to_contact_ids.map((id) => {
    const c = contacts.get(id);
    if (!c || !ctx.cites.get("contact", id)) throw new ApplyError(`Contact ${id} was not read on this account this turn.`, "validation");
    if (!c.email) throw new ApplyError(`${c.name} has no email address on file.`, "validation");
    return { email: c.email, name: c.name, contactId: c.id };
  });
  try {
    const d = createDraft({ userId: ctx.userId, accountId: input.account_id, kind: "email", source: "ask", sourceId: ctx.threadId, to, subject: input.subject, body: input.body });
    return { content: JSON.stringify({ drafted: d.id, to: to.map((r) => r.name), note: "Saved as a draft in the Inbox under To send. Not sent." }), step: `Drafted an email to ${to.map((r) => r.name).join(", ")} (not sent)` };
  } catch (e) {
    if (e instanceof DraftError) throw new ApplyError(e.message, "validation");
    throw e;
  }
}
