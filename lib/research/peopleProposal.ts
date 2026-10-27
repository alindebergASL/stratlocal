// The account's own people, named by public research, offered as contacts on
// their side. A proposal like any other: it quotes the finding that names
// the person, can be accepted only once that finding is kept (the research
// evidence rule in applyEntityChange), and a person already on the account,
// or already offered, is not offered again (DECISIONS #91).
import { db } from "../db";
import { createProposalBatch } from "../proposals/apply";
import { listContacts } from "../queries/accounts";
import { matchContact } from "../matchContact";
import { sameName } from "../format";
import type { ResearchNote } from "./schema";

export const PEOPLE_ORIGIN = "research_people";

export function proposeResearchPeople(accountId: string, documentId: string, note: ResearchNote): number {
  const people = note.people ?? [];
  if (!people.length) return 0;
  const contacts = listContacts(accountId, { includeArchived: true });
  const offered = (db().prepare(`SELECT payload_json FROM proposals WHERE account_id = ? AND origin_id = ? AND status = 'pending'`).all(accountId, PEOPLE_ORIGIN) as Array<{ payload_json: string }>).map(
    (r) => (JSON.parse(r.payload_json) as { name?: string }).name ?? "",
  );
  const drafts = people.flatMap((p) => {
    const finding = note.findings[p.finding];
    if (!finding || matchContact(contacts, { name: p.name }) || offered.some((n) => sameName(n, p.name))) return [];
    offered.push(p.name);
    return [
      {
        entity_type: "contact" as const,
        op: "create" as const,
        entity_id: null,
        payload: { name: p.name, title: p.title, org: "customer" },
        rationale: "Named at the account in public research.",
        source_ref: { kind: "research" as const, id: documentId, quote: finding.quote.slice(0, 1000), finding_index: p.finding },
      },
    ];
  });
  if (!drafts.length) return 0;
  return createProposalBatch(accountId, { kind: "plan_draft", id: PEOPLE_ORIGIN, aiRunId: null }, drafts).ids.length;
}
