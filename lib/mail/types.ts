// One email as the providers hand it over, before anything is kept.
export type MailPerson = { email: string; name: string | null };
export type MailMessage = {
  /** The provider's own id, unique within the mailbox. */
  id: string;
  /** The provider's conversation id: one thread across replies. */
  thread: string;
  from: MailPerson;
  to: MailPerson[];
  cc: MailPerson[];
  subject: string;
  receivedAt: number;
  /** Plain text. HTML is reduced to text before it gets here. */
  body: string;
};

export type MailKind = "graph" | "gmail" | "fake";

export interface MailProvider {
  /** Messages received since `sinceMs`, newest last, at most a few hundred. */
  list(mailbox: string, sinceMs: number): Promise<MailMessage[]>;
}

export class MailError extends Error {}

/** A plain-text reading of an HTML body: tags out, entities decoded, whitespace tidied. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
