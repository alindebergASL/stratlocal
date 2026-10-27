// How Ask is doing, from what is already stored: the numbers the perception
// review said to watch in the first weeks (docs/ask-perception-review.md).
// Nothing here is sent anywhere or asks a model.
import { db } from "../db";
import { IS_REPORT } from "./report";

export type AskHealth = {
  days: number;
  answered: number;
  failed: number;
  medianSeconds: number | null;
  medianCents: number | null;
  totalCents: number;
  useful: number;
  wrong: number;
  unmarked: number;
  proposals: { accepted: number; waiting: number; rejected: number };
  reports: { written: number; shared: number };
  /** Questions asked more than once: the starters that earn their place, and habits. */
  repeated: Array<{ text: string; times: number }>;
};

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function askHealth(now = Date.now(), days = 30): AskHealth {
  const conn = db();
  const since = now - days * 86400000;
  const runs = conn.prepare(`SELECT status, started_at, finished_at, cost_cents FROM ai_runs WHERE kind = 'ask' AND started_at >= ?`).all(since) as Array<{ status: string; started_at: number; finished_at: number | null; cost_cents: number | null }>;
  const done = runs.filter((r) => r.status === "done");
  const verdicts = conn.prepare(`SELECT verdict, COUNT(*) AS n FROM ask_messages WHERE role = 'assistant' AND created_at >= ? GROUP BY verdict`).all(since) as Array<{ verdict: string | null; n: number }>;
  const v = (k: string | null) => verdicts.find((r) => r.verdict === k)?.n ?? 0;
  const props = conn.prepare(`SELECT status, COUNT(*) AS n FROM proposals WHERE origin_id LIKE 'ask:%' AND created_at >= ? GROUP BY status`).all(since) as Array<{ status: string; n: number }>;
  const p = (k: string) => props.find((r) => r.status === k)?.n ?? 0;
  const reports = conn.prepare(`SELECT COUNT(*) AS written, SUM(CASE WHEN share_token IS NOT NULL THEN 1 ELSE 0 END) AS shared FROM documents WHERE ${IS_REPORT} AND created_at >= ?`).get(since) as { written: number; shared: number | null };
  const repeated = conn
    .prepare(`SELECT MIN(text) AS text, COUNT(*) AS times FROM ask_messages WHERE role = 'user' AND created_at >= ? GROUP BY LOWER(TRIM(text)) HAVING COUNT(*) > 1 ORDER BY times DESC, text LIMIT 5`)
    .all(since) as Array<{ text: string; times: number }>;
  return {
    days,
    answered: done.length,
    failed: runs.filter((r) => r.status === "failed").length,
    medianSeconds: median(done.flatMap((r) => (r.finished_at ? [Math.round((r.finished_at - r.started_at) / 1000)] : []))),
    medianCents: median(done.flatMap((r) => (r.cost_cents == null ? [] : [r.cost_cents]))),
    totalCents: runs.reduce((n, r) => n + (r.cost_cents ?? 0), 0),
    useful: v("useful"),
    wrong: v("wrong"),
    unmarked: v(null),
    proposals: { accepted: p("accepted"), waiting: p("pending"), rejected: p("rejected") },
    reports: { written: reports.written, shared: reports.shared ?? 0 },
    repeated,
  };
}
