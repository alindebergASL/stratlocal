// Which way a follow-up runs: something we promised the customer, or something
// they promised us. The second kind is the one that slips, because nobody on
// our side has it on their list.
//
// A follow-up with one of us as its owner is ours. One with only a name on it
// is theirs, unless the name is one of ours or a word like "we" that the notes
// use for our side. Notes often say only a first name, so one of ours counts —
// unless one of the account's contacts has that first name too, when nobody
// can tell whose it is. No owner, or that tie, is left undecided rather than
// guessed.
export type PromiseDirection = "ours" | "theirs" | "unowned";

const OUR_SIDE = new Set(["we", "us", "me", "i", "our team", "our side", "seller", "the seller"]);

export function promiseDirection(
  item: { owner: string | null; ownerUserId: string | null },
  users: readonly { name: string }[] = [],
  contacts: readonly string[] = [],
): PromiseDirection {
  if (item.ownerUserId) return "ours";
  const said = (item.owner ?? "").trim().toLowerCase();
  if (!said) return "unowned";
  if (OUR_SIDE.has(said)) return "ours";
  const full = (n: string) => n.trim().toLowerCase();
  const first = (n: string) => full(n).split(/\s+/)[0];
  if (users.some((u) => full(u.name) === said)) return "ours";
  if (contacts.some((c) => full(c) === said)) return "theirs";
  if (users.some((u) => first(u.name) === said)) return contacts.some((c) => first(c) === said) ? "unowned" : "ours";
  return "theirs";
}

export function splitPromises<T extends { owner: string | null; ownerUserId: string | null }>(items: readonly T[], users: readonly { name: string }[] = [], contacts: readonly string[] = []) {
  const out = { ours: [] as T[], theirs: [] as T[], unowned: [] as T[] };
  for (const i of items) out[promiseDirection(i, users, contacts)].push(i);
  return out;
}
