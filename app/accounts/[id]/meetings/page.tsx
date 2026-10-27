import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getAccount, listContacts } from "@/lib/queries/accounts";
import { listMeetings } from "@/lib/queries/meetings";
import { providerProblem } from "@/lib/ai/client";
import { ROLES } from "@/lib/ai/models";
import { runningRunFor } from "@/lib/ai/guard";
import { nextAccountMeeting } from "@/lib/glance";
import { todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ArchiveButton } from "@/components/ArchiveButton";
import { MeetingNew } from "@/components/MeetingNew";
import { Chip, Empty, Section } from "@/components/ui";
import { archiveRecord, createMeeting } from "@/app/actions";

export const dynamic = "force-dynamic";

const MEETINGS_SHOWN = 12;

function attendeeNames(json: string): string {
  try {
    const list = JSON.parse(json) as Array<{ name: string }>;
    return Array.isArray(list) ? list.map((a) => a.name).join(", ") : "";
  } catch {
    return "";
  }
}

export default async function AccountMeetingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  if (account.kind === "own_work") redirect("/follow-ups");
  const all = (await searchParams).all === "1";
  const meetings = listMeetings(id);
  const now = new Date();
  const next = nextAccountMeeting(meetings, now);
  const aiProblem = providerProblem(ROLES.plan_draft.provider);
  const inFlight = runningRunFor(id) !== null;

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="meetings" />
      <Section id="meetings" title="Meetings" aside={<span>{meetings.length}</span>}>
        <div id="meeting-new" className="mb-4">
          <MeetingNew
            compact={meetings.length === 0}
            accountId={id}
            action={createMeeting.bind(null, id)}
            contacts={listContacts(id).map((c) => ({ id: c.id, name: c.name }))}
            today={todayISO(now)}
            pasteDisabledReason={aiProblem ?? (inFlight ? "Another AI run is working on this account." : null)}
          />
        </div>
        {meetings.length === 0 ? (
          <Empty>No meetings yet.</Empty>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {meetings.slice(0, all ? undefined : MEETINGS_SHOWN).map((m) => {
                const who = attendeeNames(m.attendees_json);
                return (
                  <li key={m.id} className="meeting-scan-row py-3" data-testid="account-meeting-row">
                    <div className="min-w-0">
                      <Link data-testid="meeting-row-title" href={`/accounts/${id}/meetings/${m.id}`} className="block min-h-11 w-full py-1 font-semibold text-ink hover:text-accent hover:underline">
                        {m.title}
                        {next?.id === m.id && <span className="ml-2 align-middle"><Chip tone="accent">next</Chip></span>}
                      </Link>
                      <div className="text-micro tabular-nums text-ink-muted">
                        {fmtDay(m.held_at)}
                        {m.held_time ? ` at ${m.held_time}` : ""}
                        {who ? ` · ${who}` : ""}
                      </div>
                      {m.summary && <p className="mt-1 line-clamp-2 text-label text-ink-muted">{m.summary}</p>}
                    </div>
                    <div className="meeting-row-actions mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-label text-ink-muted">
                      {m.brief_json && <Chip tone="accent">brief</Chip>}
                      {m.raw_notes && <span>notes</span>}
                      {m.summary && <span>summary</span>}
                      <ArchiveButton what={m.title} action={archiveRecord.bind(null, "meeting", m.id)} />
                    </div>
                  </li>
                );
              })}
            </ul>
            {!all && meetings.length > MEETINGS_SHOWN && (
              <Link href={`/accounts/${id}/meetings?all=1`} className="mt-3 inline-block text-label font-semibold text-accent hover:underline">
                {meetings.length - MEETINGS_SHOWN} more meeting{meetings.length - MEETINGS_SHOWN === 1 ? "" : "s"} →
              </Link>
            )}
          </>
        )}
      </Section>
    </Page>
  );
}
