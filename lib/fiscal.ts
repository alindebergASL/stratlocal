// Fiscal calendar. The year starts on the first day of FISCAL_YEAR_START_MONTH
// (1-12, default 8 = August) and is named for the calendar year in which it
// ENDS: with an August start, 2026-08-01 falls in FY27 Q1. Real fiscal
// calendars can end on a weekday rather than a month boundary, so the value
// stored on a deal is editable and this function only supplies the default.

export type FiscalQuarter = { fy: number; q: 1 | 2 | 3 | 4; label: string; key: number };
import { todayParts } from "./clock";

export function fiscalYearStartMonth(): number {
  const raw = Number(process.env.FISCAL_YEAR_START_MONTH ?? "8");
  return Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : 8;
}

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

export function fiscalQuarterFor(year: number, month: number, startMonth = fiscalYearStartMonth()): FiscalQuarter {
  const offset = (month - startMonth + 12) % 12;
  const q = (Math.floor(offset / 3) + 1) as 1 | 2 | 3 | 4;
  const fy = startMonth === 1 ? year : month >= startMonth ? year + 1 : year;
  return { fy, q, label: `FY${String(fy).slice(-2)} Q${q}`, key: fy * 10 + q };
}

// Returns null for anything that is not an ISO date (YYYY-MM-DD...).
export function fiscalQuarter(isoDate: string, startMonth?: number): FiscalQuarter | null {
  const p = parseIsoDate(isoDate);
  if (!p) return null;
  return fiscalQuarterFor(p.y, p.m, startMonth);
}

// Reads the current calendar day in the app's timezone: on the last evening
// of a quarter, UTC has already rolled over and would turn it a day early.
export function currentFiscalQuarter(now = new Date()): FiscalQuarter {
  const { year, month } = todayParts(now);
  return fiscalQuarterFor(year, month);
}

// Parses a stored label like "FY27 Q2" back to a sortable key; null if malformed.
export function keyFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /^FY(\d{2,4})\s*Q([1-4])$/i.exec(label.trim());
  if (!m) return null;
  let fy = Number(m[1]);
  if (fy < 100) fy += 2000;
  return fy * 10 + Number(m[2]);
}

// One spelling per quarter. The CRM report writes "FY27Q2" in one row and
// "FY27 Q2" in the next, and the pipeline grouped by the raw text, so one
// quarter appeared as two groups. Anything that parses becomes "FY27 Q2";
// anything that does not is kept as written, trimmed.
export function quarterLabel(label: string | null | undefined): string | null {
  const key = keyFromLabel(label);
  if (key === null) return label?.trim() || null;
  return `FY${String(Math.floor(key / 10) % 100).padStart(2, "0")} Q${key % 10}`;
}
