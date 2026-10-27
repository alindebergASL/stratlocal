// The brief at the top of an account's research: why now, where we fit, and
// what changed since you last looked. Worked out in code from kept findings
// and their reads; nothing here calls a model.
import { db } from "../db";
import { findingAge, newestFirst } from "./provenance";
import { keptFindings, readOf, TOPIC_LABELS, type FindingRead, type ResearchFinding, type ResearchMeta, type Topic } from "./schema";

export type BriefItem = { noteId: string; index: number; finding: ResearchFinding; asOf: string; read?: FindingRead; acceptedAt?: string | null };

export type Brief = {
  events: BriefItem[];
  triggers: BriefItem[];
  fit: Array<{ area: string; items: BriefItem[] }>;
  changed: BriefItem[] | null;
  since: number | null;
  read: number;
  unread: number;
};

// A trigger is about now: one over eighteen months old is history.
const TRIGGER_MONTHS = 18;

const order = (a: BriefItem, b: BriefItem) => newestFirst({ date: a.finding.date, asOf: a.asOf }, { date: b.finding.date, asOf: b.asOf });

export function buildBrief(items: BriefItem[], focusAreas: string[], since: number | null, today: string): Brief {
  const sorted = [...items].sort(order);
  const recent = (k: BriefItem) => (findingAge(k.finding.date, today)?.months ?? 0) < TRIGGER_MONTHS;
  const events = sorted.filter((k) => k.read?.signal === "compelling_event").slice(0, 3);
  const triggers = sorted.filter((k) => k.read?.signal === "trigger" && recent(k)).slice(0, 3);
  const fit = focusAreas.map((area) => ({ area, items: sorted.filter((k) => k.read?.fits.includes(area)) }));
  const changed = since === null ? null : sorted.filter((k) => k.acceptedAt && Date.parse(k.acceptedAt) > since);
  const read = items.filter((k) => k.read !== undefined).length;
  return { events, triggers, fit, changed, since, read, unread: 0 };
}

const PAUSE_MS = 30 * 60 * 1000;

/**
 * When this person last looked at this account's research, before now.
 *
 * Opening the page counts as looking, but a reload a minute later should not
 * empty "what changed": the visit only moves on after a half-hour pause, and
 * until then the answer stays the visit before.
 */
export function lastLooked(userId: string, accountId: string, now = Date.now()): number | null {
  const conn = db();
  const row = conn.prepare("SELECT seen_at, before_at FROM research_seen WHERE user_id = ? AND account_id = ?").get(userId, accountId) as { seen_at: number; before_at: number | null } | undefined;
  if (!row) {
    conn.prepare("INSERT INTO research_seen (user_id, account_id, seen_at, before_at) VALUES (?, ?, ?, NULL)").run(userId, accountId, now);
    return null;
  }
  if (now - row.seen_at > PAUSE_MS) {
    conn.prepare("UPDATE research_seen SET before_at = seen_at, seen_at = ? WHERE user_id = ? AND account_id = ?").run(now, userId, accountId);
    return row.seen_at;
  }
  conn.prepare("UPDATE research_seen SET seen_at = ? WHERE user_id = ? AND account_id = ?").run(now, userId, accountId);
  return row.before_at;
}


/** Every kept finding of these notes, with its read and when its note was kept. */
export function briefItemsOf(notes: Array<{ doc: { id: string }; meta: ResearchMeta }>): BriefItem[] {
  return notes.flatMap((n) => {
    const kept = new Set(keptFindings(n.meta));
    return n.meta.findings.flatMap((f, index) =>
      kept.has(f) ? [{ noteId: n.doc.id, index, finding: f, asOf: n.meta.generated_at, read: readOf(n.meta, index), acceptedAt: n.meta.accepted_at }] : [],
    );
  });
}

export type Lead = { item: BriefItem; label: string; kind: "why" | "fit" | "topic"; soWhat: string | null };

/**
 * The few lines worth reading first, for the Overview and the one-page
 * summary: the top reason to act, then up to two focus areas with what touches
 * them, then the newest finding per topic to fill. Never the same finding or
 * the same heading twice.
 */
export function overviewLeads(items: BriefItem[], focusAreas: string[], today: string, max = 3): Lead[] {
  const brief = buildBrief(items, focusAreas, null, today);
  const out: Lead[] = [];
  const used = new Set<string>();
  const labels = new Set<string>();
  const add = (item: BriefItem, label: string, kind: Lead["kind"], soWhat: string | null = null) => {
    const key = `${item.noteId}#${item.index}`;
    if (out.length >= max || used.has(key) || labels.has(label)) return;
    used.add(key);
    labels.add(label);
    out.push({ item, label, kind, soWhat });
  };
  const why = brief.events[0] ?? brief.triggers[0];
  if (why) add(why, why.read?.signal === "compelling_event" ? "Compelling event" : "Trigger", "why");
  let fits = 0;
  for (const f of brief.fit) {
    // The area's newest finding not already shown, so a fit is not lost
    // because its best evidence is the reason to act above it.
    const next = f.items.find((k) => !used.has(`${k.noteId}#${k.index}`));
    if (fits >= 2 || !next) continue;
    const before = out.length;
    add(next, f.area, "fit", next.read?.so_what ?? null);
    if (out.length > before) fits += 1;
  }
  for (const item of [...items].sort(order)) add(item, TOPIC_LABELS[item.finding.topic as Topic] ?? item.finding.topic, "topic");
  return out;
}
