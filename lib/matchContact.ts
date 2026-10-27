// Is this person already on file?
//
// One rule, shared by the two places people arrive from: the team named on an
// imported report (lib/import/diffExtraction.ts) and a spreadsheet of people
// (lib/sheet/diffContacts.ts). It lived inside the report diff, which meant
// the spreadsheet path could only either import from a module about reports or
// write the rule out a second time — and a matching rule written twice is a
// matching rule that drifts, with the symptom being a duplicate person rather
// than an error.
//
// Email first, because it is an identifier and a name is not. Then the name,
// by the app's one name-equality rule (`sameName`, which ignores case,
// punctuation and repeated spaces) — the same rule a play title and a deal
// lookalike are already matched by. The report path used to compare lowercased
// names instead, which is stricter by exactly the differences a spreadsheet
// introduces: a trailing space, a double space, "O'Brien" against "OBrien".
//
// Archived rows are matched deliberately. A hidden person is still that
// person, and proposing a create for one silently duplicates them — so the
// callers pass the archived rows in and offer the match back with
// `archived_at: null`, which is the shape every other importer here uses.
//
// A live row wins over an archived one on either key, which the first version
// of this got wrong by inheriting a plain `Array.find` from the report diff.
// With an archived and a live contact of the same name, the archived one came
// back: the import proposed lifting the duplicate out of the archive and left
// the person you actually work with untouched, and nothing on the review card
// says which of the two it means. The precedence between the two *keys* is
// unchanged — an address is an identifier and a name is a guess, so an
// archived row carrying the address still beats a live namesake.
import { sameName } from "./format";

type Matchable = { name: string; email?: string | null };

/** Which key found them. The callers need it: proposing a person's name back
 *  at them is only meaningful when the name is not what matched. */
export type MatchBy = "email" | "name";

export type ContactMatch<T> = { row: T; by: MatchBy };

export function matchContact<T extends Matchable & { id?: string; archived_at?: string | null; merged_into?: string | null }>(
  contacts: T[],
  person: Matchable,
): ContactMatch<T> | undefined {
  const found = matchRow(contacts, person);
  if (!found) return undefined;
  // A merged-away row is the person it was merged into. Followed here, in
  // the one matcher both importers use, so neither can propose restoring it.
  // A chain that loops or leaves the list resolves to nothing rather than
  // back to the tombstone: silence beats resurrection.
  let row = found.row;
  for (let hops = 0; row.merged_into; hops++) {
    const next = contacts.find((c) => c.id === row.merged_into);
    if (!next || hops >= 20) return undefined;
    row = next;
  }
  return { row, by: found.by };
}

function matchRow<T extends Matchable & { archived_at?: string | null }>(contacts: T[], person: Matchable): ContactMatch<T> | undefined {
  const live = (c: T) => c.archived_at == null;
  const wanted = person.email?.trim().toLowerCase();
  if (wanted) {
    const hasEmail = (c: T) => !!c.email && c.email.trim().toLowerCase() === wanted;
    const hit = contacts.find((c) => hasEmail(c) && live(c)) ?? contacts.find(hasEmail);
    if (hit) return { row: hit, by: "email" };
  }
  // A name is a guess, and a row that carries its own address has already said
  // it is not this one. Two people called the same thing, each with an address
  // of their own, used to collapse onto whichever was on file first: the name
  // matched, the address on the row was proposed as a *change* to that
  // person's address, and the second human vanished into the first. An address
  // both sides hold and disagree about is the one piece of evidence here that
  // settles the question, so it disqualifies the name rather than being
  // overwritten by it. A candidate with no address on file is still matchable
  // — that is an omission, not a different identity.
  const differentEmail = (c: T) => !!wanted && !!c.email?.trim() && c.email.trim().toLowerCase() !== wanted;
  const hasName = (c: T) => sameName(c.name, person.name) && !differentEmail(c);
  const hit = contacts.find((c) => hasName(c) && live(c)) ?? contacts.find(hasName);
  return hit ? { row: hit, by: "name" } : undefined;
}
