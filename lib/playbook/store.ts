// The team's playbooks, each versioned like Team direction
// (lib/teamDirection.ts): every save is a new row under the playbook's slug,
// the newest is current, and any earlier version can be brought back. A save
// made from a page that was showing an older version is refused rather than
// quietly replacing what the other person wrote.
//
// A team usually has one, "default". It can have more (one per market, say);
// one is the default and an account can use another (DECISIONS #83).
import { db } from "../db";
import { newId } from "../ids";
import { ApplyError } from "../proposals/apply";
import { Playbook, type PlaybookInput } from "./schema";

export const DEFAULT_SLUG = "default";
const DEFAULT_KEY = "playbook_default";

export type PlaybookVersion = { id: string; slug: string; playbook: Playbook; note: string | null; createdBy: string | null; createdAt: number };
type Row = { id: string; slug: string; json: string; note: string | null; created_by: string | null; created_at: number };

function toVersion(r: Row): PlaybookVersion | null {
  try {
    const parsed = Playbook.safeParse(JSON.parse(r.json));
    return parsed.success ? { id: r.id, slug: r.slug ?? DEFAULT_SLUG, playbook: parsed.data, note: r.note, createdBy: r.created_by, createdAt: r.created_at } : null;
  } catch {
    return null;
  }
}

function latest(slug: string): PlaybookVersion | null {
  for (const r of db().prepare(`SELECT * FROM playbooks WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT 5`).all(slug) as Row[]) {
    const v = toVersion(r);
    if (v) return v;
  }
  return null;
}

/** The slug of the team's default playbook. */
export function defaultSlug(): string {
  const set = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(DEFAULT_KEY) as { value: string } | undefined;
  if (set && latest(set.value)) return set.value;
  if (latest(DEFAULT_SLUG)) return DEFAULT_SLUG;
  const any = db().prepare(`SELECT slug FROM playbooks ORDER BY created_at LIMIT 1`).get() as { slug: string } | undefined;
  return any?.slug ?? DEFAULT_SLUG;
}

/**
 * The current version of a playbook: the one named, else the one an account
 * uses, else the team's default. Null when the team has none yet.
 */
export function currentPlaybook(opts: { slug?: string | null; accountId?: string | null } = {}): PlaybookVersion | null {
  if (opts.slug) return latest(opts.slug);
  if (opts.accountId) {
    const a = db().prepare(`SELECT playbook_slug FROM accounts WHERE id = ?`).get(opts.accountId) as { playbook_slug: string | null } | undefined;
    const own = a?.playbook_slug ? latest(a.playbook_slug) : null;
    if (own) return own;
  }
  return latest(defaultSlug());
}

export type PlaybookSummary = { slug: string; name: string; isDefault: boolean; accounts: number; updatedAt: number };

/** Every playbook the team has, the default first. */
export function listPlaybooks(): PlaybookSummary[] {
  const def = defaultSlug();
  const slugs = (db().prepare(`SELECT slug, MIN(created_at) AS first FROM playbooks GROUP BY slug ORDER BY first`).all() as Array<{ slug: string }>).map((r) => r.slug);
  const uses = new Map(
    (db().prepare(`SELECT COALESCE(playbook_slug, ?) AS slug, COUNT(*) AS n FROM accounts WHERE archived_at IS NULL AND kind = 'customer' GROUP BY 1`).all(def) as Array<{ slug: string; n: number }>).map((r) => [r.slug, r.n]),
  );
  return slugs
    .flatMap((slug) => {
      const v = latest(slug);
      return v ? [{ slug, name: v.playbook.name, isDefault: slug === def, accounts: uses.get(slug) ?? 0, updatedAt: v.createdAt }] : [];
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Earlier versions of one playbook, newest first. */
export function playbookHistory(limit = 15, slug: string = defaultSlug()): PlaybookVersion[] {
  return (db().prepare(`SELECT * FROM playbooks WHERE slug = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(slug, limit) as Row[]).flatMap((r) => toVersion(r) ?? []);
}

/** A readable list of what is wrong with a playbook, or null when nothing is. */
export function playbookProblems(input: unknown): string[] | null {
  const parsed = Playbook.safeParse(input);
  if (parsed.success) return null;
  return parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "playbook"}: ${i.message}`);
}

export function savePlaybook(input: { playbook: PlaybookInput; note?: string | null; userId: string | null; basisId: string | null; slug?: string }): PlaybookVersion {
  const conn = db();
  return conn
    .transaction((): PlaybookVersion => {
      // A save goes to the playbook its basis belongs to, so whatever page it
      // came from saves into the playbook that page was showing.
      const basisSlug = input.basisId ? (conn.prepare(`SELECT slug FROM playbooks WHERE id = ?`).get(input.basisId) as { slug: string } | undefined)?.slug : undefined;
      const slug = input.slug ?? basisSlug ?? defaultSlug();
      const current = latest(slug);
      if ((current?.id ?? null) !== input.basisId) {
        throw new ApplyError("The playbook was changed since this page was opened. Reload to see it, then make your change again.", "conflict");
      }
      const parsed = Playbook.safeParse(input.playbook);
      if (!parsed.success) throw new ApplyError(`That playbook has problems: ${playbookProblems(input.playbook)!.join("; ")}`, "validation");
      const row: Row = {
        id: newId(),
        slug,
        json: JSON.stringify(parsed.data),
        note: input.note?.trim().slice(0, 300) || null,
        created_by: input.userId,
        created_at: Math.max(Date.now(), (current?.createdAt ?? 0) + 1),
      };
      conn.prepare(`INSERT INTO playbooks (id, slug, json, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(row.id, row.slug, row.json, row.note, row.created_by, row.created_at);
      return toVersion(row)!;
    })
    .immediate();
}

/** Make an earlier version current again, as a new version that says so. */
export function restorePlaybook(versionId: string, userId: string | null, basisId: string | null): PlaybookVersion {
  const r = db().prepare(`SELECT * FROM playbooks WHERE id = ?`).get(versionId) as Row | undefined;
  const v = r ? toVersion(r) : null;
  if (!v) throw new ApplyError("That version is not available.", "not_found");
  return savePlaybook({ playbook: v.playbook, note: `Restored the version of ${new Date(v.createdAt).toISOString().slice(0, 10)}`, userId, basisId, slug: v.slug });
}

const slugOf = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "playbook";

/** A second (or third) playbook, started from a copy of an existing one. */
export function createPlaybook(input: { name: string; from: PlaybookInput; userId: string | null }): PlaybookVersion {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) throw new ApplyError("Give the playbook a name.", "validation");
  if (listPlaybooks().some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new ApplyError("There is already a playbook with that name.", "conflict");
  let slug = slugOf(name);
  for (let i = 2; latest(slug); i++) slug = `${slugOf(name)}-${i}`;
  return savePlaybook({ playbook: { ...input.from, name }, note: "Created", userId: input.userId, basisId: null, slug });
}

export function setDefaultPlaybook(slug: string, userId: string) {
  if (!latest(slug)) throw new ApplyError("No such playbook.", "not_found");
  db()
    .prepare(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(DEFAULT_KEY, slug, userId, Date.now());
}
