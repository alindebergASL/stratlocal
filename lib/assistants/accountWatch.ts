// Account watch: once a week, for each account a person chose, a web search
// for what is new, left as a research note to keep or drop.
//
// What leaves the box is what any research run sends (DECISIONS #3): the
// account's public name, headquarters and region, and a question this file
// writes — never a play, a deal or a person. Which findings touch a play is
// decided here, by code, from the words they share (DECISIONS #4: web text
// reaches no model until a person keeps it). The words are shown with the
// match, so the grounds are on the page.
import { db, OWN_WORK_ACCOUNT_ID, type AiRunRow } from "../db";
import { BudgetError, estimateRunCents, startOfToday } from "../ai/guard";
import { listNotes } from "../research/notes";
import { startResearchRun } from "../research/run";
import type { ResearchFinding } from "../research/schema";
import { beginAssistantRun, endAssistantRun, type RunTrigger } from "./runs";

/** The default pace, and the paces a person may choose per account (DECISIONS #100). */
export const WATCH_EVERY_DAYS = 7;
export const WATCH_PACES = [1, 3, 7, 14] as const;
export type WatchPace = (typeof WATCH_PACES)[number];
export const PACE_LABEL: Record<WatchPace, string> = { 1: "Daily", 3: "Every 3 days", 7: "Weekly", 14: "Every 2 weeks" };
export function isWatchPace(n: number): n is WatchPace {
  return (WATCH_PACES as readonly number[]).includes(n);
}
export const WATCH_QUESTION =
  "What is new in the last two months: announcements, leadership changes, funding or budget news, technology programmes, procurement and partnerships. Only items published recently, each with its date.";

export type WatchedAccount = { id: string; name: string; lastLook: number | null; draftWaiting: boolean; running: boolean; everyDays: WatchPace };

export function watchedAccounts(): WatchedAccount[] {
  const rows = db()
    .prepare(
      `SELECT a.id, a.name, w.every_days,
              (SELECT MAX(r.started_at) FROM ai_runs r WHERE r.account_id = a.id AND r.assistant = 'account_watch') AS last_look,
              EXISTS (SELECT 1 FROM ai_runs r WHERE r.account_id = a.id AND r.status = 'running') AS running
       FROM watched_accounts w JOIN accounts a ON a.id = w.account_id
       WHERE a.archived_at IS NULL AND a.id != ?
       ORDER BY a.name COLLATE NOCASE`,
    )
    .all(OWN_WORK_ACCOUNT_ID) as Array<{ id: string; name: string; every_days: number; last_look: number | null; running: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, lastLook: r.last_look, running: !!r.running, draftWaiting: listNotes(r.id, "draft").length > 0, everyDays: isWatchPace(r.every_days) ? r.every_days : WATCH_EVERY_DAYS }));
}

export function isWatched(accountId: string): boolean {
  return !!db().prepare(`SELECT 1 FROM watched_accounts WHERE account_id = ?`).get(accountId);
}

/** How often this account is looked at, or null when it is not watched. */
export function watchPace(accountId: string): WatchPace | null {
  const row = db().prepare(`SELECT every_days FROM watched_accounts WHERE account_id = ?`).get(accountId) as { every_days: number } | undefined;
  return row ? (isWatchPace(row.every_days) ? row.every_days : WATCH_EVERY_DAYS) : null;
}

export function setWatched(accountId: string, on: boolean, userId: string, everyDays: WatchPace = WATCH_EVERY_DAYS) {
  if (on) {
    if (!isWatchPace(everyDays)) throw new BudgetError("Choose daily, every 3 days, weekly or every 2 weeks.");
    const a = db().prepare(`SELECT id, archived_at, kind FROM accounts WHERE id = ?`).get(accountId) as { id: string; archived_at: string | null; kind: string } | undefined;
    if (!a || a.archived_at || a.kind !== "customer") throw new BudgetError("Only a current customer account can be watched.");
    db()
      .prepare(`INSERT INTO watched_accounts (account_id, added_by, added_at, every_days) VALUES (?, ?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET every_days = excluded.every_days`)
      .run(accountId, userId, Date.now(), everyDays);
  } else db().prepare(`DELETE FROM watched_accounts WHERE account_id = ?`).run(accountId);
}

/** What a month of looks would cost at each account's pace, from what research has cost lately. */
export function watchEstimate(watched: Array<Pick<WatchedAccount, "everyDays">> = watchedAccounts()): { perLookCents: number; monthlyCents: number; looksPerMonth: number } {
  const perLook = estimateRunCents("research");
  const looks = watched.reduce((n, w) => n + 365 / 12 / w.everyDays, 0);
  return { perLookCents: perLook, monthlyCents: Math.round(perLook * looks), looksPerMonth: Math.round(looks) };
}

// The account to look at next: the one looked at longest ago, skipping any
// with a run going or a draft nobody has reviewed. On the clock, only once a
// week each; pressed by hand ("try it on one account"), whichever is next.
//
// On the clock it also passes over an account somebody researched by hand
// in the last month: a weekly look straight after a full run pays for news
// that run has just read.
export const FRESH_RESEARCH_DAYS = 30;

export function researchedByHandSince(accountId: string, sinceMs: number): boolean {
  return !!db()
    .prepare(
      `SELECT 1 FROM documents d JOIN ai_runs r ON r.id = d.ai_run_id
        WHERE d.account_id = ? AND d.kind = 'research_note' AND d.status = 'accepted' AND d.archived_at IS NULL
          AND r.assistant IS NULL AND d.created_at >= ? LIMIT 1`,
    )
    .get(accountId, sinceMs);
}

export function nextToWatch(now = Date.now(), manual = false): WatchedAccount | null {
  const fresh = now - FRESH_RESEARCH_DAYS * 86400_000;
  // Each account at its own pace.
  const due = (w: WatchedAccount) => !w.lastLook || w.lastLook <= now - w.everyDays * 86400_000;
  const ready = watchedAccounts()
    .filter((w) => !w.running && !w.draftWaiting && (manual || due(w)))
    // A faster pace was asked for on purpose: there, only research done by
    // hand since the last due look counts as fresh.
    .filter((w) => manual || !researchedByHandSince(w.id, w.everyDays >= WATCH_EVERY_DAYS ? fresh : now - w.everyDays * 86400_000))
    .sort((a, b) => (a.lastLook ?? 0) - (b.lastLook ?? 0) || a.name.localeCompare(b.name));
  return ready[0] ?? null;
}

export type WatchResult = { runId: string; accountId: string | null; accountName: string | null; started: boolean; reason: string };

// One account per look. A scheduled look that finds nothing due records
// nothing; the next tick tries again.
export function runAccountWatch(trigger: RunTrigger, userId: string | null, now = Date.now()): WatchResult | null {
  const next = nextToWatch(now, trigger === "manual");
  if (!next && trigger === "schedule") return null;
  const runId = beginAssistantRun("account_watch", trigger, userId);
  if (!next) {
    const reason = watchedAccounts().length === 0 ? "No account is being watched yet." : "Every watched account has a look running, a note waiting for review, or research done by hand this month.";
    endAssistantRun(runId, { status: "skipped", summary: reason });
    return { runId, accountId: null, accountName: null, started: false, reason };
  }
  try {
    const aiRun = startResearchRun({ accountId: next.id, userId, focus: WATCH_QUESTION, depth: "standard", assistant: "account_watch", onlyNew: true });
    const reason = `Looking for news about ${next.name}.`;
    endAssistantRun(runId, { status: "done", summary: reason, result: { accountId: next.id, aiRunId: aiRun } });
    return { runId, accountId: next.id, accountName: next.name, started: true, reason };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    endAssistantRun(runId, { status: "skipped", summary: `${next.name}: ${reason}` });
    if (!(e instanceof BudgetError)) throw e;
    return { runId, accountId: next.id, accountName: next.name, started: false, reason };
  }
}

// ---- does it touch a play? -------------------------------------------------

const STOP = new Set(
  "about above after again against also among another around because been before being below between both came come could does doing done down during each either else even every from further have having here into just like made make many more most much must near need next only other over said same should since some still such than that their them then there these they this those through under until upon very want were what when where which while will with within would year years your account accounts company customer plan plans project projects program programme programmes platform team teams work new news".split(
    " ",
  ),
);

export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9-]*/g)) {
    const raw = m[0];
    const w = raw.toLowerCase().replace(/-+$/, "");
    // Short all-capitals words are acronyms (EHR, ERP) and carry meaning.
    if ((w.length >= 4 || (raw.length >= 2 && raw === raw.toUpperCase() && raw.length <= 5)) && !STOP.has(w)) out.add(w.replace(/s$/, ""));
  }
  return out;
}

export type PlayVocab = { id: string; title: string; words: Set<string> };

export function playVocab(accountId: string): PlayVocab[] {
  const plays = db()
    .prepare(`SELECT id, title, thesis, next_step, deal_ids_json FROM plays WHERE account_id = ? AND archived_at IS NULL AND merged_into IS NULL AND status IN ('proposed','active','stalled')`)
    .all(accountId) as Array<{ id: string; title: string; thesis: string | null; next_step: string | null; deal_ids_json: string }>;
  return plays.map((p) => {
    let deals: string[] = [];
    try {
      deals = JSON.parse(p.deal_ids_json) as string[];
    } catch {
      deals = [];
    }
    const dealNames = deals.length
      ? (db().prepare(`SELECT name FROM deals WHERE deal_id IN (${deals.map(() => "?").join(",")})`).all(...deals) as Array<{ name: string }>).map((d) => d.name)
      : [];
    return { id: p.id, title: p.title, words: terms([p.title, p.thesis ?? "", p.next_step ?? "", ...dealNames].join(" ")) };
  });
}

export type Touch = { playId: string; playTitle: string; words: string[] };

// A finding touches a play when they share at least two meaningful words, or
// one that is in the play's own title.
export function touches(finding: Pick<ResearchFinding, "text" | "quote">, plays: PlayVocab[]): Touch[] {
  const mine = terms(`${finding.text} ${finding.quote}`);
  const out: Touch[] = [];
  for (const p of plays) {
    const shared = [...p.words].filter((w) => mine.has(w));
    const inTitle = shared.filter((w) => terms(p.title).has(w));
    if (shared.length >= 2 || inTitle.length >= 1) out.push({ playId: p.id, playTitle: p.title, words: shared.slice(0, 4) });
  }
  return out;
}

// ---- what it left ----------------------------------------------------------

export type WatchDraft = { accountId: string; accountName: string; documentId: string; findings: number; touching: number; signals: number };

/** Notes Account watch wrote that nobody has kept or dropped yet. */
export function watchDrafts(): WatchDraft[] {
  const docs = db()
    .prepare(
      `SELECT d.id, d.account_id, a.name AS account_name FROM documents d
       JOIN ai_runs r ON r.id = d.ai_run_id AND r.assistant = 'account_watch'
       JOIN accounts a ON a.id = d.account_id AND a.archived_at IS NULL
       WHERE d.kind = 'research_note' AND d.status = 'draft' AND d.archived_at IS NULL
       ORDER BY d.created_at DESC LIMIT 50`,
    )
    .all() as Array<{ id: string; account_id: string; account_name: string }>;
  return docs.map((d) => {
    const note = listNotes(d.account_id, "draft").find((n) => n.doc.id === d.id);
    const findings = note?.meta.findings ?? [];
    const vocab = playVocab(d.account_id);
    // Reasons to act, from the run's own read of what it found (DECISIONS #58).
    const signals = Object.values(note?.meta.reads ?? {}).filter((r) => r.signal).length;
    return { accountId: d.account_id, accountName: d.account_name, documentId: d.id, findings: findings.length, touching: findings.filter((f) => touches(f, vocab).length > 0).length, signals };
  });
}

export function watchedToday(sinceMs = startOfToday()): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM ai_runs WHERE assistant = 'account_watch' AND started_at >= ?`).get(sinceMs) as { n: number }).n;
}

export function isWatchRun(run: Pick<AiRunRow, "assistant"> | null | undefined): boolean {
  return run?.assistant === "account_watch";
}
