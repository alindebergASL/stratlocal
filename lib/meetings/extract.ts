// Pasted meeting notes -> a structured extraction the diff can turn into
// proposals. Two guards run in code, never on the model's word: an id it
// cites must be one we gave it, and a quote it claims must actually appear
// in the notes.
import type { StageUsage } from "../ai/cost";
import { containsQuote, UNTRUSTED_RULES, wrapUntrusted } from "../ai/prompts";
import { runStructured, type Finding } from "../ai/runStructured";
import { packForPrompt, type ContextPack } from "./contextPack";
import { MeetingExtraction } from "./extractSchema";

const SYSTEM = `You read a seller's raw notes from a customer meeting and turn them into changes to records that already exist, plus the follow-ups the notes commit to.

${UNTRUSTED_RULES}

You are given the account's current records as JSON (deals keyed by deal_id, plays, contacts and open action items keyed by id) followed by the notes.

Produce:
- summary: a short factual account of what happened, in the seller's own register. No advice, no invented outcomes.
- action_items: each thing someone committed to do, on either side. Who owns it if the notes say, and a date only if the notes give one. A commitment the customer made counts too: its owner is the customer's name as the notes give it, so it is clear they owe it.
- deal_updates: for a deal already in the records, a new stage (1-6) if the notes say it moved, a new next step, or a note worth keeping. Use the exact deal_id from the records.
- play_updates: for a play already in the records, a status or next step the notes change. Use the exact id from the records.
- contact_updates: a person the notes tell you something new about. If they are already in the records use their id; if they are new, leave contact_id null and give their name, and their org (customer, vendor or partner) if the notes make it clear.

Rules specific to this task:
- You may only update records that appear in the JSON above the notes. If the notes discuss an opportunity or an initiative that is not in the records, do not invent one: capture it as an action item instead.
- Every item must carry a quote copied verbatim from the notes, long enough to locate the claim. An item you cannot quote does not belong in the answer.
- Leave a field null rather than repeating what the record already says. Only report what the notes change.
- A stage moves only if the notes say so. Do not infer a stage from enthusiasm.`;

// Added to the task only when the team has a playbook: a team that does not
// qualify this way is not asked to.
export function qualificationTask(current: Array<{ element: string; label: string; status: string; evidence: string }>): string {
  return `

Also produce:
- qualification: what the notes establish about the deal's qualification, one entry per element they bear on. Elements: ${current.map((c) => `${c.element} (${c.label})`).join(", ")}. "confirmed" only when the notes state it plainly (a named economic buyer, a stated approval step); "partial" when they point to it without settling it. evidence is one sentence in the seller's register. Skip an element the notes add nothing to beyond what is already on file.
Already on file:
${current.map((c) => `- ${c.element} ${c.label}: ${c.status}${c.evidence ? ` — ${c.evidence}` : ""}`).join("\n")}`;
}

export type CheckArgs = { notes: string; ids: Set<string> };

export function checkExtraction(x: MeetingExtraction, args: CheckArgs): Finding[] {
  const findings: Finding[] = [];
  const badQuote = (path: string, q: string) => {
    if (!containsQuote(args.notes, q)) findings.push({ path, message: `the quote ${JSON.stringify(q.slice(0, 60))} does not appear in the notes; quote verbatim or drop the item` });
  };
  const badId = (path: string, id: string, kind: string) => {
    if (!args.ids.has(id)) findings.push({ path, message: `${kind} id "${id}" is not in the records you were given; use an id from the JSON or capture it as an action item` });
  };
  x.action_items.forEach((a, i) => badQuote(`action_items[${i}].quote`, a.quote));
  x.deal_updates.forEach((d, i) => {
    badId(`deal_updates[${i}].deal_id`, d.deal_id, "deal");
    badQuote(`deal_updates[${i}].quote`, d.quote);
  });
  x.play_updates.forEach((p, i) => {
    badId(`play_updates[${i}].play_id`, p.play_id, "play");
    badQuote(`play_updates[${i}].quote`, p.quote);
  });
  x.contact_updates.forEach((c, i) => {
    if (c.contact_id) badId(`contact_updates[${i}].contact_id`, c.contact_id, "contact");
    badQuote(`contact_updates[${i}].quote`, c.quote);
  });
  (x.qualification ?? []).forEach((q, i) => badQuote(`qualification[${i}].quote`, q.quote));
  return findings;
}

// What survives when a retry did not fix it. Dropping beats failing the whole
// run: the rest of the notes still produced useful proposals.
export function sanitizeExtraction(x: MeetingExtraction, args: CheckArgs): { extraction: MeetingExtraction; dropped: string[] } {
  const dropped: string[] = [];
  const quoted = (label: string, q: string) => {
    const ok = containsQuote(args.notes, q);
    if (!ok) dropped.push(`${label} (quote not in the notes)`);
    return ok;
  };
  const known = (label: string, id: string) => {
    const ok = args.ids.has(id);
    if (!ok) dropped.push(`${label} (unknown id ${id})`);
    return ok;
  };
  return {
    extraction: {
      summary: x.summary,
      action_items: x.action_items.filter((a) => quoted(`action item "${a.text.slice(0, 40)}"`, a.quote)),
      deal_updates: x.deal_updates.filter((d) => known(`deal update`, d.deal_id) && quoted(`deal update ${d.deal_id}`, d.quote)),
      play_updates: x.play_updates.filter((p) => known(`play update`, p.play_id) && quoted(`play update`, p.quote)),
      contact_updates: x.contact_updates.filter(
        (c) => (c.contact_id === null || known(`contact update`, c.contact_id)) && quoted(`contact update "${c.name}"`, c.quote),
      ),
      qualification: (x.qualification ?? []).filter((q) => quoted(`qualification ${q.element}`, q.quote)),
    },
    dropped,
  };
}

export type ExtractOutcome = { extraction: MeetingExtraction; attempts: number; dropped: string[] };

export async function extractMeetingNotes(
  input: { notes: string; pack: ContextPack; ids: Set<string>; title: string; heldAt: string; qualification?: string },
  stages: StageUsage[],
): Promise<ExtractOutcome> {
  const user = `Account records:\n${packForPrompt(input.pack)}\n\nNotes from the meeting to read:\n${wrapUntrusted("meeting_notes", input.notes, {
    meeting_title: input.title,
    held_at: input.heldAt,
  })}`;
  const args: CheckArgs = { notes: input.notes, ids: input.ids };
  const { data, attempts } = await runStructured({
    role: "meeting_extract",
    stageName: "meeting_extract",
    system: SYSTEM + (input.qualification ?? ""),
    user,
    schema: MeetingExtraction,
    effort: "medium",
    maxTokens: 12000,
    check: (parsed) => checkExtraction(parsed, args),
    fakeContext: { notes: input.notes, pack: input.pack, qualification: !!input.qualification },
    stages,
  });
  const { extraction, dropped } = sanitizeExtraction(data, args);
  return { extraction, attempts, dropped };
}
