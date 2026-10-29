import Link from "next/link";
import { localAccountAttention } from "@/lib/local/attention";

export function AccountAttention({ accountId }: { accountId: string }) {
  const attention = localAccountAttention(accountId);
  const base = `/accounts/${accountId}`;
  const due = attention.overdue + attention.dueToday;
  const needsAttention = attention.pending + due + attention.missingNextStep > 0;
  return (
    <section className="rounded-lg border border-line bg-surface p-5 space-y-3" data-testid="account-attention">
      <h2 className="text-lead font-semibold">Needs attention</h2>
      {needsAttention ? (
        <ul className="space-y-2">
          {attention.pending > 0 && <li><Link className="underline" href={`/inbox?kind=changes&account=${accountId}`}>{attention.pending} proposed {attention.pending === 1 ? "change" : "changes"} to review</Link></li>}
          {due > 0 && <li><Link className="underline" href={`${base}/follow-ups`}>{attention.overdue} overdue · {attention.dueToday} due today</Link></li>}
          {attention.missingNextStep > 0 && <li><Link className="underline" href={`${base}/deals?next=none`}>{attention.missingNextStep} open {attention.missingNextStep === 1 ? "opportunity needs" : "opportunities need"} a next step</Link></li>}
        </ul>
      ) : <p>No pending changes, due follow-ups, or missing opportunity next steps in the saved records.</p>}
      {attention.followUps.length > 0 && <div>
        <h3 className="font-semibold">Follow-ups to work on</h3>
        <ul className="mt-2 space-y-2">
          {attention.followUps.map(item => <li key={item.id}>
            <Link className="underline" href={`/follow-ups/${item.id}`}>{item.text}</Link>
            <p className="text-label">{item.due < attention.today ? "Overdue" : "Due today"} · {item.due} · {item.owner || "Owner not assigned"}</p>
          </li>)}
        </ul>
        {due > attention.followUps.length && <p className="mt-2 text-label">Showing {attention.followUps.length} of {due} due follow-ups. <Link className="underline" href={`${base}/follow-ups`}>View all follow-ups</Link></p>}
      </div>}
      {attention.nextMeeting ? <div>
        <h3 className="font-semibold">Current or next meeting</h3>
        <Link className="underline" href={`${base}/meetings/${attention.nextMeeting.id}`}>{attention.nextMeeting.title}</Link>
        <p className="text-label">{attention.nextMeeting.held_at}{attention.nextMeeting.held_time ? ` at ${attention.nextMeeting.held_time}` : " · Time not set"}</p>
      </div> : <p>No upcoming meeting on file. <Link className="underline" href={`${base}/meetings`}>Plan a meeting</Link></p>}
      {!needsAttention && <p className="text-label"><Link className="underline" href={`${base}/evidence#new-account-intake`}>Prepare account research with MyAgent</Link> or <Link className="underline" href={`${base}/follow-ups`}>add a follow-up</Link>.</p>}
    </section>
  );
}
