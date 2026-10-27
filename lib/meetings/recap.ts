// The follow-up email after a call, drafted from the notes and never sent.
//
// A seller writes the same email after every meeting: thanks, what we heard,
// what happens next. This drafts it from the notes they just wrote, for them
// to read, change and send from their own mail. Nothing is written to a
// record (it is not a proposal: it changes nothing in the account), and
// nothing leaves the app except through the person's own mail client.
//
// The guards are the extraction's: every point quotes the notes, checked in
// code; a recipient must be someone the meeting records as attending. Where
// the email needs a fact the notes do not give — a date, a name — the draft
// says so in square brackets instead of inventing one.
import { z } from "zod";
import type { StageUsage } from "../ai/cost";
import { containsQuote, UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";

const Point = z.object({
  text: z.string().min(3).max(400),
  quote: z.string().min(4).max(1000),
});

export const MeetingRecap = z.object({
  to: z.array(z.string().min(1).max(120)).max(12),
  subject: z.string().min(3).max(140),
  greeting: z.string().min(2).max(120),
  opening: z.string().max(400),
  points: z.array(Point).min(1).max(8),
  next_steps: z.array(Point).max(6),
  closing: z.string().max(300),
});
export type MeetingRecap = z.infer<typeof MeetingRecap>;

export function readRecap(raw: unknown): MeetingRecap | null {
  const parsed = MeetingRecap.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const SYSTEM = `You draft the short follow-up email a seller sends a customer after a meeting, from the seller's own notes.

${UNTRUSTED_RULES}

Write as the seller, to the customer attendees. Plain, warm and brief: no marketing language, no superlatives, no sign-off name (the seller adds their own).

Produce:
- to: the customer attendees to address, by the exact names in the attendee list. Leave out the seller's own side.
- subject: a short, specific subject line.
- greeting: e.g. "Hi Priya, Tom,".
- opening: one sentence of thanks or context.
- points: what was agreed or learned, one sentence each, in the seller's voice.
- next_steps: who does what next, as the notes say it. A commitment the customer made is phrased as theirs.
- closing: one short closing sentence.

Rules specific to this task:
- Every point and next step must carry a quote copied verbatim from the notes that supports it. Something you cannot quote does not go in the email.
- Never invent a date, a price, a number, a name or a commitment. Where the email needs one the notes do not give, write a placeholder in square brackets, such as [pick a week], and keep it short.
- Do not include anything the notes mark as internal: pricing strategy, opinions about people, the competition.`;

export type RecapInput = {
  notes: string;
  title: string;
  heldAt: string;
  accountName: string;
  attendees: string[];
};

export function checkRecap(recap: MeetingRecap, input: Pick<RecapInput, "notes" | "attendees">): Finding[] {
  const out: Finding[] = [];
  const names = new Set(input.attendees.map((a) => a.trim().toLowerCase()));
  recap.to.forEach((n, i) => {
    if (!names.has(n.trim().toLowerCase())) out.push({ path: `to[${i}]`, message: `"${n}" is not in the attendee list. Use exact attendee names only.` });
  });
  for (const key of ["points", "next_steps"] as const) {
    recap[key].forEach((p, i) => {
      if (!containsQuote(input.notes, p.quote)) out.push({ path: `${key}[${i}].quote`, message: "This quote does not appear in the notes. Copy it verbatim, or leave the point out." });
    });
  }
  return out;
}

export async function draftRecap(input: RecapInput, stages: StageUsage[]): Promise<{ recap: MeetingRecap; attempts: number }> {
  const user = [
    `Account: ${input.accountName}`,
    `Meeting: ${input.title} (${input.heldAt.slice(0, 10)})`,
    `Attendees: ${input.attendees.length ? input.attendees.join(", ") : "none recorded"}`,
    "",
    wrapUntrusted("meeting_notes", input.notes, { meeting_title: input.title, held_at: input.heldAt }),
  ].join("\n");
  const { data, attempts } = await runStructured({
    role: "meeting_recap",
    stageName: "recap",
    system: SYSTEM,
    user,
    schema: MeetingRecap,
    effort: "medium",
    maxTokens: 4000,
    check: (r) => checkRecap(r, input),
    fakeContext: { notes: input.notes, attendees: input.attendees },
    stages,
  });
  return { recap: data, attempts };
}

// The draft as plain text, for the clipboard and for a mail client. The
// seller's name is added here, by the app, never by the model.
export function recapText(r: MeetingRecap, sender: string): string {
  const lines = [r.greeting, "", r.opening, ""];
  if (r.points.length) lines.push(...r.points.map((p) => `- ${p.text}`), "");
  if (r.next_steps.length) lines.push("Next steps:", ...r.next_steps.map((p) => `- ${p.text}`), "");
  lines.push(r.closing, "", "Best,", sender);
  return lines.filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n").trim();
}

// Some mail clients and Windows drop a mailto link much past 2,000
// characters, or open it empty. A draft too long for that opens the message
// with only the address and subject; the person copies the text in.
export const MAILTO_LIMIT = 1900;

export function recapMailto(emails: readonly string[], subject: string, body: string): { href: string; withBody: boolean } {
  const head = `mailto:${emails.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}`;
  const full = `${head}&body=${encodeURIComponent(body)}`;
  return full.length <= MAILTO_LIMIT ? { href: full, withBody: true } : { href: head, withBody: false };
}
