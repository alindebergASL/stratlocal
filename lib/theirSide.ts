// The customer's side of an account, at a glance: their people (on file, and
// suggested by research), their priorities, and the roles we have not found
// yet. Priorities are theirs first: kept research about their strategy and
// leaders, then the scorecard's Metrics and Identify pain in our own notes,
// then our archetype hypothesis, labelled as ours. Every line links to where
// it came from (DECISIONS #91).
import { db, type AccountRow, type ContactRow } from "./db";
import { loadAcceptedResearch } from "./research/notes";
import { keptFindings, readOf } from "./research/schema";
import { findingHref } from "./research/anchor";
import { scorecard } from "./playbook/qualification";
import { PEOPLE_ORIGIN } from "./research/peopleProposal";

export type Priority = { text: string; from: "research" | "scorecard" | "ours"; label: string; href: string };
export type RoleToFind = { role: string; likely: string; question: string };
export type TheirSide = { suggested: number; priorities: Priority[]; rolesToFind: RoleToFind[] };

const MAX_PRIORITIES = 3;
const MAX_ROLES = 3;

export function theirSide(account: AccountRow, contacts: ContactRow[]): TheirSide {
  const id = account.id;
  const suggested = (db().prepare(`SELECT COUNT(*) AS n FROM proposals WHERE account_id = ? AND origin_id = ? AND status = 'pending'`).get(id, PEOPLE_ORIGIN) as { n: number }).n;
  const notes = loadAcceptedResearch(id).sort((a, b) => b.meta.generated_at.localeCompare(a.meta.generated_at));

  // Their own stated direction: kept strategy and leadership findings, the
  // ones research read as a reason to act or as touching our work first.
  const research = notes.flatMap(({ doc, meta }) => {
    const kept = new Set(keptFindings(meta));
    return meta.findings.flatMap((f, index) => {
      if (!kept.has(f) || (f.topic !== "strategy" && f.topic !== "leadership")) return [];
      const read = readOf(meta, index);
      const weight = (read?.signal ? 2 : 0) + (read?.fits.length ? 1 : 0) + (f.topic === "strategy" ? 1 : 0);
      return [{ weight, date: f.date ?? meta.generated_at, p: { text: f.text, from: "research" as const, label: "Research", href: findingHref(id, doc.id, index) } }];
    });
  });
  research.sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date));

  const playbookHref = `/accounts/${id}/playbook`;
  const fromScorecard: Priority[] = scorecard(account)
    .filter((r) => (r.element === "M" || r.element === "I") && r.evidence.trim())
    .map((r) => ({ text: r.evidence.trim(), from: "scorecard", label: r.label, href: playbookHref }));
  const ours: Priority[] = account.archetype_hypothesis?.trim() ? [{ text: account.archetype_hypothesis.trim(), from: "ours", label: "Our hypothesis", href: playbookHref }] : [];

  const priorities = [...research.map((r) => r.p).slice(0, MAX_PRIORITIES), ...fromScorecard, ...ours];
  // One of each kind, when there is one, before more of the same.
  const picked: Priority[] = [];
  for (const from of ["research", "scorecard", "ours"] as const) {
    const first = priorities.find((p) => p.from === from);
    if (first) picked.push(first);
  }
  for (const p of priorities) if (picked.length < MAX_PRIORITIES && !picked.includes(p)) picked.push(p);

  // Roles the research suggested that nobody on file seems to fill.
  const group = notes.find((n) => n.meta.buying_group?.length)?.meta.buying_group ?? [];
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const theirs = contacts.filter((c) => c.org === "customer");
  const rolesToFind = group
    .filter((g) => {
      const want = words(g.role);
      return !theirs.some((c) => {
        const has = new Set(words(`${c.title ?? ""} ${c.name}`));
        return want.length > 0 && want.filter((w) => has.has(w)).length >= Math.min(2, want.length);
      });
    })
    .slice(0, MAX_ROLES)
    .map((g) => ({ role: g.role, likely: g.likely, question: g.question }));

  return { suggested, priorities: picked.slice(0, MAX_PRIORITIES), rolesToFind };
}
