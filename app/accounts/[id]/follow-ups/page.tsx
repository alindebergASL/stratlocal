import { notFound, redirect } from "next/navigation";
import { listUsers, requirePageUser } from "@/lib/auth";
import { getAccount, playOptionsFor } from "@/lib/queries/accounts";
import { listActionItems, listMeetings } from "@/lib/queries/meetings";
import { followUpViews } from "@/lib/followUpViews";
import { todayISO } from "@/lib/clock";
import { Page } from "@/components/Nav";
import { AccountHeader } from "@/components/AccountHeader";
import { ActionItems } from "@/components/ActionItems";
import { ExportCsv } from "@/components/ExportCsv";
import { Section } from "@/components/ui";
import { saveActionItem, setActionItemStatus, setActionItemsStatus } from "@/app/actions";

export const dynamic = "force-dynamic";

// Every follow-up on the account, editable: owner, date, play, done. The
// Overview shows the few that are due; this is the whole list, and each one
// also has a page of its own (/follow-ups/[id]) that every link points at.
export default async function AccountFollowUpsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const account = getAccount(id);
  if (!account) notFound();
  if (account.kind === "own_work") redirect("/follow-ups");
  const meetings = listMeetings(id);
  const open = listActionItems(id, { status: "open" });
  const done = listActionItems(id).filter((a) => a.status === "done");
  const owners = listUsers().map((u) => ({ id: u.id, name: u.display_name }));
  const today = todayISO(new Date());
  const toggle = setActionItemStatus.bind(null, id);

  return (
    <Page user={user}>
      <AccountHeader account={account} tab="follow-ups" />
      <Section
        id="follow-ups"
        title="Follow-ups"
        aside={
          <>
            <span>{open.length} open</span>
            <ExportCsv accountId={id} what="follow-ups" />
          </>
        }
      >
        <ActionItems
          items={followUpViews(open, meetings)}
          setStatus={toggle}
          setMany={setActionItemsStatus.bind(null, id)}
          save={saveActionItem.bind(null, id)}
          owners={owners}
          plays={playOptionsFor(id, open.map((a) => a.play_id))}
          me={user.id}
          today={today}
          compactEmpty={open.length === 0 && done.length === 0}
          emptyText="No open follow-ups."
        />
        {done.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-label text-ink-muted hover:text-ink">Done ({done.length})</summary>
            <ActionItems items={followUpViews(done, meetings)} setStatus={toggle} today={today} emptyText="" />
          </details>
        )}
      </Section>
    </Page>
  );
}
