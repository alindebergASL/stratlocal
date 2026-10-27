// Reading an amount the way a person writes one.
//
// This lived in app/formFields.ts, which is where a form submission is turned
// into a payload. It moved here when the spreadsheet import needed it too:
// lib/ importing from app/ is the wrong direction, and a money cell in a CRM
// export has exactly the same shapes in it as a money box on a form — "$1K",
// "250", "1,500,000".
//
// app/formFields.ts re-exports both names, so every existing caller and every
// existing test still reads the same way.

/** A value a form or a cell offered that cannot be read as what it claims. */
export class FieldError extends Error {}

const MULTIPLIER: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000, bn: 1_000_000_000 };

/**
 * A money field, read the way a seller writes one.
 *
 * This used to strip only "$" and "," and call anything else null — and null is
 * an *explicit clear*, not an omission, so typing "1.2M" into a deal's TCV
 * wrote NULL, dropped the deal out of every pipeline total, and returned
 * "saved". Suffixes are read; a fractional amount rounds rather than being
 * rejected, because rejecting it threw away every other edit in the same form;
 * and text that is not an amount at all fails loudly, naming what was typed.
 */
export function readMoney(raw: string | null, label = "Amount"): number | null {
  if (raw === null) return null;
  const s = raw.trim();
  if (s === "") return null;
  const m = /^(-?\d*\.?\d+)(k|m|b|bn)?$/i.exec(s.replace(/[$,\s]/g, ""));
  if (!m) throw new FieldError(`${label}: could not read “${s}” as an amount. Try 1000, $1K or 250.`);
  const n = Number(m[1]) * (m[2] ? (MULTIPLIER[m[2].toLowerCase()] ?? 1) : 1);
  if (!Number.isFinite(n)) throw new FieldError(`${label}: “${s}” is not an amount.`);
  return Math.round(n);
}

/**
 * A share, as a percentage, read the way a person writes one.
 *
 * Deliberately narrow in one respect: `0.34` is read as a third of one per
 * cent, not as thirty-four per cent. Both readings are plausible — a share is
 * written either way in the wild — and guessing between them is a factor of a
 * hundred applied to the figure the whole trend is about, silently, on a
 * screen where "our share of their compute" is the sentence being read. So a
 * value is taken at face value, and the person writes what they mean.
 *
 * Out of range is refused rather than clamped, for the reason readMoney gives
 * about null: a number quietly turned into a different number is worse than a
 * save that says what it could not take.
 */
export function readPercent(raw: string | null, label = "Share"): number | null {
  if (raw === null) return null;
  const s = raw.trim().replace(/\s|%/g, "");
  if (s === "") return null;
  if (!/^-?\d*\.?\d+$/.test(s)) throw new FieldError(`${label}: could not read “${raw.trim()}” as a percentage. Try 34 or 34%.`);
  const n = Number(s);
  if (!Number.isFinite(n)) throw new FieldError(`${label}: “${raw.trim()}” is not a percentage.`);
  if (n < 0 || n > 100) throw new FieldError(`${label}: ${n}% is not between 0 and 100.`);
  return n;
}
