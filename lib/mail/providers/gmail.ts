// Gmail through a Google service account with domain-wide delegation: the
// app reads as the person (`sub`), with gmail.readonly only. A Workspace admin
// grants it (deploy/.env.example). The app reads only the mailboxes people
// switched on here.
import { googleAuth, googleConfigured, json } from "../../calendar/providers";
import { htmlToText, MailError, type MailMessage, type MailPerson, type MailProvider } from "../types";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const MAX = 200;

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
type GmailMessage = { id: string; threadId: string; internalDate: string; payload?: Part & { headers?: Array<{ name: string; value: string }> } };

const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");

function findPart(p: Part | undefined, type: string): Part | null {
  if (!p) return null;
  if (p.mimeType === type && p.body?.data) return p;
  for (const c of p.parts ?? []) {
    const hit = findPart(c, type);
    if (hit) return hit;
  }
  return null;
}

/** "Name <a@b.c>, d@e.f" → people. */
export function parseAddresses(header: string | undefined): MailPerson[] {
  if (!header) return [];
  return header
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => {
      const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(part) ?? null;
      const email = (m ? m[2]! : part).trim().toLowerCase();
      return /@/.test(email) ? { email, name: m?.[1]?.trim() || null } : null;
    })
    .filter((p): p is MailPerson => !!p);
}

export function fromGmailMessage(m: GmailMessage): MailMessage | null {
  const headers = new Map((m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const from = parseAddresses(headers.get("from"))[0];
  if (!from) return null;
  const plain = findPart(m.payload, "text/plain");
  const html = plain ? null : findPart(m.payload, "text/html");
  return {
    id: m.id,
    thread: m.threadId,
    from,
    to: parseAddresses(headers.get("to")),
    cc: parseAddresses(headers.get("cc")),
    subject: (headers.get("subject") ?? "").trim() || "(no subject)",
    receivedAt: Number(m.internalDate),
    body: plain ? decode(plain.body?.data).trim() : html ? htmlToText(decode(html.body?.data)) : "",
  };
}

export const gmailMail: MailProvider = {
  async list(mailbox, sinceMs) {
    const problem = googleConfigured();
    if (problem) throw new MailError(problem);
    const token = await googleAuth(GMAIL_SCOPE, mailbox);
    const auth = { authorization: `Bearer ${token}` };
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`after:${Math.floor(sinceMs / 1000)}`);
      const res = await fetch(`${GMAIL}/${encodeURIComponent(mailbox)}/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: auth, signal: AbortSignal.timeout(30_000) });
      const data = await json<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(res, "Gmail");
      ids.push(...(data.messages ?? []).map((x) => x.id));
      pageToken = data.nextPageToken;
    } while (pageToken && ids.length < MAX);
    const out: MailMessage[] = [];
    for (const id of ids.slice(0, MAX)) {
      const res = await fetch(`${GMAIL}/${encodeURIComponent(mailbox)}/messages/${id}?format=full`, { headers: auth, signal: AbortSignal.timeout(30_000) });
      const msg = fromGmailMessage(await json<GmailMessage>(res, "Gmail"));
      if (msg) out.push(msg);
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt);
  },
};
