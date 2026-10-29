import type { Segment } from "./evidence";

// Resolve alternate references only when the original text identifies one location.
// Canonical locators and quotations remain subject to the normal strict checks.
export function normalizeSourceLocation(source: { path: string; locator?: string; quote?: string }, segments: Segment[]): string | null {
  if (!source.locator || segments.some(s => s.locator === source.locator)) return null;
  const original = source.locator;
  const heading = (s: string) => s.trim().replace(/^#{1,6}\s*/, "").replace(/^section\s+/i, "").replace(/^(\d+)\s*[-.:]\s*/, "$1 ").replace(/\s+/g, " ").toLowerCase();
  const headings = segments.filter(s => heading(s.label) === heading(original));
  const quoted = source.quote ? segments.filter(s => s.text.includes(source.quote!)) : [];
  const match = source.quote
    ? quoted.length === 1 ? quoted[0] : headings.length === 1 && headings[0]!.text.includes(source.quote) ? headings[0] : undefined
    : headings.length === 1 ? headings[0] : undefined;
  if (!match) return null;
  source.locator = match.locator;
  return `Resolved source location in ${source.path}: “${original}” → ${match.locator} using ${source.quote ? "an exact quotation" : "a unique heading"}. Original file retained.`;
}
