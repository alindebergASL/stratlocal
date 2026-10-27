// The top reason to read research on an account, as the Overview picks it
// (lib/research/brief.ts overviewLeads): the same lead for the page and the
// Writer, so both see the same facts.
import { listNotes } from "../research/notes";
import { briefItemsOf, overviewLeads } from "../research/brief";
import { focusForResearch } from "../teamDirection";

export function accountLead(accountId: string, today: string): { label: string; text: string; href: string } | null {
  const l = overviewLeads(briefItemsOf(listNotes(accountId, "accepted")), focusForResearch(), today)[0];
  return l ? { label: l.label, text: l.item.finding.text, href: `/accounts/${accountId}/research?note=${l.item.noteId}&finding=${l.item.index}#finding-${l.item.noteId}-${l.item.index}` } : null;
}
