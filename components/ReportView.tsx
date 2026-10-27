// A report Ask wrote, as it reads printed or on a shared link. The same
// component on both, from the same stored snapshot, so what is shared is what
// was seen.
//
// `sources` are the logged-in page's: resolved to the records as they are now,
// with links. A shared link passes none, and the stored names are shown with
// nothing to click — a shared page never links into the app.
import { AskMarkdown } from "@/lib/ask/markdown";
import type { AskReport } from "@/lib/ask/report";
import type { AskSource } from "@/lib/ask/sources";
import Link from "next/link";
import { AskChart } from "./AskChart";

export function ReportView({ report, sources }: { report: AskReport; sources?: AskSource[] }) {
  const known = new Set(report.citations.map((c) => c.n));
  const marker = (n: number) => (known.has(n) ? <span className="relative -top-[0.45em] ml-0.5 text-[0.75em] font-semibold leading-none text-accent">[{n}]</span> : null);
  const listed = sources ?? report.citations.map((c) => ({ n: c.n, label: c.label, href: null, account: null, unavailable: null }));
  const date = report.generatedAt.slice(0, 10);
  return (
    <div className="space-y-6" data-testid="report">
      <header className="border-b border-line pb-4">
        <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">{report.accountName ?? "All accounts"} · Report</p>
        <h1 className="mt-1 font-display text-title font-extrabold tracking-tight text-ink-strong [overflow-wrap:anywhere] sm:text-display">{report.title}</h1>
        <p className="mt-1 text-label text-ink-muted">
          Prepared by {report.generatedBy} on {date}, from the records on file that day.
        </p>
        {report.summary && <div className="mt-3 rounded-lg bg-surface-sunk px-3.5 py-2.5"><AskMarkdown text={report.summary} marker={marker} /></div>}
      </header>
      {report.sections.map((s, i) => (
        <section key={i} className="break-inside-avoid-page">
          <h2 className="mb-2 font-display text-lead font-bold text-ink-strong">{s.heading}</h2>
          <AskMarkdown text={s.body} marker={marker} />
          {s.chart && (
            <div className="mt-3">
              <AskChart chart={s.chart} />
            </div>
          )}
        </section>
      ))}
      {listed.length > 0 && (
        <footer className="border-t border-line pt-3">
          <h2 className="mb-1 text-micro font-semibold uppercase tracking-wide text-ink-muted">Sources</h2>
          <ol className="space-y-0.5 text-label" data-testid="report-sources">
            {listed.map((s) => (
              <li key={s.n} className="flex gap-2 [overflow-wrap:anywhere]">
                <span className="w-6 shrink-0 text-right tabular-nums text-ink-muted">{s.n}.</span>
                <span className="min-w-0">
                  {s.href ? <Link href={s.href} className="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent">{s.label}</Link> : <span className="text-ink">{s.label}</span>}
                  {s.account && <span className="text-ink-muted"> · {s.account}</span>}
                  {s.unavailable && <span className="block text-micro text-ink-muted" data-print-hide>{s.unavailable}</span>}
                </span>
              </li>
            ))}
          </ol>
        </footer>
      )}
    </div>
  );
}
