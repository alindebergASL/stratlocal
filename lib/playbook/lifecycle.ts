// Where an account is in the playbook's lifecycle: the step it is on, what
// has been ticked off, and the one thing to do next.
//
// The step is where a person put it. Before anyone has, the account is not
// "in" the playbook at all and nothing nags about it; the Playbook tab offers
// to start. Ticks are kept by the item's text, so an item reworded in the
// playbook starts unticked rather than carrying a tick it never earned.
import { db } from "../db";
import { addDays } from "../clock";
import { newId } from "../ids";
import { ApplyError } from "../proposals/apply";
import { defaultSlug } from "./store";
import type { Playbook } from "./schema";

type PlaybookStep = Playbook["steps"][number];

export type StepState = {
  step: PlaybookStep;
  index: number;
  checks: Array<{ item: string; doneAt: number | null; doneBy: string | null }>;
  done: number;
};

export type Lifecycle = {
  started: boolean;
  steps: StepState[];
  current: StepState | null;
  /** When the account moved to the current step. */
  since: number | null;
  next: { text: string; step: StepState } | null;
  moves: Array<{ stepId: string; at: number; by: string | null }>;
};

type MoveRow = { step_id: string; moved_at: number; moved_by: string | null };
type CheckRow = { step_id: string; item: string; done_at: number; done_by: string | null };

export function lifecycle(accountId: string, playbook: Playbook): Lifecycle {
  const conn = db();
  const moves = conn.prepare(`SELECT step_id, moved_at, moved_by FROM account_playbook_moves WHERE account_id = ? ORDER BY moved_at DESC, rowid DESC`).all(accountId) as MoveRow[];
  const checks = conn.prepare(`SELECT step_id, item, done_at, done_by FROM account_playbook_checks WHERE account_id = ?`).all(accountId) as CheckRow[];
  const ticked = new Map(checks.map((c) => [`${c.step_id}\u0000${c.item}`, c]));
  const steps: StepState[] = playbook.steps.map((step, index) => {
    const list = step.checklist.map((item) => {
      const c = ticked.get(`${step.id}\u0000${item}`);
      return { item, doneAt: c?.done_at ?? null, doneBy: c?.done_by ?? null };
    });
    return { step, index, checks: list, done: list.filter((c) => c.doneAt !== null).length };
  });
  // The latest move to a step the playbook still has.
  const last = moves.find((m) => steps.some((s) => s.step.id === m.step_id));
  const current = last ? steps.find((s) => s.step.id === last.step_id)! : null;
  let next: Lifecycle["next"] = null;
  if (current) {
    const open = current.checks.find((c) => c.doneAt === null);
    const after = steps[current.index + 1];
    if (open) next = { text: open.item, step: current };
    else if (after) next = { text: `Move on to ${after.step.name}`, step: after };
  }
  return {
    started: !!current,
    steps,
    current,
    since: last?.moved_at ?? null,
    next,
    moves: moves.map((m) => ({ stepId: m.step_id, at: m.moved_at, by: m.moved_by })),
  };
}

export function moveToStep(accountId: string, playbook: Playbook, stepId: string, userId: string, now = Date.now()): void {
  if (!playbook.steps.some((s) => s.id === stepId)) throw new ApplyError("That step is not in the playbook.", "validation");
  const conn = db();
  const at = conn.prepare(`SELECT step_id FROM account_playbook_moves WHERE account_id = ? ORDER BY moved_at DESC, rowid DESC LIMIT 1`).get(accountId) as { step_id: string } | undefined;
  if (at?.step_id === stepId) return;
  conn.prepare(`INSERT INTO account_playbook_moves (id, account_id, step_id, moved_at, moved_by) VALUES (?, ?, ?, ?, ?)`).run(newId(), accountId, stepId, now, userId);
}

export function setCheck(accountId: string, playbook: Playbook, stepId: string, item: string, done: boolean, userId: string, now = Date.now()): void {
  const step = playbook.steps.find((s) => s.id === stepId);
  if (!step || !step.checklist.includes(item)) throw new ApplyError("That item is not on the step's checklist.", "validation");
  const conn = db();
  if (done) {
    conn.prepare(`INSERT OR IGNORE INTO account_playbook_checks (account_id, step_id, item, done_at, done_by) VALUES (?, ?, ?, ?, ?)`).run(accountId, stepId, item, now, userId);
  } else {
    conn.prepare(`DELETE FROM account_playbook_checks WHERE account_id = ? AND step_id = ? AND item = ?`).run(accountId, stepId, item);
  }
}

/**
 * A timebox as a number of days to a deadline, when it says one: "48 hours",
 * "5 days", "2 weeks", "Within 24 hours, then quarterly". A duration of work
 * ("90 to 120 minutes") or a lead time ("3 to 5 business days before") is not
 * a deadline and gives null.
 */
export function timeboxDays(timebox: string | null | undefined): number | null {
  if (!timebox || /\bbefore\b/i.test(timebox)) return null;
  const m = /(\d+)(?:\s*(?:to|-|–)\s*(\d+))?\s*(?:business\s+|working\s+)?(hours?|hrs?|days?|weeks?)\b/i.exec(timebox);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  const unit = m[3]!.toLowerCase();
  const days = unit.startsWith("h") ? Math.ceil(n / 24) : unit.startsWith("w") ? n * 7 : n;
  return days > 0 ? days : null;
}

/** The deadline a step's timebox sets from a day, or null when it sets none. */
export function stepDue(step: PlaybookStep, fromDay: string): string | null {
  const days = timeboxDays(step.timebox);
  return days === null ? null : addDays(fromDay, days);
}

/** How many accounts sit at each step, and for how long, across the team. */
export function playbookHealth(playbook: Playbook, now = Date.now(), slug: string | null = null): Array<{ step: PlaybookStep; accounts: number; medianDays: number | null }> {
  // Only the accounts that use this playbook, when the team has more than one.
  const def = defaultSlug();
  const rows = db()
    .prepare(
      `SELECT m.account_id, m.step_id, m.moved_at FROM account_playbook_moves m
       JOIN accounts a ON a.id = m.account_id AND a.archived_at IS NULL
       WHERE ? IS NULL OR COALESCE(a.playbook_slug, ?) = ?
       ORDER BY m.moved_at DESC, m.rowid DESC`,
    )
    .all(slug, def, slug) as Array<{ account_id: string; step_id: string; moved_at: number }>;
  const latest = new Map<string, { step_id: string; moved_at: number }>();
  for (const r of rows) if (!latest.has(r.account_id) && playbook.steps.some((s) => s.id === r.step_id)) latest.set(r.account_id, r);
  return playbook.steps.map((step) => {
    const here = [...latest.values()].filter((r) => r.step_id === step.id).map((r) => Math.floor((now - r.moved_at) / 86_400_000)).sort((a, b) => a - b);
    return { step, accounts: here.length, medianDays: here.length ? here[Math.floor((here.length - 1) / 2)]! : null };
  });
}
