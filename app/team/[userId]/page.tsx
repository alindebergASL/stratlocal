import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { personPage } from "@/lib/queries/team";
import { fmtDay, fmtMoneyShort } from "@/lib/format";
import { todayISO } from "@/lib/clock";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { playStatusLabel, PLAY_TONE } from "@/lib/tone";
import { workLine } from "@/components/WeekStrip";
import { BackLink } from "@/components/BackLink";
import { Page } from "@/components/Nav";
import { Chip, Empty, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

const SHOWN = 10;

// One person's work: their accounts, the plays in motion on them in ranked
// order, what is coming up, what they owe, and what they got done
// (DECISIONS #93).
export default async function PersonPage({ params }: { params: Promise<{ userId: string }> }) {
  const user = await requirePageUser();
  const { userId } = await params;
  const now = new Date();
  const p = personPage(userId, now);
  if (!p) notFound();
  const me = userId === user.id;
  const today = todayISO(now);
  const name = me ? "You" : p.member.display_name;

  return (
    <Page user={user}>
      <div className="mb-3">
        <BackLink fallback="/team" fallbackLabel="Team" />
      </div>
      <PageHeader title={me ? `${p.member.display_name} (you)` : p.member.display_name} sub={p.member.role ?? undefined} />

      <Section id="person-week" title="Done lately">
        <p className="text-label text-ink" data-testid="person-week">
          <span className="text-ink-muted">This week: </span>
          {workLine(p.week)}
        </p>
        <p className="mt-1 text-label text-ink">
          <span className="text-ink-muted">Last 30 days: </span>
          {workLine(p.month)}
        </p>
        {p.wonThisMonth.length > 0 && (
          <ul className="mt-2 space-y-1 text-label" data-testid="person-wins">
            {p.wonThisMonth.map((w) => (
              <li key={w.dealId}>
                <span className="font-semibold text-positive">Won</span>{" "}
                <Link href={`/accounts/${w.accountId}/deals/${encodeURIComponent(w.dealId)}`} className="font-semibold text-ink hover:text-accent hover:underline">
                  {w.name}
                </Link>
                <span className="text-ink-muted">
                  {" "}
                  · {w.accountName}
                  {w.tcvUsd ? ` · ${fmtMoneyShort(w.tcvUsd)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="gap-x-6 lg:grid lg:grid-cols-2 lg:items-start">
        <Section id="person-follow-ups" title="Follow-ups they owe" aside={<span className={p.overdue ? "text-warning" : ""}>{p.followUps.length} open{p.overdue ? ` · ${p.overdue} overdue` : ""}</span>}>
          {p.followUps.length === 0 ? (
            <Empty>Nothing open.</Empty>
          ) : (
            <ul className="divide-y divide-line" data-testid="person-follow-ups">
              {p.followUps.slice(0, SHOWN).map((f) => (
                <li key={f.id} className="py-2 text-label">
                  <Link href={`/follow-ups/${f.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                    {f.text}
                  </Link>
                  <span className={`block text-micro ${f.due && f.due < today ? "text-warning" : "text-ink-muted"}`}>
                    {f.account_name} · {f.due ? `due ${fmtDay(f.due)}` : "no date"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {p.followUps.length > SHOWN && (
            <p className="mt-2 text-micro">
              <Link href={me ? "/follow-ups" : "/follow-ups?who=others"} className="text-accent hover:underline">
                All {p.followUps.length} →
              </Link>
            </p>
          )}
        </Section>

        <Section id="person-meetings" title="Coming up">
          {p.upcoming.length === 0 ? (
            <Empty>No meetings booked.</Empty>
          ) : (
            <ul className="divide-y divide-line" data-testid="person-meetings">
              {p.upcoming.map((m) => (
                <li key={m.id} className="py-2 text-label">
                  <Link href={`/accounts/${m.account_id}/meetings/${m.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                    {m.title}
                  </Link>
                  <span className="block text-micro text-ink-muted">
                    {fmtDay(m.held_at)}
                    {m.held_time ? ` at ${m.held_time}` : ""} · {m.accountName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section id="person-plays" title="Plays in motion" aside={<span>{p.plays.length} live</span>}>
        {p.plays.length === 0 ? (
          <Empty>No live plays on {me ? "your" : "their"} accounts.</Empty>
        ) : (
          <ul className="divide-y divide-line" data-testid="person-plays">
            {p.plays.slice(0, SHOWN * 2).map((pl) => (
              <li key={pl.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-label">
                <span className="min-w-0">
                  <span className="mr-2 tabular-nums text-ink-muted">#{pl.rank}</span>
                  <Link href={`/accounts/${pl.account_id}/plays/${pl.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                    {pl.title}
                  </Link>
                  <span className="block text-micro text-ink-muted">
                    {pl.accountName} · {pl.next_step ? `next: ${pl.next_step}` : "no next step"}
                  </span>
                </span>
                <Chip tone={PLAY_TONE[pl.status] ?? "neutral"}>{playStatusLabel(pl.status)}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="person-accounts"
        title={`${me ? "Your" : "Their"} accounts`}
        aside={p.bareThisQuarter ? <span className="text-warning">{p.bareThisQuarter} closing {currentFiscalQuarter(now).label} with no next step</span> : <span>{p.accounts.length}</span>}
      >
        {p.accounts.length === 0 ? (
          <Empty>{name} {me ? "own" : "owns"} no accounts; shared accounts are on the Accounts page.</Empty>
        ) : (
          <ul className="divide-y divide-line" data-testid="person-accounts">
            {p.accounts.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 py-2 text-label">
                <Link href={`/accounts/${a.id}`} className="min-w-0 truncate font-semibold text-ink hover:text-accent hover:underline">
                  {a.name}
                </Link>
                <span className="shrink-0 tabular-nums text-ink-muted">{fmtMoneyShort(a.openPipelineUsd)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
