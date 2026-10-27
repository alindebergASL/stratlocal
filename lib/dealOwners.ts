// Which spellings of a deal owner are one person.
//
// A deal's `owner` is free text the CRM report writes, so "Jamie", "Jamie L."
// and "Jamie Lee" were three owners to the pipeline's filter and to anyone
// counting. The text on the deal is never rewritten — the next report writes
// it again — and nothing here guesses on its own: a person says which
// spellings are one name, and that is a row in `deal_owner_aliases`. The app
// offers the pairs it can see are probably one person, and only the pairs it
// can see unambiguously; the person presses the button.
//
// One rule, one place: everything that shows or filters an owner reads it
// through `ownerNames()`.
import { db } from "./db";
import { ApplyError } from "./proposals/apply";

export function normOwner(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export type OwnerNames = {
  /** The confirmed name for a spelling, or the spelling itself, tidied. */
  nameOf: (raw: string | null | undefined) => string | null;
  /** Every spelling on a deal that reads as this name. */
  spellingsOf: (name: string) => string[];
};

type AliasRow = { alias: string; canonical: string };

function aliases(): Map<string, string> {
  const rows = db().prepare(`SELECT alias, canonical FROM deal_owner_aliases`).all() as AliasRow[];
  return new Map(rows.map((r) => [r.alias, r.canonical]));
}

/** Distinct owner spellings on live deals, with how many deals carry each. */
export function ownerSpellings(): Array<{ spelling: string; deals: number }> {
  return db()
    .prepare(
      `SELECT d.owner AS spelling, COUNT(*) AS deals FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE d.owner IS NOT NULL AND trim(d.owner) <> '' AND d.archived_at IS NULL AND a.archived_at IS NULL
       GROUP BY d.owner ORDER BY d.owner COLLATE NOCASE`,
    )
    .all() as Array<{ spelling: string; deals: number }>;
}

export function ownerNames(): OwnerNames {
  const map = aliases();
  const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
  const nameOf = (raw: string | null | undefined) => {
    if (raw === null || raw === undefined || raw.trim() === "") return null;
    return map.get(normOwner(raw)) ?? tidy(raw);
  };
  const spellings = ownerSpellings().map((s) => s.spelling);
  return {
    nameOf,
    spellingsOf: (name: string) => {
      const want = normOwner(name);
      return spellings.filter((s) => normOwner(nameOf(s) ?? "") === want);
    },
  };
}

/** The names the pipeline's owner filter offers: one per person. */
export function ownerChoices(): string[] {
  const { nameOf } = ownerNames();
  const seen = new Map<string, string>();
  for (const { spelling } of ownerSpellings()) {
    const name = nameOf(spelling)!;
    if (!seen.has(normOwner(name))) seen.set(normOwner(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

// "Jamie L." reads as "Jamie Lee": same first word, and every later word
// either the same or an initial of the other's word at that place. Strictly
// shorter or with an initial, so two identical spellings are not a pair.
function abbreviates(short: string, long: string): boolean {
  const a = normOwner(short).split(" ");
  const b = normOwner(long).split(" ");
  if (a[0] !== b[0] || a.length > b.length) return false;
  let initial = false;
  for (let i = 1; i < a.length; i++) {
    const t = a[i]!;
    const u = b[i]!;
    if (t === u) continue;
    const letter = t.replace(/\.$/, "");
    if (letter.length === 1 && u.startsWith(letter)) {
      initial = true;
      continue;
    }
    return false;
  }
  return initial || a.length < b.length;
}

export type OwnerSuggestion = { spelling: string; name: string };

/**
 * Spellings that are very probably another, longer spelling — offered, never
 * applied. Only when the short form fits exactly one longest form: "Jamie"
 * beside both "Jamie Lee" and "Jamie Kim" is a question for a person, so it
 * is not offered at all.
 */
export function ownerSuggestions(): OwnerSuggestion[] {
  const map = aliases();
  const spellings = ownerSpellings().map((s) => s.spelling);
  const open = spellings.filter((s) => !map.has(normOwner(s)));
  const out: OwnerSuggestion[] = [];
  for (const s of open) {
    const longer = spellings.filter((t) => normOwner(t) !== normOwner(s) && abbreviates(s, t));
    // The longest forms only: "Jamie" → "Jamie L." → "Jamie Lee" offers
    // "Jamie Lee" for both shorter ones, not a chain.
    const maximal = longer.filter((t) => !longer.some((u) => normOwner(u) !== normOwner(t) && abbreviates(t, u)));
    const names = [...new Set(maximal.map((t) => normOwner(map.get(normOwner(t)) ?? t)))];
    if (names.length !== 1) continue;
    const target = maximal[0]!;
    const name = (map.get(normOwner(target)) ?? target).trim().replace(/\s+/g, " ");
    // The longer spelling may itself have been confirmed as this one — then
    // the pair is already one owner, and offering "X reads as X" is a button
    // that can only ever do nothing.
    if (normOwner(name) === normOwner(s)) continue;
    out.push({ spelling: s, name });
  }
  return out;
}

/**
 * Say that a spelling is a name. The name must already be one the pipeline
 * shows — a spelling on a deal, or a name a spelling was already confirmed as
 * — so this connects owners and never invents one. Anything that pointed at
 * the spelling as its name follows it, so there is never a chain to walk.
 */
export function confirmOwner(input: { spelling: string; name: string; userId: string | null }): void {
  const conn = db();
  conn.transaction(() => {
    const spelling = normOwner(input.spelling);
    const names = ownerNames();
    const known = ownerSpellings().map((s) => s.spelling);
    if (!known.some((k) => normOwner(k) === spelling)) throw new ApplyError("That owner is not on any deal.", "validation");
    const target = names.nameOf(input.name);
    if (!target || !known.some((k) => normOwner(names.nameOf(k) ?? "") === normOwner(target))) {
      throw new ApplyError("Choose a name that is already on a deal.", "validation");
    }
    if (normOwner(target) === spelling) {
      conn.prepare(`DELETE FROM deal_owner_aliases WHERE alias = ?`).run(spelling);
      return;
    }
    conn
      .prepare(
        `INSERT INTO deal_owner_aliases (alias, canonical, created_by, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical, created_by = excluded.created_by, created_at = excluded.created_at`,
      )
      .run(spelling, target, input.userId, Date.now());
    // Whatever was confirmed as this spelling now reads as the new name.
    // Matched in JS with the same normalisation as everything else here:
    // SQLite's lower() folds ASCII only, so "Élodie Martin" and "élodie
    // martin" were two names to it and the redirect silently missed.
    const redirect = conn.prepare(`UPDATE deal_owner_aliases SET canonical = ? WHERE alias = ?`);
    for (const row of conn.prepare(`SELECT alias, canonical FROM deal_owner_aliases`).all() as AliasRow[]) {
      if (normOwner(row.canonical) === spelling) redirect.run(target, row.alias);
    }
  })();
}

/** Take a spelling back out: it reads as itself again. */
export function separateOwner(spelling: string): void {
  db().prepare(`DELETE FROM deal_owner_aliases WHERE alias = ?`).run(normOwner(spelling));
}
