import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { addDays, todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { inboxSummary, INBOX_KINDS, type InboxKind } from "@/lib/inbox/query";
import { openPlanQuestions } from "@/lib/assistants/planKeeper";
import { openNotices } from "@/lib/assistants/promiseKeeper";
import { planCards } from "@/lib/plan/cards";
import { calendarReview, type ReviewEvent } from "@/lib/calendar/review";
import { listSources, suggestAccounts } from "@/lib/calendar/sync";
import { listAccountChoices, listPendingProposals } from "@/lib/queries/accounts";
import { Page } from "@/components/Nav";
import { Empty, PageHeader, Section } from "@/components/ui";
import { PlanQuestions } from "@/components/PlanQuestions";
import { PromiseQuestions } from "@/components/PromiseQuestions";
import { DismissButton } from "@/components/DismissButton";
import { AccountReview, reviewHref } from "@/components/AccountReview";
import { assistantMode } from "@/lib/assistants/settings";
import { Breadcrumb } from "@/components/ui";
import { AddMeetings, WhichAccount } from "@/app/calendar/CalendarPieces";
import { dismissPlanQuestion, editThesisAction, setNextStepAction, setPlayStatusAction } from "@/app/plans/actions";
import { answerPromise, dismissNotice } from "@/app/assistants/actions";
import { addMeetingsAction, addWithAccountAction, ignoreEventsAction } from "@/app/calendar/actions";
import { snoozeDays } from "@/lib/inbox/snooze";
import { InboxKeys, QuickAccept, Snooze, Wake } from "./InboxControls";
import { OutboundCard } from "@/components/OutboundCard";
import { listDrafts } from "@/lib/outbound/drafts";
import { mailSource } from "@/lib/mail/sync";
import { getAccount } from "@/lib/queries/accounts";
import { discardDraftAction, reopenDraftAction, saveDraftAction, sendDraftAction } from "@/app/outbound/actions";

const accountName = (id: string) => getAccount(id)?.name ?? "";

export const dynamic = "force-dynamic";

const LABEL: Record<InboxKind, string> = {
  send: "To send",
  changes: "Changes",
  research: "Research to keep",
  plan: "Plan check-in",
  promise: "Promises",
  calendar: "Calendar",
};

function nextFriday(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, ((5 - dow + 7) % 7) || 7);
}

// One place to decide (DECISIONS #97): what the agents and imports have
// prepared, across every account, each decided where it is.
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ kind?: string; account?: string }> }) {
  const user = await requirePageUser();
  const now = new Date();
  const today = todayISO(now);
  const query = await searchParams;
  const asked = query.kind;
  // One account's changes, decided here (what used to be its review page).
  const reviewing = asked === "changes" && query.account ? getAccount(query.account) : null;
  if (reviewing) {
    const pending = listPendingProposals(reviewing.id).length;
    return (
      <Page user={user} main="max-w-3xl">
        <Breadcrumb accountId={reviewing.id} accountName={reviewing.name} page="Changes" />
        <PageHeader title="Proposed changes" sub={pending === 0 ? "Nothing waiting." : `${pending} change${pending === 1 ? "" : "s"} waiting. Nothing is applied until you accept it.`} />
        <AccountReview account={reviewing} me={user.id} />
      </Page>
    );
  }
  const only = INBOX_KINDS.find((k) => k === asked) ?? null;
  const summary = inboxSummary(user.id, today);
  const counts: Record<InboxKind, number> = {
    send: summary.send,
    changes: summary.changes.reduce((s, c) => s + c.total, 0),
    research: summary.research.length,
    plan: summary.plan,
    promise: summary.promise,
    calendar: summary.calendar,
  };
  const later = snoozeDays(today);
  const show = (k: InboxKind) => (only ? only === k : counts[k] > 0);
  const when = (e: Pick<ReviewEvent, "day" | "time" | "allDay">) => `${fmtDay(e.day, now)}${e.allDay ? ", all day" : e.time ? ` · ${e.time}` : ""}`;
  const people = (e: ReviewEvent) => {
    const names = e.outsiders.map((p) => p.name ?? p.email);
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  };

  return (
    <Page user={user} main="max-w-3xl">
      <PageHeader title="Inbox" sub={summary.total === 0 ? "Nothing waiting on you." : `${summary.total} waiting on a decision.`} />
      <nav aria-label="Inbox" className="mb-5 flex flex-wrap gap-1.5 text-label" data-testid="inbox-kinds">
        <Link href="/inbox" aria-current={only === null ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md px-2.5 sm:min-h-9 ${only === null ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}>
          Everything <span className="ml-1.5 text-micro tabular-nums">{summary.total}</span>
        </Link>
        {INBOX_KINDS.map((k) => (
          <Link key={k} href={`/inbox?kind=${k}`} aria-current={only === k ? "page" : undefined} data-testid={`inbox-kind-${k}`} className={`inline-flex min-h-11 items-center rounded-md px-2.5 sm:min-h-9 ${only === k ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}>
            {LABEL[k]} <span className="ml-1.5 text-micro tabular-nums">{counts[k]}</span>
          </Link>
        ))}
      </nav>

      <InboxKeys />
      {summary.total === 0 && only === null && <Empty>All clear.</Empty>}

      {show("send") && (() => {
        const drafts = listDrafts(user.id, { open: true });
        const sendingOn = !!mailSource(user.id)?.canSend;
        return (
          <Section id="inbox-send" title="To send" aside={<span>{counts.send}</span>} empty={counts.send === 0}>
            {drafts.length === 0 ? (
              <Empty>Nothing waiting to send.</Empty>
            ) : (
              <div className="space-y-3" data-testid="inbox-send">
                {drafts.map((d) => (
                  <div key={d.id}>
                    <p className="mb-1 text-micro text-ink-muted">{accountName(d.accountId)}</p>
                    <OutboundCard draft={d} sendingOn={sendingOn} actions={{ send: sendDraftAction, save: saveDraftAction, discard: discardDraftAction, reopen: reopenDraftAction }} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        );
      })()}

      {show("changes") && (
        <Section id="inbox-changes" title="Changes" aside={<span>{counts.changes}</span>} empty={counts.changes === 0}>
          {summary.changes.length === 0 ? (
            <Empty>No changes waiting.</Empty>
          ) : (
            <ul className="divide-y divide-line" data-testid="inbox-changes">
              {summary.changes.map((c) => (
                <li key={c.accountId} tabIndex={-1} data-inbox-row className="-mx-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-2 py-3 outline-none focus:bg-accent-soft/50 focus-visible:ring-2 focus-visible:ring-accent" data-testid="inbox-change-row">
                  <span className="min-w-0">
                    <Link href={`/accounts/${c.accountId}`} className="font-semibold text-ink-strong hover:text-accent hover:underline">{c.accountName}</Link>
                    <span className="block text-label text-ink-muted">
                      {c.total} change{c.total === 1 ? "" : "s"} from {c.sources.join(" and ")}
                      {c.quick > 0 ? ` · ${c.quick} quick to check` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {c.quick > 0 && <QuickAccept accountId={c.accountId} count={c.quick} />}
                    <Snooze itemKey={`changes:${c.accountId}`} {...later} />
                    <Link data-inbox-open href={reviewHref(c.accountId)} className="inline-flex min-h-11 items-center rounded-lg bg-ink px-3 text-label font-semibold text-ink-invert hover:bg-ink-strong sm:min-h-9" data-testid="inbox-review">
                      Review
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {show("research") && (
        <Section id="inbox-research" title="Research to keep" aside={<span>{counts.research}</span>} empty={counts.research === 0}>
          {summary.research.length === 0 ? (
            <Empty>No research waiting.</Empty>
          ) : (
            <ul className="divide-y divide-line" data-testid="inbox-research">
              {summary.research.map((r) => (
                <li key={r.noteId} tabIndex={-1} data-inbox-row className="-mx-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-2 py-3 outline-none focus:bg-accent-soft/50 focus-visible:ring-2 focus-visible:ring-accent">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink-strong">{r.accountName}</span>
                    <span className="block text-label text-ink-muted [overflow-wrap:anywhere]">{r.title} · {r.findings} finding{r.findings === 1 ? "" : "s"} to keep or drop</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Snooze itemKey={`research:${r.noteId}`} {...later} />
                    <Link data-inbox-open href={`/accounts/${r.accountId}/research#research-review`} className="inline-flex min-h-11 items-center rounded-lg bg-ink px-3 text-label font-semibold text-ink-invert hover:bg-ink-strong sm:min-h-9">
                      Review
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {show("plan") && (
        <Section id="inbox-plan" title="Plan check-in" aside={<span>{counts.plan}</span>} empty={counts.plan === 0}>
          <div data-testid="plan-questions">
            <PlanQuestions
              cards={planCards(openPlanQuestions(user.id, { everyone: true, today }))}
              picks={[
                { label: "This week", day: addDays(today, 4) },
                { label: "In two weeks", day: addDays(today, 14) },
                { label: "In a month", day: addDays(today, 30) },
              ].map((p) => ({ ...p, shown: fmtDay(p.day, now) }))}
              today={today}
              answers={{ setNextStep: setNextStepAction, setStatus: setPlayStatusAction, editThesis: editThesisAction, dismiss: dismissPlanQuestion }}
            />
          </div>
        </Section>
      )}

      {show("promise") && assistantMode("promise_keeper") === "off" && (
        <p className="mb-6 rounded-xl bg-surface-sunk px-4 py-3 text-label text-ink" data-testid="promises-off">
          Promise keeper is off. <Link href="/assistants" className="font-semibold text-accent hover:underline">Switch it on</Link> to be reminded before promises fall due.
        </p>
      )}
      {show("promise") && assistantMode("promise_keeper") !== "off" && (
        <Section id="inbox-promise" title="Promises" aside={<span>{counts.promise}</span>} empty={counts.promise === 0}>
          <div data-testid="promise-questions">
            <PromiseQuestions
              questions={openNotices(user.id, today, { everyone: true })
                .filter((q) => q.kind === "question")
                .map((q) => ({ id: q.id, owner: q.item_owner ?? "They", text: q.item_text, accountName: q.account_name, href: `/follow-ups/${q.action_item_id}`, whose: q.for_user_id && q.for_user_id !== user.id ? q.for_user_name : null }))}
              picks={[
                { label: "This Friday", day: nextFriday(today) },
                { label: "Next week", day: addDays(today, 7) },
                { label: "In two weeks", day: addDays(today, 14) },
              ].map((p) => ({ ...p, shown: fmtDay(p.day, now) }))}
              today={today}
              answer={answerPromise}
              dismiss={dismissNotice}
            />
          </div>
          {/* What either side promised for the next two days. */}
          {only === "promise" && (() => {
            const soon = openNotices(user.id, today, { everyone: true }).filter((n) => n.kind === "notify");
            return soon.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">Coming up</h3>
                <ul className="divide-y divide-line" data-testid="promise-soon">
                  {soon.map((n) => (
                    <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`/follow-ups/${n.action_item_id}`} className="font-medium text-ink-strong hover:underline [overflow-wrap:anywhere]">{n.item_text}</Link>
                        <p className="text-micro text-ink-muted">{n.account_name} · {n.text}{n.for_user_id && n.for_user_id !== user.id && n.for_user_name ? ` · for ${n.for_user_name}` : ""}</p>
                      </div>
                      <DismissButton dismiss={dismissNotice.bind(null, n.id)} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })()}
        </Section>
      )}

      {show("calendar") && listSources().length > 0 && (() => {
        const review = calendarReview(today);
        const accounts = listAccountChoices();
        return (
          <Section id="inbox-calendar" title="Calendar" aside={<span>{counts.calendar}</span>} empty={counts.calendar === 0}>
            {review.toAdd.length > 0 && (
              <AddMeetings rows={review.toAdd.map((e) => ({ id: e.id, title: e.title, when: when(e), accountName: e.accountName!, reason: e.reason, people: people(e) }))} add={addMeetingsAction} ignore={ignoreEventsAction} />
            )}
            {review.questions.length > 0 && (
              <ul className="mt-3 divide-y divide-line">
                {review.questions.map((e) => (
                  <WhichAccount key={e.id} row={{ id: e.id, title: e.title, when: when(e), reason: e.reason, people: people(e), suggested: suggestAccounts(e.attendees) }} accounts={accounts} add={addWithAccountAction.bind(null, e.id)} ignore={ignoreEventsAction.bind(null, [e.id])} />
                ))}
              </ul>
            )}
            {counts.calendar === 0 && <Empty>No calendar events waiting.</Empty>}
          </Section>
        );
      })()}

      {only === null && summary.snoozed.length > 0 && (
        <details className="mt-6 text-label" data-testid="inbox-snoozed">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">Put off ({summary.snoozed.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {summary.snoozed.map((z) => (
              <li key={z.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{z.label} <span className="text-ink-muted">· back {fmtDay(z.until, now)}</span></span>
                <Wake itemKey={z.key} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-8 hidden text-micro text-ink-faint sm:block"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> open · <kbd>a</kbd> accept quick · <kbd>s</kbd> later</p>
    </Page>
  );
}
