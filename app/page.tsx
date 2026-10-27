import Link from "next/link";
import { WeekStrip } from "@/components/WeekStrip";
import { weekSummary } from "@/lib/queries/ourWork";
import { listUsers, requirePageUser } from "@/lib/auth";
import { listAttention, listDueToday } from "@/lib/queries/attention";
import { clearedToday, meetingsAwaitingNotes, partnerDigest, upcomingMeetings } from "@/lib/queries/today";
import { addDays, nowHHMM, todayISO, todayLabel } from "@/lib/clock";
import { TodayOverview } from "./TodayOverview";
import { PlanningCapture } from "@/components/PlanningCapture";
import { listOpenFollowUps } from "@/lib/queries/meetings";
import { homeHref, parseHomeView } from "@/lib/glance";
import { greeting, planToday, todaySentence } from "@/lib/today";
import { chooseAgendaTask } from "@/lib/workflow";
import { spendToday, startOfToday } from "@/lib/ai/guard";
import { openNotices } from "@/lib/assistants/promiseKeeper";
import { assistantsToday } from "@/lib/assistants/runs";
import { openReady } from "@/lib/assistants/ready";
import { CLOSE_BUTTON_FROM } from "@/lib/assistants/closeTheDay";
import { assistantMode } from "@/lib/assistants/settings";
import { calendarReview } from "@/lib/calendar/review";
import { watchDrafts } from "@/lib/assistants/accountWatch";
import { openPlanQuestions } from "@/lib/assistants/planKeeper";
import { buildCover, coverSize, nextTimeOff } from "@/lib/handoff/cover";
import { fmtDay } from "@/lib/format";
import { spendIsTight, spendSub } from "@/lib/format";
import { Page } from "@/components/Nav";
import { Icon } from "@/components/icons";
import { control, Field } from "@/components/ui";
import { createAccount } from "./actions";
import { CloseTheDay } from "./CloseTheDay";
import { SeenToday } from "@/components/SeenToday";
import { ProviderCheck } from "@/components/ProviderCheck";
import { TodayBriefing } from "@/components/TodayBriefing";
import { briefingSince, buildBriefing, gatherBriefing } from "@/lib/briefing";
import { WrittenParagraph } from "@/components/WrittenParagraph";
import { WriteWhenStale } from "@/components/WriteWhenStale";
import { writtenFor } from "@/lib/writer/core";
import { todayFacts, todayKey } from "@/lib/writer/today";
import { writerOn } from "@/lib/assistants/writer";
import { ActionForm } from "@/components/ActionForm";
import { OwnerTabs } from "@/components/OwnerTabs";
import { ownerLabels, parseOwnerScope } from "@/lib/queries/owner";
import { listAccountChoices } from "@/lib/queries/accounts";

export const dynamic = "force-dynamic";

// Today answers one question: what needs me, in what order. It used to answer
// every question the app could — six panels, the account table and the
// activity feed on one page — and so answered none of them quickly. The
// accounts have their own page now (/accounts), the feed is /activity, and
// everything else is behind a count at the bottom of this one.
export default async function Home({ searchParams }: { searchParams: Promise<{ who?: string | string[]; view?: string | string[] }> }) {
  const user = await requirePageUser();
  const now = new Date();
  const today = todayISO(now);
  // Whose accounts this page is about. It scopes everything below, because a
  // page that filtered only some of it would show a count that disagreed with
  // the rows under it.
  const query = await searchParams;
  // Close the day is a view of Today (DECISIONS #105).
  if (query.view === "close") {
    return (
      <Page user={user} main="max-w-3xl">
        <CloseTheDay user={user} now={now} />
      </Page>
    );
  }
  const scope = parseOwnerScope(typeof query.who === "string" ? query.who : undefined, user.id);
  const view = parseHomeView(query.view);
  const users = listUsers();
  const labels = ownerLabels(users, user.id);
  const spend = spendToday();
  const upcoming = upcomingMeetings(now, 7, scope);
  const awaitingNotes = meetingsAwaitingNotes(now, 7, scope);
  // Upcoming meetings expose their brief action; don't repeat a no-brief queue.
  const attention = [...listAttention(now, scope), ...listDueToday(now, scope)].filter((g) => g.kind !== "no_brief");
  const task = chooseAgendaTask(today, upcoming, upcoming.length ? [] : awaitingNotes, upcoming.length ? [] : attention);
  const notices = openNotices(user.id, today);
  const cal = calendarReview(today);
  const weekOut = addDays(today, 7);
  const plan = planToday({
    today,
    tomorrow: addDays(today, 1),
    upcoming,
    notes: awaitingNotes,
    attention,
    partners: users.length > 1 ? partnerDigest(now, user.id, scope) : [],
    promises: {
      questions: notices.filter((n) => n.kind === "question").map((n) => ({ accountName: n.account_name })),
      soon: notices
        .filter((n) => n.kind === "notify")
        .map((n) => ({ key: n.id, title: n.item_text, accountName: n.account_name, why: n.text, href: `/follow-ups/${n.action_item_id}` })),
    },
    calendar: { toAdd: cal.toAdd.length, questions: cal.questions.length },
    planQuestions: openPlanQuestions(user.id, { today }).map((q) => ({ accountName: q.account_name })),
    ready: openReady(user.id).map((r) => ({ key: r.id, title: r.title, why: r.why, href: r.href, action: r.action })),
    news: watchDrafts().map((w) => ({ accountName: w.accountName, findings: w.findings, touching: w.touching, signals: w.signals, href: `/accounts/${w.accountId}/research#research-review` })),
    timeOff: cal.timeOff
      .filter((t) => t.userId !== user.id && t.from <= weekOut)
      .map((t) => ({ name: t.userName, when: t.from === t.to ? fmtDay(t.from, now) : `${fmtDay(t.from, now)} – ${fmtDay(t.to, now)}`, href: `/handoff?for=${t.userId}` })),
    myTimeOff: (() => {
      const w = nextTimeOff(user.id, today, 7);
      return w ? { when: w.from === w.to ? fmtDay(w.from, now) : `${fmtDay(w.from, now)} – ${fmtDay(w.to, now)}`, things: coverSize(buildCover(user.id, w, today)) } : null;
    })(),
    primaryHref: task?.href ?? null,
  });
  const helped = assistantsToday(startOfToday(), user.id);
  const helpedText = [
    helped.briefs > 0 ? `Meeting prep wrote ${helped.briefs} brief${helped.briefs === 1 ? "" : "s"}` : null,
    helped.reminders > 0 ? `Promise keeper left ${helped.reminders} reminder${helped.reminders === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");
  const anyLate = attention.some((i) => i.kind === "overdue");
  const cleared = clearedToday(now, user.id);
  const noAccounts = listAccountChoices().length === 0;
  const briefingInput = view ? null : gatherBriefing(user.id, now, briefingSince(user.id, now));
  const briefing = briefingInput ? buildBriefing(briefingInput) : null;
  // The Writer's summary of the same facts, once in the morning and once
  // after the close-the-day hour (DECISIONS #106); the counts sit under it.
  const written = briefingInput && writerOn() ? writtenFor(todayKey(user.id, now, briefingInput.closing), null) : null;
  const askWriter = !!briefingInput && !written && writerOn() && todayFacts(briefingInput).length > 0;

  return (
    <Page user={user} main="max-w-3xl">
      {!view && (
        <header className="mb-8">
          <p className="text-label font-medium text-ink-muted">{todayLabel(now)}</p>
          <h1 className="mt-1 font-display text-display font-extrabold tracking-tight text-ink-strong sm:text-mega">{greeting(nowHHMM(now), user.display_name)}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-lead text-ink" data-testid="today-sentence">
            <span>{todaySentence({ ...plan, found: plan.found + (task ? 1 : 0) }, anyLate)}</span>
            {cleared > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2.5 py-0.5 text-label font-semibold text-positive ring-1 ring-positive-line" data-testid="today-cleared"><Icon name="check" className="size-3.5" />{cleared} cleared today</span>}
          </p>
          {nowHHMM(now) >= CLOSE_BUTTON_FROM && assistantMode("close_the_day") !== "off" && (
            <p className="mt-2">
              <Link href="/?view=close" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-label font-semibold text-ink hover:bg-surface-sunk" data-testid="today-close">
                <Icon name="check" className="size-3.5 text-accent" />
                Close the day
              </Link>
            </p>
          )}
          {helpedText && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-label text-ink-muted" data-testid="today-assistants">
              <Icon name="sparkle" className="size-3.5 text-accent" />
              Today: {helpedText}. <Link href="/assistants" className="font-semibold text-accent hover:underline">Assistants</Link>
            </p>
          )}
          {briefing && written ? (
            <div className="mt-4"><WrittenParagraph written={written} counts={<TodayBriefing briefing={briefing} />} testId="today-written" /></div>
          ) : (
            briefing && <TodayBriefing briefing={briefing} />
          )}
          {askWriter && <WriteWhenStale place="today" />}
          <SeenToday />
        </header>
      )}
      {view && <h1 className="sr-only">Today</h1>}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <PlanningCapture me={user.id} />
        {/* Only when there is more than one of us: with a single login, "whose
            is it" is not a question anyone is asking. */}
        {users.length > 1 && (
          <div className="py-1.5">
            <OwnerTabs current={scope.filter} labels={labels} href={(f) => homeHref(f, view)} testId="home-owner" />
          </div>
        )}
      </div>

      {spendIsTight(spend) && (
        <p className="mb-4 text-label text-warning" role="status">AI spend today: ${(spend.cents / 100).toFixed(2)} · {spendSub(spend)}</p>
      )}

      <TodayOverview tasks={listOpenFollowUps({ ownerUserId: user.id })} upcoming={upcoming} notes={awaitingNotes} attention={attention} who={scope.filter} view={view} today={today} plan={plan} week={view ? null : <WeekStrip people={weekSummary(user.id, now)} me={user.id} activityHref="/activity?days=7" />} />

      {/* Used rarely, so folded away at the foot of the page: a new account
          (twice a year; the list itself lives on /accounts) and whether the
          box is wired up. */}
      <div className="mt-10 flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-line pt-5 text-label">
        <div id="new-account" className="min-w-0">
          <ActionForm
            action={createAccount}
            testId="account-new"
            trigger="New account"
            submitLabel="Add account"
            open={noAccounts}
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="Name">
              <input name="name" required className={control} placeholder="Customer name" />
            </Field>
            <Field label="Region">
              <input name="region" className={control} />
            </Field>
            <Field label="CRM account ID">
              <input name="crm_id" className={control} />
            </Field>
          </ActionForm>
        </div>
        <details className="min-w-0" data-testid="system-status">
          <summary className="cursor-pointer py-1.5 font-semibold text-ink-muted focus-visible:outline-2 focus-visible:outline-accent">System status</summary>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-ink-muted">
            <span>AI today: ${(spend.cents / 100).toFixed(2)} · {spendSub(spend)}</span>
            <ProviderCheck />
            <Link href="/setup" className="text-micro text-accent hover:underline" data-testid="setup-link">Is everything wired up?</Link>
          </div>
        </details>
        <Link href="/calendar" className="inline-flex items-center gap-1.5 py-1.5 font-semibold text-ink-muted hover:text-ink" data-testid="calendar-link">
          <Icon name="calendar" className="size-3.5" />Calendar
        </Link>
        <Link href="/assistants" className="inline-flex items-center gap-1.5 py-1.5 font-semibold text-ink-muted hover:text-ink" data-testid="assistants-link">
          <Icon name="sparkle" className="size-3.5" />Assistants
        </Link>
      </div>
    </Page>
  );
}
