import Link from "next/link";
import type { Briefing } from "@/lib/briefing";
import { Icon } from "./icons";

// The briefing on Today (DECISIONS #99): one line per thing worth knowing,
// each opening onto the items behind it. Counted from the records; nothing
// here is written by a model.
export function TodayBriefing({ briefing }: { briefing: Briefing }) {
  if (briefing.sections.length === 0) return null;
  return (
    <section aria-label={briefing.closing ? "Close the day" : "Briefing"} className="mt-4 sm:mt-5" data-testid="today-briefing">
      {/* A phone gets one row of chips to swipe through, so the briefing
          never pushes the day's first action off the screen. */}
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:hidden" data-testid="briefing-chips">
        {briefing.sections.flatMap((s) => s.lines).map((l) => (
          <li key={l.key} className="shrink-0">
            <Link href={l.href} className="inline-flex min-h-9 items-center whitespace-nowrap rounded-full border border-line bg-surface px-3 text-label text-ink hover:border-accent hover:text-accent">
              {l.text}
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden gap-4 rounded-xl border border-line bg-surface p-5 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
        {briefing.sections.map((s) => (
          <div key={s.key} className="min-w-0" data-testid={`briefing-${s.key}`}>
            <h2 className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">{s.title}</h2>
            <ul className="mt-1.5 space-y-1">
              {s.lines.map((l) => (
                <li key={l.key} className="text-label" data-testid="briefing-line">
                  {l.items.length > 0 ? (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-1.5 text-ink hover:text-accent [&::-webkit-details-marker]:hidden">
                        <Icon name="arrow" className="mt-1 size-3 shrink-0 text-ink-faint transition group-open:rotate-90" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{l.text}</span>
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-[1.125rem]">
                        {l.items.slice(0, 8).map((it) => (
                          <li key={it.href + it.text} className="min-w-0 [overflow-wrap:anywhere]">
                            <Link href={it.href} className="text-ink-muted hover:text-accent hover:underline">{it.text}</Link>
                          </li>
                        ))}
                        {l.items.length > 8 && (
                          <li><Link href={l.href} className="font-semibold text-accent hover:underline">{l.items.length - 8} more →</Link></li>
                        )}
                      </ul>
                    </details>
                  ) : (
                    <Link href={l.href} className="flex items-start gap-1.5 text-ink hover:text-accent">
                      <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-faint" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{l.text}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
