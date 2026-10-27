import Link from "next/link";
import { OWNER_FILTERS, type OwnerFilter } from "@/lib/queries/owner";

/**
 * Whose accounts a page is showing, as four links.
 *
 * A server component and a GET parameter rather than a client control,
 * because the answer changes what the SQL selects: filtering rendered rows in
 * the browser would leave every count and every total on the page describing a
 * set nobody can see.
 *
 * One look for one idea (DECISIONS #10) — the same pill treatment /activity
 * already uses for its window and account filters, so the three pages that
 * can be asked this question ask it the same way. The href is built by the
 * page, so each one keeps whatever else it is already filtered by.
 */
export function OwnerTabs({
  current,
  labels,
  href,
  testId,
}: {
  current: OwnerFilter;
  labels: Record<OwnerFilter, string>;
  href: (f: OwnerFilter) => string;
  testId?: string;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-label" data-testid={testId}>
      <span className="text-ink-muted">Whose</span>
      {OWNER_FILTERS.map((f) => (
        <Link
          key={f}
          href={href(f)}
          data-testid={`owner-${f}`}
          aria-current={f === current ? "page" : undefined}
          className={`rounded-md px-2 py-0.5 transition-colors ${
            f === current ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"
          }`}
        >
          {labels[f]}
        </Link>
      ))}
    </span>
  );
}
