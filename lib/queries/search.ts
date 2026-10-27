// One box across every account. Deliberately simple: SQLite LIKE over the
// handful of columns worth matching, at a scale where anything cleverer would
// be machinery without a reason.
import { db } from "../db";
import { crmIdText } from "../format";
import { keptFindings, ResearchMeta } from "../research/schema";

// meta_json came off the public web, so it is parsed, never cast.
function parseNoteMeta(json: string | null): ResearchMeta | null {
  if (!json) return null;
  try {
    const parsed = ResearchMeta.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type SearchKind = "account" | "deal" | "contact" | "play" | "meeting" | "research" | "action_item";

export type SearchHit = {
  kind: SearchKind;
  /** The record's own id: a deal's CRM id, a research note's document id. */
  id: string;
  label: string;
  detail: string | null;
  accountId: string;
  accountName: string;
  href: string;
};

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[]; more: number };

export const KIND_LABELS: Record<SearchKind, string> = {
  account: "Accounts",
  deal: "Deals",
  contact: "Contacts",
  play: "Plays",
  meeting: "Meetings",
  research: "Research",
  action_item: "Follow-ups",
};

// Which kinds a URL may name. `in` used to do this job inline on the page and
// walked the prototype, so ?kind=toString passed and the label lookup returned
// a function — a 500 on a URL anyone can type. Named here so it can be tested
// rather than asserted about in the abstract.
export function narrowKind(raw: string | undefined | null): SearchKind | null {
  return raw && Object.hasOwn(KIND_LABELS, raw) ? (raw as SearchKind) : null;
}

const PER_GROUP = 10;
// What one group shows when you ask to see all of it. "and N more" used to be
// a dead end: the count was rendered with no way to reach the rows.
const PER_GROUP_EXPANDED = 100;

// The words around the match, so a hit in three thousand characters of notes
// shows you why it matched rather than just the meeting's title.
export function snippet(haystack: string | null | undefined, needle: string, radius = 90): string | null {
  if (!haystack) return null;
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(haystack.length, at + needle.length + radius);
  const text = haystack.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < haystack.length ? "…" : ""}`;
}

// Escapes the LIKE wildcards so a query containing % or _ matches literally.
function pattern(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function search(rawQuery: string, only?: SearchKind | null): SearchGroup[] {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const like = pattern(q);
  const conn = db();
  const groups: SearchGroup[] = [];
  const cap = only ? PER_GROUP_EXPANDED : PER_GROUP;

  const run = <T>(sql: string, ...args: unknown[]) => conn.prepare(sql).all(...args) as T[];
  // Lazy on purpose: this used to take the rows themselves, so narrowing to
  // one kind still ran every other group's SQL — including the LIKE scan over
  // every meeting's notes — and threw the results away.
  const take = (kind: SearchKind, hits: () => SearchHit[]) => {
    if (only && kind !== only) return;
    const rows = hits();
    if (rows.length === 0) return;
    groups.push({ kind, label: KIND_LABELS[kind], hits: rows.slice(0, cap), more: Math.max(0, rows.length - cap) });
  };

  // The thesis as well as the name. It is the most considered paragraph on an
  // account — the sentence the whole plan turns on — and it was the one column
  // of six on this table that search did not read.
  take("account", () =>
    run<{ id: string; name: string; region: string | null; thesis: string | null }>(
      `SELECT id, name, region, thesis FROM accounts
       WHERE archived_at IS NULL AND kind = 'customer' AND (name LIKE ? ESCAPE '\\' OR thesis LIKE ? ESCAPE '\\')
       ORDER BY name COLLATE NOCASE`,
      like,
      like,
    ).map((r) => ({
      kind: "account" as const,
      label: r.name,
      detail: snippet(r.thesis, q) ?? r.region,
      accountId: r.id,
      accountName: r.name,
      id: r.id,
      href: `/accounts/${r.id}`,
    })),
  );

  // Deal id as well as name: an id is the thing most likely to be pasted.
  take("deal", () =>
    run<{ deal_id: string; name: string; stage: number | null; next_step: string | null; notes: string | null; architecture: string | null; account_id: string; account_name: string }>(
      `SELECT d.deal_id, d.name, d.stage, d.next_step, d.notes, d.architecture, a.id AS account_id, a.name AS account_name
       FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE d.archived_at IS NULL AND a.archived_at IS NULL
         AND (d.name LIKE ? ESCAPE '\\' OR d.deal_id LIKE ? ESCAPE '\\' OR d.next_step LIKE ? ESCAPE '\\' OR d.notes LIKE ? ESCAPE '\\'
              OR d.architecture LIKE ? ESCAPE '\\')
       ORDER BY d.name COLLATE NOCASE`,
      like,
      like,
      like,
      like,
      like,
    ).map((r) => ({
      kind: "deal" as const,
      label: r.name,
      detail:
        snippet(r.next_step, q) ??
        snippet(r.notes, q) ??
        snippet(r.architecture, q) ??
        [crmIdText(r.deal_id), r.stage ? `stage ${r.stage}` : null].filter(Boolean).join(" · "),
      accountId: r.account_id,
      accountName: r.account_name,
      // The deal's own page, not an anchor on the account page. The anchor
      // predates that page, and once deals past the first dozen moved behind
      // a disclosure it stopped resolving at all: the browser cannot scroll
      // to an element inside a closed <details>.
      id: r.deal_id,
      href: `/accounts/${r.account_id}/deals/${encodeURIComponent(r.deal_id)}`,
    })),
  );

  take("contact", () =>
    run<{ id: string; name: string; title: string | null; email: string | null; notes: string | null; account_id: string; account_name: string }>(
      `SELECT c.id, c.name, c.title, c.email, c.notes, a.id AS account_id, a.name AS account_name
       FROM contacts c JOIN accounts a ON a.id = c.account_id
       WHERE c.archived_at IS NULL AND a.archived_at IS NULL
         AND (c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\')
       ORDER BY c.name COLLATE NOCASE`,
      like,
      like,
      like,
      like,
    ).map((r) => ({
      kind: "contact" as const,
      label: r.name,
      // What you wrote about them is why you would search for them, so a hit
      // in the notes shows the line rather than their job title.
      detail: snippet(r.notes, q) ?? ([r.title, r.email].filter(Boolean).join(" · ") || null),
      accountId: r.account_id,
      accountName: r.account_name,
      id: r.id,
      href: `/accounts/${r.account_id}/contacts/${r.id}`,
    })),
  );

  take("play", () =>
    run<{ id: string; title: string; status: string; thesis: string | null; next_step: string | null; account_id: string; account_name: string }>(
      `SELECT p.id, p.title, p.status, p.thesis, p.next_step, a.id AS account_id, a.name AS account_name
       FROM plays p JOIN accounts a ON a.id = p.account_id
       WHERE p.archived_at IS NULL AND a.archived_at IS NULL
         AND (p.title LIKE ? ESCAPE '\\' OR p.thesis LIKE ? ESCAPE '\\' OR p.next_step LIKE ? ESCAPE '\\')
       ORDER BY p.title COLLATE NOCASE`,
      like,
      like,
      like,
    ).map((r) => ({
      kind: "play" as const,
      label: r.title,
      detail: snippet(r.thesis, q) ?? snippet(r.next_step, q) ?? r.status,
      accountId: r.account_id,
      accountName: r.account_name,
      id: r.id,
      href: `/accounts/${r.account_id}/plays/${r.id}`,
    })),
  );

  take("meeting", () =>
    // The richest text in the app is what was said in the room. Searching
    // only the titles made it unfindable: "which meeting was it where they
    // mentioned the EHR migration" had no answer.
    run<{ id: string; title: string; held_at: string; summary: string | null; raw_notes: string | null; account_id: string; account_name: string }>(
      `SELECT m.id, m.title, m.held_at, m.summary, m.raw_notes, a.id AS account_id, a.name AS account_name
       FROM meetings m JOIN accounts a ON a.id = m.account_id
       WHERE m.archived_at IS NULL AND a.archived_at IS NULL
         AND (m.title LIKE ? ESCAPE '\\' OR m.summary LIKE ? ESCAPE '\\' OR m.raw_notes LIKE ? ESCAPE '\\')
       ORDER BY m.held_at DESC`,
      like,
      like,
      like,
    ).map((r) => ({
      kind: "meeting" as const,
      label: r.title,
      detail: [r.held_at.slice(0, 10), snippet(r.summary, q) ?? snippet(r.raw_notes, q)].filter(Boolean).join(" · "),
      accountId: r.account_id,
      accountName: r.account_name,
      id: r.id,
      href: `/accounts/${r.account_id}/meetings/${r.id}`,
    })),
  );

  // Research findings. meta_json is matched in SQL to narrow the rows, then
  // parsed to find which finding actually matched — LIKE over the blob would
  // hit a URL or a topic name and report a match nobody can see. Only accepted
  // notes, and only the findings a person kept: a draft is not yet something
  // the account knows, and an unticked finding was explicitly rejected.
  take("research", () =>
    run<{ id: string; account_id: string; account_name: string; meta_json: string | null }>(
      `SELECT d.id, d.meta_json, a.id AS account_id, a.name AS account_name
       FROM documents d JOIN accounts a ON a.id = d.account_id
       WHERE d.kind = 'research_note' AND d.status = 'accepted' AND d.archived_at IS NULL
         AND a.archived_at IS NULL AND d.meta_json LIKE ? ESCAPE '\\'
       ORDER BY d.created_at DESC`,
      like,
    ).flatMap((r) => {
      const parsed = parseNoteMeta(r.meta_json);
      if (!parsed) return [];
      const hits: SearchHit[] = [];
      for (const f of keptFindings(parsed)) {
        const where = snippet(f.text, q);
        if (!where) continue;
        hits.push({
          kind: "research" as const,
          label: parsed.title,
          detail: where,
          accountId: r.account_id,
          accountName: r.account_name,
          id: r.id,
          href: `/accounts/${r.account_id}/research?read=${r.id}#research-${r.id}`,
        });
      }
      // Both hrefs go to the research page rather than the account page's
      // Research section: that section shows the three newest notes, so a hit
      // on the fourth used to land on an anchor the page does not render.
      // Every accepted note is on /research — and `?note=` opens the one you
      // searched for, since that page leaves all but its two newest as cards
      // and an anchor alone would land on a collapsed one. `?read=` opens it
      // to read; a bare `?note=` is the mode for changing what it keeps.
      //
      // The note matched somewhere other than a kept finding — the summary,
      // most likely. Worth one row, not none.
      if (hits.length === 0 && snippet(parsed.summary, q)) {
        hits.push({
          kind: "research" as const,
          label: parsed.title,
          detail: snippet(parsed.summary, q),
          accountId: r.account_id,
          accountName: r.account_name,
          id: r.id,
          href: `/accounts/${r.account_id}/research?read=${r.id}#research-${r.id}`,
        });
      }
      return hits;
    }),
  );

  take("action_item", () =>
    run<{ id: string; text: string; status: string; due: string | null; account_id: string; account_name: string }>(
      `SELECT i.id, i.text, i.status, i.due, a.id AS account_id, a.name AS account_name
       FROM action_items i JOIN accounts a ON a.id = i.account_id
       WHERE i.archived_at IS NULL AND a.archived_at IS NULL AND i.text LIKE ? ESCAPE '\\'
       ORDER BY i.status, COALESCE(i.due, '9999')`,
      like,
    ).map((r) => ({
      kind: "action_item" as const,
      label: r.text,
      detail: [r.status, r.due ? `due ${r.due}` : null].filter(Boolean).join(" · "),
      accountId: r.account_id,
      accountName: r.account_name,
      id: r.id,
      href: `/follow-ups/${r.id}`,
    })),
  );

  return groups;
}
