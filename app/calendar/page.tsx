import Link from "next/link";
import { listUsers, requirePageUser } from "@/lib/auth";
import { listAccountChoices } from "@/lib/queries/accounts";
import { todayISO } from "@/lib/clock";
import { fmtDay, fmtWhen } from "@/lib/format";
import { calendarReview, type ReviewEvent } from "@/lib/calendar/review";
import { describeSource, listSources, suggestAccounts } from "@/lib/calendar/sync";
import { googleConfigured, googleServiceEmail, graphConfigured } from "@/lib/calendar/providers";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { ResultButton } from "@/components/ResultButton";
import { Chip, control, Field, Section } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AddMeetings, WhichAccount } from "./CalendarPieces";
import {
  addMeetingsAction,
  addWithAccountAction,
  archiveCancelledMeetingAction,
  connectCalendarAction,
  disconnectCalendarAction,
  ignoreEventsAction,
  keepMeetingAction,
  moveMeetingAction,
  syncNowAction,
} from "./actions";

export const dynamic = "force-dynamic";

function when(e: Pick<ReviewEvent, "day" | "time" | "allDay">, now: Date): string {
  return `${fmtDay(e.day, now)}${e.allDay ? ", all day" : e.time ? ` · ${e.time}` : ""}`;
}

function peopleLine(e: ReviewEvent): string {
  const names = e.outsiders.map((p) => p.name ?? p.email);
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

// The calendars, read and matched by code (DECISIONS #42). This page is the
// only place an event becomes a meeting, and only on a tap.
export default async function CalendarPage() {
  const user = await requirePageUser();
  const now = new Date();
  const today = todayISO(now);
  const sources = listSources();
  const review = calendarReview(today);
  const accounts = listAccountChoices().map((a) => ({ id: a.id, name: a.name }));
  const users = listUsers();
  const graphProblem = graphConfigured();
  const googleProblem = googleConfigured();
  const lastRead = Math.max(0, ...sources.map((s) => s.last_synced_at ?? 0));

  return (
    <Page user={user} main="max-w-3xl">
      <header className="mb-8">
        <h1 className="font-display text-display font-extrabold tracking-tight text-ink-strong">Calendar</h1>
        <p className="mt-2 max-w-2xl text-lead text-ink">
          Customer meetings from your calendars, matched to accounts by who is invited. Nothing becomes a meeting until you add it, and nothing is ever written to your calendar.
        </p>
        {sources.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-label text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><Icon name="clock" className="size-4" />{lastRead ? `Last read ${fmtWhen(lastRead)}` : "Not read yet"} · {sources.length} calendar{sources.length === 1 ? "" : "s"}</span>
            <ResultButton run={syncNowAction} testId="calendar-sync">Read now</ResultButton>
          </div>
        )}
      </header>

      {review.timeOff.length > 0 && (
        <ul className="mb-6 space-y-2" data-testid="calendar-time-off">
          {review.timeOff.map((t) => (
            <li key={`${t.userId}-${t.from}`} className="flex items-center gap-3 rounded-xl bg-warning-soft px-4 py-3 text-label text-warning ring-1 ring-warning-line">
              <Icon name="flag" className="size-4 shrink-0" />
              <span><span className="font-semibold">{t.userId === user.id ? "You are" : `${t.userName} is`} off</span> {t.from === t.to ? fmtDay(t.from, now) : `${fmtDay(t.from, now)} – ${fmtDay(t.to, now)}`}</span>
            </li>
          ))}
        </ul>
      )}

      {sources.length > 0 && (
        <>
          <Section title="Customer meetings to add" id="add" aside={<span>{fmtDay(review.window.from, now)} – {fmtDay(review.window.to, now)}</span>} empty={review.toAdd.length === 0}>
            <AddMeetings
              rows={review.toAdd.map((e) => ({ id: e.id, title: e.title, when: when(e, now), accountName: e.accountName!, reason: e.reason, people: peopleLine(e) }))}
              add={addMeetingsAction}
              ignore={ignoreEventsAction}
            />
          </Section>

          {review.questions.length > 0 && (
            <Section title="Which account?" id="questions" aside={<span>{review.questions.length}</span>}>
              <ul className="divide-y divide-line">
                {review.questions.map((e) => (
                  <WhichAccount
                    key={e.id}
                    row={{ id: e.id, title: e.title, when: when(e, now), reason: e.reason, people: peopleLine(e), suggested: suggestAccounts(e.attendees) }}
                    accounts={accounts}
                    add={addWithAccountAction.bind(null, e.id)}
                    ignore={ignoreEventsAction.bind(null, [e.id])}
                  />
                ))}
              </ul>
            </Section>
          )}

          {review.changed.length > 0 && (
            <Section title="Changed since you added it" id="changed">
              <ul className="divide-y divide-line" data-testid="calendar-changed">
                {review.changed.map((c) => (
                  <li key={c.id} className="py-3">
                    <Link href={`/accounts/${c.accountId}/meetings/${c.meetingId}`} className="font-medium text-ink-strong hover:underline">{c.meetingTitle}</Link>
                    <p className="text-micro text-ink-muted">
                      {c.what === "cancelled"
                        ? `The invite for ${fmtDay(c.day, now)} was cancelled.`
                        : c.what === "gone"
                          ? `The invite for ${fmtDay(c.day, now)} is no longer in the weeks Strategy reads: it was removed, or moved further out.`
                          : `The invite moved to ${when(c, now)}; the meeting says ${fmtDay(c.meetingDay, now)}${c.meetingTime ? ` · ${c.meetingTime}` : ""}.`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.what === "moved" ? (
                        <ResultButton run={moveMeetingAction.bind(null, c.id, { meetingVersion: c.meetingVersion, signature: c.signature })} variant="primary" testId="calendar-move">Move the meeting</ResultButton>
                      ) : (
                        <ResultButton run={archiveCancelledMeetingAction.bind(null, c.id, { meetingVersion: c.meetingVersion, signature: c.signature })} variant={c.what === "cancelled" ? "primary" : "quiet"} testId="calendar-archive">Archive the meeting</ResultButton>
                      )}
                      <ResultButton run={keepMeetingAction.bind(null, c.id, c.signature)} variant="ghost" testId="calendar-keep">Keep it as it is</ResultButton>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {review.internalCount > 0 && (
            <p className="mb-6 text-micro text-ink-muted" data-testid="calendar-internal">{review.internalCount} internal event{review.internalCount === 1 ? "" : "s"} in the same weeks skipped: nobody from outside was invited.</p>
          )}
        </>
      )}

      <Section title={sources.length ? "Connected calendars" : "Connect a calendar"} id="sources">
        {sources.length === 0 && (
          <p className="mb-4 max-w-2xl text-label text-ink">
            Paste a published calendar link from Outlook or Google: no IT needed. Strategy reads it every fifteen minutes and never writes to it.
          </p>
        )}
        {sources.length > 0 && (
          <ul className="mb-4 divide-y divide-line" data-testid="calendar-sources">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-strong">{s.label} {s.owner_user_id && <Chip className="ml-1">{users.find((u) => u.id === s.owner_user_id)?.display_name ?? "someone"}&apos;s</Chip>}</p>
                  <p className="text-micro text-ink-muted">
                    {describeSource(s)} · {s.last_synced_at ? `read ${fmtWhen(s.last_synced_at)}${s.last_count != null ? `, ${s.last_count} events` : ""}` : "not read yet"}
                    {s.watch_expires_at && s.watch_expires_at > Date.now() ? " · told of changes as they happen" : ""}
                  </p>
                  {s.last_error && <p role="alert" className="mt-1 text-micro text-danger">{s.last_error}</p>}
                </div>
                <ResultButton run={disconnectCalendarAction.bind(null, s.id)} variant="ghost" testId="calendar-disconnect">Disconnect</ResultButton>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={connectCalendarAction} trigger={sources.length ? "Connect another" : "Connect a calendar"} submitLabel="Connect" testId="calendar-connect" open={sources.length === 0} className="grid gap-3 sm:grid-cols-2">
          <Field label="What it is">
            <select name="kind" className={control} defaultValue="ics" data-testid="calendar-kind">
              <option value="ics">A published calendar link (.ics)</option>
              <option value="graph" disabled={!!graphProblem}>Strategy&apos;s Outlook mailbox{graphProblem ? " (not set up)" : ""}</option>
              <option value="google" disabled={!!googleProblem}>A Google calendar shared with Strategy{googleProblem ? " (not set up)" : ""}</option>
            </select>
          </Field>
          <Field label="Whose calendar" hint="A person's own calendar can also say when they are off.">
            <select name="owner" className={control} defaultValue={user.id}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.id === user.id ? `Mine (${u.display_name})` : u.display_name}</option>)}
              <option value="">Strategy&apos;s own, or shared</option>
            </select>
          </Field>
          <Field label="Link, mailbox or calendar ID" wide hint="Outlook: Settings › Calendar › Shared calendars › Publish a calendar › ICS. Google: Settings › your calendar › Secret address in iCal format. The link is kept on the server and never shown again.">
            <input name="value" required className={control} placeholder="https://… or webcal://…" autoComplete="off" data-testid="calendar-value" />
          </Field>
          <Field label="Name (optional)" wide>
            <input name="label" className={control} placeholder="e.g. Alex's work calendar" />
          </Field>
        </ActionForm>
        {/* The mailbox and the service account need someone to set them up
            on the server; most people only ever paste a link. */}
        <details className="mt-4 text-micro text-ink-muted" data-testid="calendar-other-ways">
          <summary className="cursor-pointer py-1 text-label text-ink">Other ways in: Strategy&apos;s Outlook mailbox, a shared Google calendar</summary>
          <div className="mt-1 space-y-1">
          {graphProblem ? <p>Strategy&apos;s Outlook mailbox: not set up; it {graphProblem.replace(/^Outlook /, "")} IT restricts that app to the one mailbox.</p> : <p>Outlook mailbox: ready. Forward customer invites to it, or invite it.</p>}
          {googleProblem ? <p>Shared Google calendar: not set up; it {googleProblem.replace(/^Google /, "")}</p> : <p>Google: share the calendar with {googleServiceEmail()} (See all event details), then connect its calendar ID.</p>}
          </div>
        </details>
      </Section>
    </Page>
  );
}
