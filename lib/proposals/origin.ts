// Where a proposal came from, as a person reads it. Ask files under the
// plan-draft origin the database already allows, with an origin id of
// `ask:<thread>` (lib/ask/propose.ts); everywhere a label is shown, it is Ask.
//
// The same for the playbook's own suggestions (an archetype, a quarterly
// refresh) and for a Salesforce read: each says where it came from rather
// than passing as a plan draft or an imported report.
export function displayOrigin(p: { origin_kind: string; origin_id: string | null }): string {
  if (p.origin_id?.startsWith("ask:")) return "ask";
  if (p.origin_id?.startsWith("mail:")) return "mail";
  if (p.origin_id === "salesforce") return "salesforce";
  if (p.origin_id === "playbook_refresh") return "quarterly_refresh";
  if (p.origin_id?.startsWith("playbook_")) return "playbook";
  return p.origin_kind;
}
