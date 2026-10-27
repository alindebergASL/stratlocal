// The numbers and switches a person sets on the Assistants page.
//
// Budgets nest: one monthly total is the hard stop for everything. The
// people's share is what button presses are guaranteed; it may also spend
// whatever is not reserved. Each assistant switched to "On its own" reserves
// its own monthly limit, stops there, and never borrows. Turning one off
// frees its reservation.
import { db } from "../db";
import { ASSISTANTS, assistantDef, type AssistantId, type AssistantMode } from "./registry";

function envCents(name: string, fallback: number): number {
  // Blank is unset and zero is zero, as with the daily cap.
  const raw = (process.env[name] ?? "").trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export type BudgetSettings = { monthlyTotalCents: number; peopleShareCents: number };

function readSetting(key: string): string | null {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function cents(raw: string | null, fallback: number): number {
  const n = raw == null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function budgetSettings(): BudgetSettings {
  return {
    monthlyTotalCents: cents(readSetting("ai_monthly_total_cents"), envCents("AI_MONTHLY_CAP_CENTS", 25000)),
    peopleShareCents: cents(readSetting("ai_people_share_cents"), envCents("AI_PEOPLE_SHARE_CENTS", 10000)),
  };
}

export type AssistantSetting = { id: AssistantId; mode: AssistantMode; monthlyCents: number; changed: { by: string | null; at: number } | null };

export function assistantSetting(id: AssistantId): AssistantSetting {
  const def = assistantDef(id)!;
  const row = db().prepare(`SELECT * FROM assistant_settings WHERE assistant = ?`).get(id) as
    | { mode: AssistantMode; monthly_cents: number; updated_by: string | null; updated_at: number }
    | undefined;
  // Only an assistant whose modes are built can be anything but its default.
  const mode = def.availability === "modes" ? (row?.mode ?? def.defaultMode) : def.defaultMode;
  return { id, mode, monthlyCents: row?.monthly_cents ?? def.defaultCents, changed: row ? { by: row.updated_by, at: row.updated_at } : null };
}

export function assistantMode(id: AssistantId): AssistantMode {
  return assistantSetting(id).mode;
}

export function allAssistantSettings(): AssistantSetting[] {
  return ASSISTANTS.map((a) => assistantSetting(a.id));
}

/** What the assistants that run on their own hold back from everyone else. */
export function reservedCents(settings = allAssistantSettings()): number {
  return settings.filter((s) => s.mode === "auto").reduce((n, s) => n + s.monthlyCents, 0);
}

export class SettingsError extends Error {}

// The one rule that keeps the nesting honest: the people's share and every
// reservation together fit inside the total.
export function checkBudgetFits(budget: BudgetSettings, settings: AssistantSetting[]): string | null {
  const reserved = reservedCents(settings);
  if (budget.peopleShareCents + reserved > budget.monthlyTotalCents) {
    const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
    return `That does not fit: your share (${$(budget.peopleShareCents)}) and the assistants running on their own (${$(reserved)}) add up to more than the monthly total (${$(budget.monthlyTotalCents)}).`;
  }
  return null;
}

const MAX_CENTS = 10_000_00;

function checkCents(n: number, what: string) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_CENTS) throw new SettingsError(`${what} must be a whole number of cents between $0 and $10,000.`);
}

export function saveBudget(next: BudgetSettings, userId: string) {
  checkCents(next.monthlyTotalCents, "The monthly total");
  checkCents(next.peopleShareCents, "Your share");
  const problem = checkBudgetFits(next, allAssistantSettings());
  if (problem) throw new SettingsError(problem);
  const put = db().prepare(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  db().transaction(() => {
    put.run("ai_monthly_total_cents", String(next.monthlyTotalCents), userId, now);
    put.run("ai_people_share_cents", String(next.peopleShareCents), userId, now);
  })();
}

export function saveAssistant(id: AssistantId, next: { mode: AssistantMode; monthlyCents: number }, userId: string) {
  const def = assistantDef(id);
  if (!def) throw new SettingsError("No such assistant.");
  if (def.availability !== "modes") throw new SettingsError(`${def.name} cannot be switched yet.`);
  if (!["off", "ask", "auto"].includes(next.mode)) throw new SettingsError("Choose Off, When I ask or On its own.");
  checkCents(next.monthlyCents, `${def.name}'s limit`);
  const settings = allAssistantSettings().map((s) => (s.id === id ? { ...s, ...next } : s));
  const problem = checkBudgetFits(budgetSettings(), settings);
  if (problem) throw new SettingsError(problem);
  db()
    .prepare(
      `INSERT INTO assistant_settings (assistant, mode, monthly_cents, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(assistant) DO UPDATE SET mode = excluded.mode, monthly_cents = excluded.monthly_cents, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(id, next.mode, next.monthlyCents, userId, Date.now());
}
