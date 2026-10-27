// An answer or a report as plain text, to paste into an email: the same
// blocks the page draws (lib/ask/markdown.tsx), with headings in capitals,
// tables as aligned columns, and the sources listed by name under it.
import { parseBlocks } from "./markdown";
import type { ChartData } from "./charts";
import { fmtMoneyShort } from "../format";

type Source = { n: number; label: string; account?: string | null };

const unbold = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

function table(head: string[], rows: string[][]): string[] {
  const all = [head, ...rows].map((r) => r.map(unbold));
  const widths = head.map((_, c) => Math.min(40, Math.max(...all.map((r) => (r[c] ?? "").length))));
  const line = (r: string[]) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]!))).join("  ").trimEnd();
  return [line(all[0]!), widths.map((w) => "-".repeat(w)).join("  "), ...all.slice(1).map(line)];
}

export function markdownToText(text: string): string {
  const out: string[] = [];
  for (const b of parseBlocks(text)) {
    if (b.kind === "heading") out.push(unbold(b.text).toUpperCase());
    else if (b.kind === "paragraph") out.push(unbold(b.text));
    else if (b.kind === "list") out.push(b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : "-"} ${unbold(item)}`).join("\n"));
    else out.push(table(b.head, b.rows).join("\n"));
  }
  return out.join("\n\n");
}

export function sourcesToText(sources: Source[]): string {
  if (!sources.length) return "";
  return ["SOURCES", ...[...sources].sort((a, b) => a.n - b.n).map((s) => `[${s.n}] ${s.label}${s.account ? ` (${s.account})` : ""}`)].join("\n");
}

/** A chart as a small text table: the title, then each bar's label and value. */
export function chartToText(c: ChartData): string {
  const fmt = (v: number) => (c.unit === "usd" ? fmtMoneyShort(v) : String(v));
  const rows = c.rows.length ? table(["", c.unit === "usd" ? "Value" : "Deals"], c.rows.map((r) => [r.label, fmt(r.value)])).slice(2) : [c.note ?? "Nothing to show."];
  return [`${c.title.toUpperCase()} (as of ${c.asOf})`, ...rows].join("\n");
}

/** A report: title, who and when, summary, sections, sources. */
export function reportToText(r: { title: string; summary: string | null; sections: Array<{ heading: string; body: string; chart?: ChartData }>; generatedBy: string; generatedAt: string; accountName: string | null }, sources: Source[]): string {
  const parts = [
    r.title,
    `${r.accountName ?? "All accounts"} · prepared by ${r.generatedBy} on ${r.generatedAt.slice(0, 10)}, from the records on file that day.`,
    ...(r.summary ? [markdownToText(r.summary)] : []),
    ...r.sections.map((s) => `${s.heading.toUpperCase()}\n\n${markdownToText(s.body)}${s.chart ? `\n\n${chartToText(s.chart)}` : ""}`),
    sourcesToText(sources),
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** An answer, with its sources. */
export function answerToText(text: string, sources: Source[], charts: ChartData[] = []): string {
  return [markdownToText(text), ...charts.map(chartToText), sourcesToText(sources)].filter(Boolean).join("\n\n");
}
