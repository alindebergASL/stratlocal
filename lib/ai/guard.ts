// Budget and bookkeeping for AI runs. Every model call happens inside a run:
// the row is inserted before the call, updated when it ends, and the daily
// cap is checked against the sum of finished runs plus a reservation for the
// ones still going.
import { db, type AiRunRow } from "../db";
import { newId } from "../ids";
import { aggregateUsage, estimateCostCents, type StageUsage } from "./cost";
import { explainProviderError, providerProblem } from "./client";
import { ROLES, type Role } from "./models";
import { appTimeZone, todayISO } from "../clock";
import { assistantDef, type AssistantId } from "../assistants/registry";
import { allAssistantSettings, assistantSetting, budgetSettings, reservedCents } from "../assistants/settings";

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

export function dailyCapCents(): number {
  // Blank counts as unset, and zero counts as zero.
  //
  // This was `Number(raw ?? "1500")` with `n > 0`, which conflated the two:
  // Number("") is 0, so an empty variable had to fall back — and a deliberate
  // 0, the obvious way to say "spend nothing today", fell back with it and
  // became $15.00. A budget that silently ignores the number you set is worse
  // than one with no default at all.
  const raw = (process.env.AI_DAILY_CAP_CENTS ?? "").trim();
  if (raw === "") return 1500;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1500;
}

// A running job has no cost yet; assume this much so several launched at
// once cannot all slip under the cap.
const RUNNING_RESERVATION_CENTS = 100;

// The cap is a day's spending, so it has to roll over at the user's midnight.
// It used to roll over at UTC midnight, which is 5pm here: "try again
// tomorrow" would have meant "try again this evening", and half a day's
// budget was spent under yesterday's total.
export function startOfToday(): number {
  return startOfDay(todayISO());
}

// The month's budget rolls over on the 1st, at the same local midnight.
export function startOfMonth(): number {
  return startOfDay(`${todayISO().slice(0, 7)}-01`);
}

function startOfDay(today: string): number {
  const zone = appTimeZone();
  // Midnight in the app's zone as an instant: take UTC midnight for that
  // calendar day and correct by the zone's offset on that day.
  const utcMidnight = Date.parse(`${today}T00:00:00Z`);
  const shown = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(new Date(utcMidnight))
    .replace(", ", "T")
    .replace("T24:", "T00:");
  const offsetMs = Date.parse(`${shown}Z`) - utcMidnight;
  return utcMidnight - offsetMs;
}

// What has been spent today against the cap, for the screens. Nothing read
// this before: the cap was invisible until it refused you, and the first words
// anyone saw about the budget were that it had run out.
export function spendToday(): { cents: number; capCents: number; runs: number; running: number; unpriced: number } {
  const s = todaySpend();
  return { ...s, capCents: dailyCapCents() };
}

// What runs still in flight, or finished with no price, are held at: what a
// run of their kind usually costs, by bucket. A flat dollar let several
// concurrent runs of an expensive kind pass a limit together.
function heldByBucket(since: number): Map<string | null, number> {
  const rows = db()
    .prepare(
      `SELECT assistant, kind, COUNT(*) AS n FROM ai_runs
       WHERE started_at >= ? AND (status = 'running' OR cost_cents IS NULL) GROUP BY assistant, kind`,
    )
    .all(since) as Array<{ assistant: string | null; kind: string; n: number }>;
  const out = new Map<string | null, number>();
  for (const r of rows) out.set(r.assistant, (out.get(r.assistant) ?? 0) + r.n * estimateRunCents(r.kind));
  return out;
}

export function todaySpend(): { cents: number; runs: number; running: number; unpriced: number; held: number } {
  const row = db()
    .prepare(
      `SELECT COALESCE(SUM(cost_cents), 0) AS cents, COUNT(*) AS runs,
              SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
              -- A finished run with no cost is one whose model has no price we
              -- know. It contributes zero to the sum above, so without
              -- counting them the cap can read $0.00 all day while real money
              -- is spent, and nothing on any screen would say so.
              SUM(CASE WHEN status != 'running' AND cost_cents IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM ai_runs WHERE started_at >= ?`,
    )
    .get(startOfToday()) as { cents: number; runs: number; running: number; unpriced: number };
  let held = 0;
  for (const n of heldByBucket(startOfToday()).values()) held += n;
  return { cents: row.cents, runs: row.runs, running: row.running ?? 0, unpriced: row.unpriced ?? 0, held };
}

// This month's spending, split by who started it: each assistant that ran on
// its own, and null for every run a person pressed a button for.
export type BucketSpend = { cents: number; runs: number; running: number; unpriced: number; held: number };

export function monthSpendByBucket(): Map<string | null, BucketSpend> {
  const rows = db()
    .prepare(
      `SELECT assistant, COALESCE(SUM(cost_cents), 0) AS cents, COUNT(*) AS runs,
              SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
              SUM(CASE WHEN status != 'running' AND cost_cents IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM ai_runs WHERE started_at >= ? GROUP BY assistant`,
    )
    .all(startOfMonth()) as Array<{ assistant: string | null } & Omit<BucketSpend, "held">>;
  const held = heldByBucket(startOfMonth());
  return new Map(rows.map((r) => [r.assistant, { cents: r.cents, runs: r.runs, running: r.running ?? 0, unpriced: r.unpriced ?? 0, held: held.get(r.assistant) ?? 0 }]));
}

/** Spent plus what is still out: a running or unpriced run is held at what its kind usually costs. */
export function projectedCents(s: BucketSpend | undefined): number {
  return s ? s.cents + s.held : 0;
}

// What the people's share has carried this month: every run a person pressed,
// and every run of an assistant that is not running on its own. Only an
// assistant on its own has money held for it; Run now on one set to "When I
// ask" is a button press like any other, and charging it nowhere let it eat
// into another assistant's reservation unseen.
export function peopleSpentCents(month: Map<string | null, BucketSpend>, settings = allAssistantSettings()): number {
  const auto = new Set(settings.filter((s) => s.mode === "auto").map((s) => s.id));
  let n = 0;
  for (const [bucket, s] of month) if (bucket === null || !auto.has(bucket as AssistantId)) n += projectedCents(s);
  return n;
}

// What a run of this kind usually costs, from the last few that finished
// with a price. With no history, the same reservation a running job gets.
export function estimateRunCents(kind: string): number {
  const rows = db()
    .prepare(`SELECT cost_cents FROM ai_runs WHERE kind = ? AND status = 'done' AND cost_cents IS NOT NULL ORDER BY started_at DESC LIMIT 10`)
    .all(kind) as Array<{ cost_cents: number }>;
  if (rows.length === 0) return RUNNING_RESERVATION_CENTS;
  return Math.ceil(rows.reduce((n, r) => n + r.cost_cents, 0) / rows.length);
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

// The month comes first, then the day, then whose money it is: the total is a
// hard stop for everything, and an assistant never borrows from the people's
// share or from another assistant. Each check counts what this run will
// likely cost, so the last run of the month cannot carry the spend past it.
function checkMonth(input: StartRunInput) {
  const budget = budgetSettings();
  const month = monthSpendByBucket();
  let total = 0;
  for (const s of month.values()) total += projectedCents(s);
  if (budget.monthlyTotalCents === 0) throw new BudgetError("Model calls are switched off: this month's AI total is set to $0.00. Raise it on the Assistants page.");
  if (total + estimateRunCents(input.kind ?? input.role) > budget.monthlyTotalCents) {
    throw new BudgetError(`This month's AI total of ${dollars(budget.monthlyTotalCents)} is spent. It resets on the 1st; the total is on the Assistants page.`);
  }
  return { budget, month, total };
}

function checkBucket(input: StartRunInput, budget: ReturnType<typeof budgetSettings>, month: Map<string | null, BucketSpend>) {
  const next = estimateRunCents(input.kind ?? input.role);
  const settings = allAssistantSettings();
  if (input.assistant) {
    const setting = assistantSetting(input.assistant);
    const name = assistantDef(input.assistant)?.name ?? input.assistant;
    const spent = projectedCents(month.get(input.assistant));
    if (spent + next > setting.monthlyCents) {
      throw new BudgetError(
        `${name} has ${dollars(Math.max(0, setting.monthlyCents - spent))} of its ${dollars(setting.monthlyCents)} left this month, and a run usually costs about ${dollars(next)}. Skipped; raise its limit on the Assistants page.`,
      );
    }
    // On its own, it spends what is held for it. Otherwise it is a press,
    // and the people's share pays as well.
    if (setting.mode === "auto") return;
  }
  const cap = budget.monthlyTotalCents - reservedCents(settings);
  const spent = peopleSpentCents(month, settings);
  if (spent + next > cap) {
    throw new BudgetError(
      `Your share of this month's AI budget is spent: ${dollars(spent)} of ${dollars(cap)}, with the rest held for assistants that run on their own. Raise the total or turn an assistant off on the Assistants page.`,
    );
  }
}

export function getRun(id: string): AiRunRow | null {
  return (db().prepare(`SELECT * FROM ai_runs WHERE id = ?`).get(id) as AiRunRow | undefined) ?? null;
}

// One run per account at a time, so a page with two AI buttons can say so
// before someone presses the second one and gets a red error instead.
export function runningRunFor(accountId: string): AiRunRow | null {
  return (
    (db().prepare(`SELECT * FROM ai_runs WHERE account_id = ? AND status = 'running' LIMIT 1`).get(accountId) as AiRunRow | undefined) ?? null
  );
}

export type StartRunInput = {
  role: Role;
  accountId: string | null;
  userId: string | null;
  inputSummary?: string;
  // What to call this run, when it is not simply the role. The provider check
  // borrows the import and research roles to find out whether each provider
  // answers, and recording those as an import and a research run would make
  // /activity and the spend read as work nobody did.
  kind?: string;
  /** Set when an assistant started this on its own; null or absent when a person pressed something. */
  assistant?: AssistantId | null;
};

// Refuses (throws BudgetError) when the provider is unconfigured, the month's
// total or the daily cap is reached, the run's own budget (an assistant's
// limit, or the people's share) is spent, or the account already has a run in
// flight.
export function startRun(input: StartRunInput): AiRunRow {
  const spec = ROLES[input.role];
  const problem = providerProblem(spec.provider);
  if (problem) throw new BudgetError(problem);
  const { budget, month } = checkMonth(input);
  const spend = todaySpend();
  // A finished run with no cost is one whose model we have no price for. It
  // adds nothing to the sum, so with enough of them the cap reads $0.00 while
  // real money goes out — a budget you cannot measure is not a budget. Rather
  // than invent a number, each one is held at what a run of its kind usually
  // costs, as an in-flight run is, which keeps the cap conservative and makes
  // the problem visible instead of silent.
  const projected = spend.cents + spend.held;
  if (spend.unpriced > 0 && projected >= dailyCapCents()) {
    throw new BudgetError(
      `${spend.unpriced} run${spend.unpriced === 1 ? "" : "s"} today has unknown cost because usage or pricing is missing, so today's spending cannot be measured against the $${(dailyCapCents() / 100).toFixed(2)} budget. Check provider usage and configured rates before authorizing more spending.`,
    );
  }
  if (projected >= dailyCapCents()) {
    // A cap of zero is a real setting — it is how you say "spend nothing
    // today" — and it produced the one message that is simply untrue: nothing
    // had been spent, and it was not going to reset into anything at midnight.
    if (dailyCapCents() === 0) {
      throw new BudgetError(
        "Model calls are switched off: the daily AI budget is set to $0.00. Raise it (AI_DAILY_CAP_CENTS in the server's environment) to make one.",
      );
    }
    // This named an environment variable to a salesperson, and "tomorrow" is
    // the one thing the reader needs: the cap resets at midnight here, not at
    // UTC midnight, which is the middle of the afternoon.
    throw new BudgetError(
      `Today's AI budget of $${(dailyCapCents() / 100).toFixed(2)} is spent. It resets at midnight; the cap is AI_DAILY_CAP_CENTS in the server's environment.`,
    );
  }
  checkBucket(input, budget, month);
  if (input.accountId) {
    const running = db()
      .prepare(`SELECT id FROM ai_runs WHERE account_id = ? AND status = 'running'`)
      .get(input.accountId) as { id: string } | undefined;
    if (running) throw new BudgetError("Another AI run is already in progress for this account.");
  }
  const id = newId();
  const started = Date.now();
  db()
    .prepare(
      `INSERT INTO ai_runs (id, account_id, kind, provider, model, status, input_summary, created_by, started_at, assistant)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    )
    .run(id, input.accountId, input.kind ?? input.role, spec.provider, spec.model, input.inputSummary ?? null, input.userId, started, input.assistant ?? null);
  return getRun(id)!;
}

// A run is finished once. The second call does nothing and says so.
//
// This was an unconditional UPDATE, and the cost of that is not hypothetical:
// lib/ai/smoke.ts called finishRun with the real usage and then went on
// shaping its reply inside the same try. Anything throwing after that point —
// a provider response whose shape the code did not expect, and the response
// was cast rather than parsed — ran the catch, which called finishRun again
// with no stages. estimateCostCents([]) is {cents: 0}, not null, because its
// loop never runs. So a call that was made and billed was rewritten as a
// failure that cost nothing, todaySpend() under-counted real money
// permanently, and it did not even show as unpriced, because 0 is not NULL.
//
// Every caller benefits: a double-finish is always a bug, and the run row is
// the only record that money left the building.
export function finishRun(id: string, outcome: { stages: StageUsage[]; result?: unknown; error?: string | null }): boolean {
  // No received usage is not evidence of a free research call. Keep the
  // provider-check and other existing empty-stage semantics unchanged.
  const missingResearchUsage = !!outcome.error && outcome.stages.length === 0 && getRun(id)?.kind === "research";
  const cost = missingResearchUsage ? null : estimateCostCents(outcome.stages);
  const usage = { ...aggregateUsage(outcome.stages), stages: outcome.stages, cost_estimated: cost?.estimated ?? null };
  const r = db()
    .prepare(
      `UPDATE ai_runs SET status = ?, usage_json = ?, cost_cents = ?, error = ?, result_json = CASE WHEN ? THEN result_json ELSE ? END, finished_at = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(
      outcome.error ? "failed" : "done",
      JSON.stringify(usage),
      cost?.cents ?? null,
      outcome.error ?? null,
      outcome.result === undefined ? 1 : 0,
      outcome.result === undefined ? null : JSON.stringify(outcome.result),
      Date.now(),
      id,
    );
  return r.changes > 0;
}

// Runs the job after the response has been sent. The run row is the only
// record; the page polls /api/ai-runs/[id] until status leaves "running".
export function runDetached(runId: string, job: (stages: StageUsage[]) => Promise<unknown>) {
  const stages: StageUsage[] = [];
  void job(stages)
    .then((result) => finishRun(runId, { stages, result }))
    .catch((error: unknown) => {
      // `error.message` alone threw away the class name, which for an AWS
      // failure is the whole diagnosis: AccessDeniedException's message is
      // "User: arn:... is not authorized to perform: bedrock:InvokeModel", and
      // the word that says what to do about it is in the name.
      //
      // And explainProviderError was written last phase for exactly these five
      // failures and reached only the smoke check and the backup check — so
      // the six surfaces where an AccessDenied or an IMDSv2 hop limit will
      // actually appear (import, extraction, brief, research, plan draft, the
      // invite) all recorded the raw string. This is that path.
      const message = explainProviderError(error);
      console.error(`[ai-run ${runId}] failed:`, message);
      finishRun(runId, { stages, error: message.slice(0, 2000) });
    });
}
