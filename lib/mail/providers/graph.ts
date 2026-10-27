// Outlook mail through Microsoft Graph, read with the app registration the
// calendar already uses. IT grants Mail.Read and limits it to the named
// mailboxes with an application access policy (deploy/.env.example).
import { graphAuth, graphConfigured, json } from "../../calendar/providers";
import { htmlToText, MailError, type MailMessage, type MailPerson, type MailProvider } from "../types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGES = 10;

type GraphAddress = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  body?: { contentType?: string; content?: string };
};

const person = (a?: GraphAddress): MailPerson | null => (a?.emailAddress?.address ? { email: a.emailAddress.address.trim().toLowerCase(), name: a.emailAddress.name ?? null } : null);

export function fromGraphMessage(m: GraphMessage): MailMessage | null {
  const from = person(m.from);
  if (!from) return null;
  const content = m.body?.content ?? "";
  return {
    id: m.id,
    thread: m.conversationId ?? m.id,
    from,
    to: (m.toRecipients ?? []).map(person).filter((p): p is MailPerson => !!p),
    cc: (m.ccRecipients ?? []).map(person).filter((p): p is MailPerson => !!p),
    subject: (m.subject ?? "").trim() || "(no subject)",
    receivedAt: Date.parse(m.receivedDateTime),
    body: m.body?.contentType === "html" ? htmlToText(content) : content.trim(),
  };
}

export const graphMail: MailProvider = {
  async list(mailbox, sinceMs) {
    const problem = graphConfigured();
    if (problem) throw new MailError(problem);
    const token = await graphAuth();
    const since = new Date(sinceMs).toISOString();
    let url: string | null =
      `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` +
      `&$orderby=receivedDateTime asc&$top=50&$select=id,conversationId,subject,receivedDateTime,from,toRecipients,ccRecipients,body`;
    const out: MailMessage[] = [];
    for (let page = 0; url && page < PAGES; page++) {
      const res: Response = await fetch(url, { headers: { authorization: `Bearer ${token}`, prefer: 'outlook.body-content-type="text"' }, signal: AbortSignal.timeout(30_000) });
      const data: { value: GraphMessage[]; "@odata.nextLink"?: string } = await json(res, "Outlook mail");
      for (const m of data.value) {
        const msg = fromGraphMessage(m);
        if (msg) out.push(msg);
      }
      url = data["@odata.nextLink"] ?? null;
    }
    return out;
  },
};
