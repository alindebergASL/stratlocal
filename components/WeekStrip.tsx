import Link from "next/link";
import type { PersonWeek, WorkCounts } from "@/lib/queries/ourWork";

const PARTS: Array<{ key: keyof WorkCounts; one: string; many: string }> = [
  { key: "meetings", one: "meeting", many: "meetings" },
  { key: "followUpsClosed", one: "follow-up closed", many: "follow-ups closed" },
  { key: "dealsMoved", one: "deal moved", many: "deals moved" },
  { key: "playsMoved", one: "play moved", many: "plays moved" },
  { key: "researchKept", one: "research kept", many: "research kept" },
];

export function workLine(c: WorkCounts): string {
  const parts = PARTS.filter((p) => c[p.key] > 0).map((p) => `${c[p.key]} ${c[p.key] === 1 ? p.one : p.many}`);
  return parts.length ? parts.join(" · ") : "nothing on file yet";
}

// What we did this week, me first and then each teammate: the work the team
// does, kept in view beside what is still to do (DECISIONS #92).
export function WeekStrip({ people, me, title = "This week", activityHref = "/activity" }: { people: PersonWeek[]; me: string | null; title?: string; activityHref?: string }) {
  if (!people.length) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5" data-testid="week-strip">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lead font-bold tracking-tight text-ink-strong">{title}</h2>
        <Link href={activityHref} className="text-label font-semibold text-accent hover:underline">
          Everything that happened →
        </Link>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {people.map((p) => (
          <li key={p.userId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-label" data-testid="week-person">
            <Link href={`/team/${p.userId}`} className="min-w-24 font-semibold text-ink hover:text-accent hover:underline">
              {p.userId === me ? "You" : p.name}
            </Link>
            <span className={p.total ? "text-ink" : "text-ink-muted"} data-testid="week-counts">
              {workLine(p.counts)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
