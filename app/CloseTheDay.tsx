// Close the day, as a view of Today (/?view=close, DECISIONS #105): what you
// did, the loose ends, tomorrow's first meeting, and a two-line note for your
// partner that you choose to send. On a quiet day, tomorrow and what is still
// open lead, because they are true on any day; otherwise what you did leads.
import Link from "next/link";
import { listUsers, type PublicUser } from "@/lib/auth";
import { getRun } from "@/lib/ai/guard";
import { runState } from "@/lib/ai/runState";
import { closeTheDay } from "@/lib/queries/closeTheDay";
import { closeNote, todaysCloseThread } from "@/lib/assistants/closeTheDay";
import { markReadySeen } from "@/lib/assistants/ready";
import { latestRunId } from "@/lib/ask/threads";
import { resolveSources } from "@/lib/ask/sources";
import { answerToText } from "@/lib/ask/plainText";
import { AskMarkdown } from "@/lib/ask/markdown";
import { recapMailto } from "@/lib/meetings/recap";
import { fmtDay } from "@/lib/format";
import { AskLive } from "@/components/AskBox";
import { CopyAndMail } from "@/components/CopyAndMail";
import { Empty, PageHeader, Section } from "@/components/ui";
import { DraftNote, LooseEndControls, SendNote } from "./close/CloseControls";
import { PlanningCapture } from "@/components/PlanningCapture";

export function CloseTheDay({ user, now = new Date() }: { user: PublicUser; now?: Date }) {
  const day = closeTheDay(user.id, now);
  const quiet = day.did.length === 0 && day.decided === 0;
  markReadySeen(`close:${user.id}:${day.today}`, user.id);
  // Who the note is for: the other one of you, or the team when there are more.
  const others = listUsers().filter((u) => u.id !== user.id);
  const partner = others.length === 0 ? null : { display_name: others.length === 1 ? others[0]!.display_name : "the team" };
  const threadId = todaysCloseThread(user.id, now);
  const note = threadId ? closeNote(threadId) : null;
  const runId = threadId ? latestRunId(threadId) : null;
  const run = runId ? getRun(runId) : null;
  const live = run && run.status === "running" ? { id: run.id, state: runState<{ steps?: string[]; draft?: string }>(run) } : null;
  const sources = note ? resolveSources(note.citations) : [];
  const mail = note ? recapMailto([], `Today, ${fmtDay(day.today, now)}`, answerToText(note.text, sources)) : null;

  const tomorrowSection = (
      <Section title="Tomorrow">
        {day.tomorrowFirst ? (
          <p className="text-body" data-testid="close-tomorrow">
            First up: <Link href={day.tomorrowFirst.href} className="font-semibold text-accent hover:underline">{day.tomorrowFirst.title}</Link>
            <span className="text-ink-muted">, {day.tomorrowFirst.accountName}{day.tomorrowFirst.heldTime ? ` at ${day.tomorrowFirst.heldTime}` : ""}</span>
          </p>
        ) : (
          <Empty>No meeting on file for tomorrow.</Empty>
        )}
      </Section>
  );
  const looseSection = (
      <Section title="Loose ends">
        {day.loose.length === 0 ? (
          <Empty>Nothing of yours is due today or late.</Empty>
        ) : (
          <ul className="divide-y divide-line" data-testid="close-loose">
            {day.loose.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
                <span className="min-w-0">
                  <Link href={`/follow-ups/${l.id}`} className="font-medium text-ink hover:text-accent [overflow-wrap:anywhere]">{l.text}</Link>
                  <span className="block text-micro text-ink-muted">{l.accountName} · {l.due < day.today ? `was due ${fmtDay(l.due, now)}` : "due today"}</span>
                </span>
                <LooseEndControls id={l.id} accountId={l.accountId} text={l.text} version={l.version} tomorrow={day.tomorrow} />
              </li>
            ))}
          </ul>
        )}
      </Section>
  );
  const didSection = (
      <Section title={quiet ? "From today" : "What you did"}>
        {quiet ? (
          // A day of calls and driving changes nothing in the app, and that
          // is not a failing: say so plainly and offer to catch what is
          // worth keeping, rather than reporting an empty day.
          <div data-testid="close-quiet">
            <p className="mb-3 text-label text-ink-muted">Nothing changed in the app today, which is normal on a day of calls. Anything from them worth keeping?</p>
            <PlanningCapture me={user.id} />
          </div>
        ) : (
          <ul className="divide-y divide-line" data-testid="close-did">
            {day.did.map((d) => (
              <li key={`${d.kind}:${d.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                <Link href={d.href} className="min-w-0 font-medium text-ink hover:text-accent [overflow-wrap:anywhere]">{d.label}</Link>
                <span className="text-micro text-ink-muted">{d.accountName} · {d.what}</span>
              </li>
            ))}
            {day.decided > 0 && <li className="py-2 text-label text-ink-muted">Decided {day.decided} proposed change{day.decided === 1 ? "" : "s"}.</li>}
          </ul>
        )}
      </Section>
  );
  const ordered = quiet ? [tomorrowSection, looseSection, didSection] : [didSection, looseSection, tomorrowSection];

  return (
    <>
      <PageHeader title="Close the day" sub={fmtDay(day.today, now)} />
      {ordered.map((s, i) => (
        <div key={i}>{s}</div>
      ))}
      <Section title={partner ? `A note for ${partner.display_name}` : "Your note"}>
        <div>
          {live ? (
            <AskLive key={live.id} run={live} startedAt={run?.started_at} />
          ) : note ? (
            <div className="space-y-3" data-testid="close-note">
              <AskMarkdown text={note.text} marker={(n) => <sup className="ml-0.5 text-micro text-ink-muted">[{n}]</sup>} />
              {sources.length > 0 && (
                <p className="text-micro text-ink-muted">From {sources.map((s) => s.label).join(", ")}.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {partner && threadId && <SendNote threadId={threadId} partner={partner.display_name} />}
                {mail && <CopyAndMail text={answerToText(note.text, sources)} mailto={mail.href} withBody={mail.withBody} testId="close-copy" />}
                <DraftNote again />
              </div>
              <p className="text-micro text-ink-muted">Nothing is sent from Strategy: Send puts it on {others.length > 1 ? "everyone else's" : partner ? `${partner.display_name}'s` : "their"} Today.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-label text-ink-muted">Two lines on what you did today, from the records you touched, with sources.</p>
              <DraftNote />
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
