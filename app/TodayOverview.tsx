import Link from "next/link";
import { PrepareMeeting } from "@/components/PrepareMeeting";
import { NextStepWaiver } from "@/components/NextStepWaiver";
import { Icon, type IconName } from "@/components/icons";
import type { OpenFollowUp } from "@/lib/queries/meetings";
import { chooseAgendaTask } from "@/lib/workflow";
import { addDays, todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { countLabel, homeHref, overdueLabel, type HomeView } from "@/lib/glance";
import { TODAY_KIND_LABEL, TODAY_RULE, type TodayItemKind, type TodayPlan } from "@/lib/today";
import type { AttentionItem } from "@/lib/queries/attention";
import type { UpcomingMeeting } from "@/lib/queries/today";
import type { OwnerFilter } from "@/lib/queries/owner";

const link = "font-semibold text-accent hover:underline";

const KIND_ICON: Record<TodayItemKind, IconName> = { prepare: "calendar", due: "clock", late: "clock", review: "review", ready: "sparkle", handoff: "people", calendar: "calendar", news: "search", question: "flag", notes: "pen", promise: "check", fyi: "people" };
const KIND_TILE: Record<TodayItemKind, string> = {
  prepare: "bg-accent-soft text-accent",
  due: "bg-warning-soft text-warning",
  late: "bg-warning-soft text-warning",
  review: "bg-ink text-ink-invert",
  ready: "bg-accent-soft text-accent",
  handoff: "bg-warning-soft text-warning",
  calendar: "bg-accent-soft text-accent",
  news: "bg-warning-soft text-warning",
  question: "bg-accent text-ink-invert",
  notes: "bg-surface-sunk text-ink-muted",
  promise: "bg-positive-soft text-positive",
  fyi: "bg-surface-sunk text-ink-muted",
};
const KIND_TEXT: Record<TodayItemKind, string> = {
  prepare: "text-accent",
  due: "text-warning",
  late: "text-warning",
  review: "text-ink-strong",
  ready: "text-accent",
  handoff: "text-warning",
  calendar: "text-accent",
  news: "text-warning",
  question: "text-accent",
  notes: "text-ink-muted",
  promise: "text-positive",
  fyi: "text-ink-muted",
};

function Meeting({ meeting: m, notes = false }: { meeting: UpcomingMeeting; notes?: boolean }) {
  return <li className="py-2" data-testid="home-meeting-row">
    <p className="text-label text-ink-muted">{m.inProgress ? "Scheduled window · " : ""}{fmtDay(m.heldAt)} · {m.heldTime ?? "time not set"} · {m.accountName}</p>
    <Link href={m.href} className="home-meeting-title block w-full font-semibold text-ink-strong hover:text-accent hover:underline">{m.title}</Link>
    {!notes && <PrepareMeeting accountId={m.accountId} meetingId={m.id} />}
    {notes && <Link href={`${m.href}#notes`} className={`${link} inline-block py-1 text-label`}>Write notes →</Link>}
  </li>;
}
function Work({ item }: { item: AttentionItem }) {
  return <li className="py-2 text-label" data-testid="glance-work-row"><Link href={item.href} className={link}>{item.accountName} · {item.text} →</Link>{item.unit && <span className="ml-2 text-micro text-ink-muted">{item.unit === "play" ? "Play next step" : item.promisedBy ? "Their promise" : "Follow-up"}</span>}{item.detail && <p className="text-ink-muted">{item.detail}</p>}</li>;
}

export function TodayOverview({ upcoming, notes, attention, who, view, plan, tasks = [], today = todayISO(), week = null }: {
  tasks?: OpenFollowUp[];
  /** What the team did this week, shown under the next action (DECISIONS #92). */
  week?: React.ReactNode;
  upcoming: UpcomingMeeting[]; notes: UpcomingMeeting[]; attention: AttentionItem[]; who: OwnerFilter; view: HomeView | null; plan: TodayPlan; today?: string;
}) {
  const reviews = attention.filter(i => i.kind === "proposals");
  const overdue = attention.filter(i => i.kind === "overdue");
  const dueToday = attention.filter(i => i.kind === "due_today");
  const nextSteps = attention.filter(i => i.kind === "no_next_step");
  const reviewLabel = `${countLabel(reviews.reduce((n, i) => n + (i.count ?? 0), 0), "change")} across ${countLabel(reviews.length, "account")} to review`;
  const titles = { upcoming: "Coming up · next 7 days", notes: "Meetings missing notes · past 7 days", review: reviewLabel, overdue: overdueLabel(overdue) || "Past due", "due-today": "Due today", "next-steps": "Closing this quarter with no next step" };

  // A complete list behind one of the counts: the page's "see everything".
  if (view) {
    const meetings = view === "upcoming" ? upcoming : view === "notes" ? notes : null;
    const items = view === "review" ? reviews : view === "overdue" ? overdue : view === "due-today" ? dueToday : nextSteps;
    return <section className="mb-6" data-testid="glance-list">
      <Link href={homeHref(who)} className={`${link} inline-block py-2 text-label`}>← Back to Today</Link>
      <h2 className="text-heading font-bold">{titles[view]}</h2>
      <ul className="divide-y divide-line">{meetings ? meetings.map(m => <Meeting key={m.id} meeting={m} notes={view === "notes"} />) : items.map((i, n) => i.dealId ? (
        <li key={`${i.href}-${n}`} className="py-2 text-label" data-testid="glance-work-row">
          <Link href={i.href} className={link}>{i.accountName} · {i.text} →</Link>
          {i.detail && <p className="text-ink-muted">{i.detail}</p>}
          <div className="mt-1"><NextStepWaiver accountId={i.accountId} deal={{ deal_id: i.dealId, status: "open", next_step: null }} /></div>
        </li>
      ) : <Work key={`${i.href}-${n}`} item={i} />)}</ul>
      {(meetings ?? items).length === 0 && <p className="py-2 text-label text-ink-muted">Nothing in this view for these accounts.</p>}
    </section>;
  }

  const task = chooseAgendaTask(today, upcoming, upcoming.length ? [] : notes, upcoming.length ? [] : attention);
  const primaryMeeting = task && upcoming[0] && task.href === `${upcoming[0].href}#brief` ? upcoming[0] : null;
  // Said the way a person says it: "Tomorrow · Thu 22 Oct · 11:30", not the
  // stored "Scheduled 2026-10-22".
  const meetingWhen = (m: UpcomingMeeting) => {
    const rel = m.inProgress ? "Happening now" : m.heldAt === today ? "Today" : m.heldAt === addDays(today, 1) ? "Tomorrow" : null;
    return [rel, fmtDay(m.heldAt), m.heldTime ?? "time not set"].filter(Boolean).join(" · ");
  };
  const backlog = plan.backlog.followUps + plan.backlog.plays;
  const sortHref = who === "all" ? "/follow-ups/sort" : `/follow-ups/sort?who=${who}`;
  // Every count that has a complete list behind it, in one quiet row. These
  // were six panels; they are the way to everything the five above left out.
  const more: Array<{ view: HomeView; label: string; n: number }> = [
    { view: "upcoming", label: `${countLabel(upcoming.length, "meeting")} this week`, n: upcoming.length },
    { view: "notes", label: `${countLabel(notes.length, "meeting")} missing notes`, n: notes.length },
    { view: "review", label: reviewLabel, n: reviews.length },
    { view: "overdue", label: overdueLabel(overdue), n: overdue.length },
    { view: "due-today", label: `${dueToday.length} due today`, n: dueToday.length },
    { view: "next-steps", label: `${countLabel(nextSteps.length, "deal")} closing this quarter with no next step`, n: nextSteps.length },
  ];

  return <section className="mb-8 space-y-10" aria-label="Today at a glance" data-testid="today-glance">
    <div className="today-hero relative overflow-hidden rounded-3xl border border-accent-line p-5 shadow-raised sm:p-8" data-testid="agenda-primary">
      {task ? <div className="relative flex items-start gap-5" data-testid={primaryMeeting ? "home-meeting-row" : undefined}>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-accent"><Icon name="flag" className="size-3.5" />Next up · {task.accountName}</p>
          <h2 className="mt-3 font-display text-title font-extrabold tracking-tight text-ink-strong [overflow-wrap:anywhere] sm:text-display">{primaryMeeting ? <Link href={primaryMeeting.href} className="home-meeting-title block w-full hover:underline">{task.title}</Link> : task.title}</h2>
          <p className="mt-2 flex items-center gap-1.5 text-label text-ink"><Icon name={primaryMeeting ? "calendar" : "clock"} className="size-4 text-accent" />{primaryMeeting ? meetingWhen(primaryMeeting) : task.reason}</p>
          <div className="mt-4">
            {primaryMeeting && <PrepareMeeting accountId={primaryMeeting.accountId} meetingId={primaryMeeting.id} />}
            {!primaryMeeting && <Link href={task.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 py-2 font-semibold text-white shadow-raised transition hover:-translate-y-px hover:bg-accent-hover">{task.label}<Icon name="arrow" /></Link>}
          </div>
          {plan.laterToday.length > 0 && <p className="mt-5 border-t border-accent-line pt-4 text-label text-ink" data-testid="today-later">
            <span className="font-semibold text-accent">Later today</span>{" "}{plan.laterToday.slice(0, 2).map((m, i) => <span key={m.id}>{i > 0 ? " · " : ""}<Link href={m.href} className="hover:underline">{m.heldTime ?? "time not set"} {m.title}, {m.accountName}</Link></span>)}{plan.laterToday.length > 2 ? ` · and ${plan.laterToday.length - 2} more` : ""}
          </p>}
        </div>
        {primaryMeeting && <CalendarTile day={primaryMeeting.heldAt} time={primaryMeeting.heldTime} />}
      </div> : <div className="relative" data-testid="home-quiet">
        <p className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-accent"><Icon name="sparkle" className="size-3.5" />Next up</p>
        <h2 className="mt-3 font-display text-title font-extrabold tracking-tight text-ink-strong">Nothing queued in this account scope</h2>
        <p className="mt-2 text-label text-ink">No meeting is coming up and nothing is due. A good moment to look ahead.</p>
        <div className="mt-4 flex flex-wrap gap-4 text-label"><Link href="/accounts" className={link}>Open an account →</Link><Link href="/accounts#new-account" className={link}>New account →</Link><Link href="/follow-ups?add=1#own-work-group" className={link}>Add own work →</Link></div>
      </div>}
    </div>

    {week}

    <div data-testid="today-list">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
        <h2 className="font-display text-heading font-bold text-ink-strong">{plan.found > plan.items.length ? `Today’s ${plan.items.length}` : "To clear"}</h2>
        <details className="relative text-micro">
          <summary className="cursor-pointer list-none text-accent hover:underline">How these were picked</summary>
          <p className="absolute right-0 z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-3.5 text-label text-ink shadow-pop">{TODAY_RULE}</p>
        </details>
      </div>
      {plan.items.length > 0 ? <ul className="-mx-2 space-y-0.5">
        {plan.items.map((i, n) => <li key={i.key} className="animate-rise" style={{ animationDelay: `${n * 40}ms`, animationFillMode: "backwards" }} data-testid="today-item">
          <Link href={i.href} className="group flex items-center gap-3.5 rounded-2xl px-2 py-2.5 transition-colors hover:bg-surface hover:shadow-card">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${KIND_TILE[i.kind]}`}><Icon name={KIND_ICON[i.kind]} className="size-[1.15rem]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink-strong [overflow-wrap:anywhere] group-hover:text-accent">{i.title}</span>
              <span className="block text-micro text-ink-muted"><span className={`font-semibold ${KIND_TEXT[i.kind]}`}>{TODAY_KIND_LABEL[i.kind]}</span>{i.accountName && ` · ${i.accountName}`}{i.why && ` · ${i.why}`}</span>
            </span>
            <span className="hidden shrink-0 items-center gap-1 text-label font-semibold text-accent opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100 sm:flex">{i.action}<Icon name="arrow" className="size-3.5" /></span>
          </Link>
        </li>)}
      </ul> : <p className="flex items-center gap-2 py-3 text-label text-ink-muted"><Icon name="check" className="size-4 text-positive" />{task ? "Nothing else needs you today." : "All clear."}</p>}
      {backlog > 0 && <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-card" data-testid="today-backlog">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-sunk text-ink-muted"><Icon name="stack" className="size-[1.15rem]" /></span>
        <p className="min-w-0 flex-1 basis-56 text-label text-ink">
          <span className="font-semibold text-ink-strong">
            {plan.backlog.followUps > 0 && `${countLabel(plan.backlog.followUps, "older follow-up")} past due`}
            {plan.backlog.followUps > 0 && plan.backlog.plays > 0 && " and "}
            {plan.backlog.plays > 0 && `${countLabel(plan.backlog.plays, "play next step")} past due`}
          </span>
          <span className="block text-ink-muted">Sort them in one sitting: keep with a new date, mark done, or let go.</span>
        </p>
        {plan.backlog.followUps > 0 && <Link href={sortHref} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-ink px-4 text-label font-semibold text-ink-invert transition hover:-translate-y-px hover:bg-ink-strong" data-testid="today-sort">Sort them<Icon name="arrow" className="size-3.5" /></Link>}
      </div>}
    </div>

    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 pb-2">
        <h2 className="font-display text-heading font-bold text-ink-strong">Your tasks</h2>
        <Link href="/follow-ups" className="text-micro text-accent hover:underline">{tasks.length ? `All ${tasks.length} →` : "Task list →"}</Link>
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-4" data-testid="today-open-tasks">{[...tasks].sort((a, b) => Number(a.due !== null) - Number(b.due !== null) || b.created_at - a.created_at).slice(0, 3).map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-3 text-label">
        <span className="flex min-w-0 items-center gap-3"><span aria-hidden className="size-4 shrink-0 rounded-full border-2 border-control-line" /><Link href={`/follow-ups/${t.id}`} className="min-w-0 font-medium text-ink-strong [overflow-wrap:anywhere] hover:text-accent hover:underline">{t.text} →</Link></span>
        <span className="pl-7 text-micro text-ink-muted sm:pl-0">{t.account_name} · {t.due ? `due ${fmtDay(t.due)}` : "no date"}</span>
      </li>)}{!tasks.length && <li className="py-3 text-label text-ink-muted">Nothing assigned to you. Add a task above when something comes to mind.</li>}</ul>
    </div>

    {more.some(m => m.n > 0) && <nav aria-label="Everything else" className="flex flex-wrap gap-2 text-label" data-testid="today-more">
      {more.filter(m => m.n > 0).map(m => <Link key={m.view} data-testid={`glance-all-${m.view}`} href={homeHref(who, m.view)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-ink-muted transition-colors hover:border-accent-line hover:text-accent">{m.label} →</Link>)}
    </nav>}
  </section>;
}

// A day on a calendar, for the meeting in the Next-up card. The date is the
// stored calendar day, formatted in UTC so no timezone can move it.
function CalendarTile({ day, time }: { day: string; time: string | null }) {
  const d = new Date(`${day}T00:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(d);
  return <div aria-hidden className="hidden w-24 shrink-0 overflow-hidden rounded-2xl bg-surface text-center shadow-raised ring-1 ring-accent-line sm:block">
    <div className="bg-accent py-1 text-micro font-semibold uppercase tracking-[0.1em] text-white">{part({ month: "short" })}</div>
    <div className="pt-1.5 font-display text-[2.25rem] font-extrabold leading-none text-ink-strong">{part({ day: "numeric" })}</div>
    <div className="pb-2 pt-1 text-micro font-medium text-ink-muted">{part({ weekday: "short" })}{time ? ` · ${time}` : ""}</div>
  </div>;
}
