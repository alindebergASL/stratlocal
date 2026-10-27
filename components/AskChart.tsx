// A chart Ask drew: one series of horizontal bars, numbers computed by the
// app (lib/ask/charts.ts), drawn in HTML so it reflows to a phone, prints,
// and reads as text to a screen reader.
//
// One series, so no legend — the title says what is plotted — and each
// value beside its bar, in ink, never in the bar's colour. Bars grow from one
// baseline, capped in thickness, square at the base and rounded at the tip.
import type { ChartData } from "@/lib/ask/charts";
import { fmtMoneyShort } from "@/lib/format";

/** `bare` inside a card that already draws the edge: a tint, not a second border. */
export function AskChart({ chart, bare = false }: { chart: ChartData; bare?: boolean }) {
  const max = Math.max(0, ...chart.rows.map((r) => r.value));
  const fmt = (v: number) => (chart.unit === "usd" ? fmtMoneyShort(v) : v.toLocaleString("en-US"));
  return (
    <figure className={`break-inside-avoid rounded-xl p-3 sm:p-4 ${bare ? "bg-surface-sunk/60" : "border border-line bg-surface"}`} data-testid="ask-chart">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-label">
        <span className="font-semibold text-ink-strong">{chart.title}</span>
        <span className="text-micro text-ink-muted">as of {chart.asOf}</span>
      </figcaption>
      {chart.rows.length === 0 ? (
        <p className="text-label text-ink-muted">{chart.note ?? "Nothing to show."}</p>
      ) : (
        <ul className="space-y-1.5">
          {chart.rows.map((r) => {
            const pct = max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0;
            return (
              <li
                key={r.label}
                className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)_auto] items-center gap-x-2 rounded py-0.5 hover:bg-surface-sunk sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] sm:gap-x-3"
                title={`${r.label}: ${fmt(r.value)}${r.detail ? ` · ${r.detail}` : ""}`}
              >
                <span className="truncate text-label text-ink">{r.label}</span>
                {/* Every bar scales inside the same track, so lengths stay
                    proportional at any width; the value has its own column. */}
                <span aria-hidden className="block h-4 min-w-0">
                  <span className="block h-full rounded-r bg-accent [print-color-adjust:exact]" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-right text-micro tabular-nums text-ink-muted">
                  {fmt(r.value)}
                  {r.detail && <span className="sr-only"> · {r.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {chart.rows.length > 0 && chart.note && <p className="mt-2 text-micro text-ink-muted">{chart.note}</p>}
    </figure>
  );
}
