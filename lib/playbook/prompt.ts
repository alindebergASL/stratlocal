// The account seen through the playbook, for a prompt: its archetype and
// hypothesis, the step it is on, and the team's own questions chosen for the
// people in the room. Like the team direction, it steers and is never
// evidence about the customer.
import { getAccount, listContacts } from "../queries/accounts";
import { currentPlaybook } from "./store";
import { archetypeOf } from "./archetype";
import { lifecycle } from "./lifecycle";
import { discoveryGuide } from "./discovery";
import { qualificationGaps, scorecard } from "./qualification";

export function playbookForPrompt(accountId: string, attendees: Array<{ contact_id: string | null; name: string; note?: string | null }> = []): string {
  const playbook = currentPlaybook({ accountId })?.playbook;
  const account = getAccount(accountId);
  if (!playbook || !account) return "";
  const archetype = archetypeOf(playbook, account.archetype_id ?? null);
  const step = lifecycle(accountId, playbook).current;
  const contacts = new Map(listContacts(accountId).map((c) => [c.id, c]));
  const guide = discoveryGuide(playbook, {
    archetypeId: archetype?.id ?? null,
    gaps: qualificationGaps(scorecard(account)),
    attendees: attendees.map((a) => {
      const c = a.contact_id ? contacts.get(a.contact_id) : undefined;
      return { name: a.name, title: c?.title ?? a.note ?? null, role: c?.role ?? null };
    }),
  });
  const parts: string[] = [];
  if (archetype) {
    parts.push(`The team places this account as "${archetype.name}": ${[archetype.posture, archetype.pain && `pain: ${archetype.pain}`, archetype.entry_point && `where to start: ${archetype.entry_point}`].filter(Boolean).join("; ")}.`);
    if (account.archetype_hypothesis) parts.push(`The team's hypothesis to test: ${account.archetype_hypothesis}`);
  }
  if (step) parts.push(`The account is on step "${step.step.name}" of the team's playbook${step.step.output ? `, which should produce: ${step.step.output}` : ""}.`);
  const card = scorecard(account);
  if (card.some((r) => r.status !== "unknown")) {
    parts.push(`Qualification so far (the team's own scorecard):\n${card.map((r) => `- ${r.label}: ${r.status}${r.evidence ? `, ${r.evidence}` : ""}`).join("\n")}`);
  }
  const questions = guide.flatMap((g) => g.questions.map((q) => `- ${q.text}`));
  if (questions.length) parts.push(`The team's own discovery questions for this meeting; prefer these, in the customer's terms, over new ones:\n${questions.join("\n")}`);
  if (!parts.length) return "";
  return [
    `The team's playbook ("${playbook.name}"). It is how the team works, not evidence about this account: never state it as a fact about the customer and never cite it.`,
    "",
    ...parts,
  ].join("\n");
}
