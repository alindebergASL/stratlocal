// The token that says "the account is at this point in its history".
//
// It is read by a client component, so it lives here with no database import.
// Two numbers, both monotonic for an account and both append-only:
//
//   seq    the largest change_log rowid the account has. SQLite hands these
//          out in insertion order and change_log is never deleted from, so
//          two edits in the same millisecond still get two values — which
//          MAX(created_at), an integer of milliseconds, cannot promise.
//   count  how many rows the account has. Carried as well so a token whose
//          seq is somehow unchanged still moves when history grows.
//
// Opaque on purpose: it is a cursor, not a count anyone should read or do
// arithmetic on, and the only questions asked of it are "is this the same
// point?" and "is this one further along?".
export type Revision = { count: number; seq: number };

// Only surfaces whose drafts have been checked belong to this first slice.
// Research/review/import must not acquire a new destructive refresh control.
export function supportsFreshness(pathname: string, accountId: string): boolean {
  const prefix = `/accounts/${accountId}`;
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  // The account's tabs carry the same forms the one long account page did
  // before it was split, so they keep its cover.
  return rest === "" || /^\/(deals|plays|people|meetings|follow-ups|details)$/.test(rest) || /^\/(meetings|deals|contacts|plays)\/[^/]+$/.test(rest);
}

export function formatRevision(revision: Revision): string {
  return `${revision.count}.${revision.seq}`;
}

export function parseRevision(token: unknown): Revision | null {
  if (typeof token !== "string") return null;
  const m = /^(\d{1,15})\.(\d{1,15})$/.exec(token);
  if (!m) return null;
  return { count: Number(m[1]), seq: Number(m[2]) };
}

// Is `candidate` a strictly later point in the same account's history than
// `current`? Anything unparsable answers no: a reply we cannot read must not
// be able to claim a change happened, and it must not be able to claim one
// did not either — the caller keeps whatever it already knew.
export function isNewerRevision(candidate: unknown, current: unknown): boolean {
  const a = parseRevision(candidate);
  const b = parseRevision(current);
  if (!a || !b) return false;
  if (a.seq !== b.seq) return a.seq > b.seq;
  return a.count > b.count;
}
