import Link from "next/link";
import type { StillTrue } from "@/lib/research/current";
import { ResultButton } from "./ResultButton";

// Kept research that may have gone out of date, with the two answers to it.
export function ResearchStillTrue({ rows, more, findingHref, action }: { rows: StillTrue[]; more: number; findingHref: (r: StillTrue) => string; action: (r: StillTrue, keep: boolean) => () => Promise<{ ok: true; message?: string } | { ok: false; error: string }> }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="research-still-true-h" className="mb-6 rounded-xl border border-warning-line bg-surface p-4 sm:p-5" data-testid="research-still-true">
      <h2 id="research-still-true-h" className="font-display text-heading font-bold text-ink-strong">Still true?</h2>
      <p className="text-micro text-ink-muted">Kept findings that may have gone out of date. Keep asks again in six months; Drop unticks it, and nothing is deleted.</p>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <li key={`${r.item.noteId}#${r.item.index}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-2.5" data-testid="still-true-row">
            <div className="min-w-0 flex-1">
              <Link href={findingHref(r)} className="text-body text-ink hover:text-accent hover:underline">{r.item.finding.text}</Link>
              <p className="text-micro font-semibold text-warning">{r.why}</p>
            </div>
            <span className="flex shrink-0 flex-wrap items-center gap-2">
              <ResultButton run={action(r, true)} testId="still-true-keep">Still true</ResultButton>
              <ResultButton run={action(r, false)} testId="still-true-drop">Drop</ResultButton>
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-1 text-micro text-ink-muted">{more} more after these.</p>}
    </section>
  );
}
