import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { teamRows } from "@/lib/queries/team";
import { fmtMoneyShort } from "@/lib/format";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { workLine } from "@/components/WeekStrip";
import { Page } from "@/components/Nav";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// The team at a glance: one card per person, with what they own, what they
// did this week, and where they could use a hand (DECISIONS #93).
export default async function TeamPage() {
  const user = await requirePageUser();
  const now = new Date();
  const rows = teamRows(now);
  const fq = currentFiscalQuarter(now).label;
  // Me first, then by who needs a hand most.
  rows.sort((a, b) => (a.member.id === user.id ? -1 : b.member.id === user.id ? 1 : b.overdue + b.bareThisQuarter - (a.overdue + a.bareThisQuarter)));

  return (
    <Page user={user}>
      <PageHeader title="Team" sub="What each of us owns, did this week, and where a hand would help." />
      {rows.length === 0 ? (
        <Empty>No one on the team yet.</Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="team-list">
          {rows.map((r) => {
            const help = r.overdue + r.bareThisQuarter;
            return (
              <li key={r.member.id} className="min-w-0 rounded-xl border border-line bg-surface p-4" data-testid="team-person">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/team/${r.member.id}`} className="font-display text-lead font-bold text-ink-strong hover:text-accent hover:underline">
                    {r.member.display_name}
                    {r.member.id === user.id ? " (you)" : ""}
                  </Link>
                  {r.member.role && <span className="text-micro text-ink-muted">{r.member.role}</span>}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-label">
                  <div>
                    <dt className="text-micro text-ink-muted">Accounts</dt>
                    <dd className="font-semibold tabular-nums text-ink-strong">{r.accounts}</dd>
                  </div>
                  <div>
                    <dt className="text-micro text-ink-muted">Open pipeline</dt>
                    <dd className="font-semibold tabular-nums text-ink-strong">{fmtMoneyShort(r.openPipelineUsd)}</dd>
                  </div>
                  <div>
                    <dt className="text-micro text-ink-muted">Live plays</dt>
                    <dd className="font-semibold tabular-nums text-ink-strong">{r.livePlays}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-label text-ink" data-testid="team-week">
                  <span className="text-ink-muted">This week: </span>
                  {workLine(r.week)}
                </p>
                <p className={`mt-1 text-label ${help ? "text-warning" : "text-ink-muted"}`} data-testid="team-help">
                  {help
                    ? [r.overdue ? `${r.overdue} overdue follow-up${r.overdue === 1 ? "" : "s"}` : null, r.bareThisQuarter ? `${r.bareThisQuarter} deal${r.bareThisQuarter === 1 ? "" : "s"} closing ${fq} with no next step` : null].filter(Boolean).join(" · ")
                    : "Nothing overdue, every deal closing this quarter has a next step"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
