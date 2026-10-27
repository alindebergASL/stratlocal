// Whose account is it, as a question every list can be asked.
//
// Ownership lives on `accounts.owner_user_id` (migration 009) and nowhere
// else: a deal, a meeting, a follow-up and a history row all belong to an
// account, so filtering on the account is the whole of it. That is why this is
// a SQL fragment rather than a post-filter — every query it goes into already
// joins `accounts a`, and several of them carry a LIMIT, so filtering their
// results in JS would silently under-report the limit.
//
// Four answers, not three. "Shared" is a real state and not missing data: an
// account the two of them run together is common, and making the filter
// pretend it belongs to somebody would be worse than having no filter.
export type OwnerFilter = "all" | "mine" | "theirs" | "shared";

export const OWNER_FILTERS: readonly OwnerFilter[] = ["all", "mine", "theirs", "shared"] as const;

/** Which filter, and who is asking. `me` is null only where no user is resolved. */
export type OwnerScope = { filter: OwnerFilter; me: string | null };

export const EVERYTHING: OwnerScope = { filter: "all", me: null };

export function parseOwnerScope(raw: string | undefined, me: string | null): OwnerScope {
  const filter = OWNER_FILTERS.find((f) => f === raw) ?? "all";
  return { filter, me };
}

/**
 * The WHERE fragment for a scope, and its bindings. Returns an empty string
 * for "all", so a query that is not being filtered is byte-identical to what
 * it was before this existed.
 */
export function ownerClause(scope: OwnerScope | undefined, col = "a.owner_user_id"): { sql: string; args: string[] } {
  if (!scope || scope.filter === "all") return { sql: "", args: [] };
  if (scope.filter === "shared") return { sql: ` AND ${col} IS NULL`, args: [] };
  // No signed-in id and a filter that needs one: "mine" matches nothing and
  // "theirs" means anyone at all. Returning the unfiltered set for "mine"
  // would answer a different question than the one on screen.
  if (scope.me === null) {
    return scope.filter === "mine" ? { sql: " AND 1 = 0", args: [] } : { sql: ` AND ${col} IS NOT NULL`, args: [] };
  }
  return scope.filter === "mine"
    ? { sql: ` AND ${col} = ?`, args: [scope.me] }
    : { sql: ` AND ${col} IS NOT NULL AND ${col} <> ?`, args: [scope.me] };
}

/**
 * What to call each option on screen. "Theirs" is named after the other person
 * when there is exactly one of them, which with two users is always — a chip
 * saying "Jamie" is a better button than one saying "Theirs".
 */
export function ownerLabels(users: Array<{ id: string; display_name: string }>, me: string | null): Record<OwnerFilter, string> {
  const others = users.filter((u) => u.id !== me);
  return {
    all: "Everything",
    mine: "Mine",
    theirs: others.length === 1 ? others[0]!.display_name : "Theirs",
    shared: "Shared",
  };
}
