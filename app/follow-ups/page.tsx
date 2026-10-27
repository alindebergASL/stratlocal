// What I owe, across every account.
//
// Follow-ups lived on one account page each, and Home showed only the overdue
// ones — so the question these two actually ask on a Monday, "what have I
// got", had no screen. It needed `owner_user_id` first: `owner` is free text,
// written by extraction from whatever the notes said, and no query can turn
// "Jamie" and "Jamie L." into one person.
import Link from "next/link";
import { PlanningCapture } from "@/components/PlanningCapture";
import { TaskAnchorRecovery } from "@/components/TaskAnchorRecovery";
import { followUpSources } from "@/lib/queries/followUpSources";
import { listUsers, requirePageUser } from "@/lib/auth";
import { listOpenFollowUps } from "@/lib/queries/meetings";
import { OWN_WORK_ACCOUNT_ID } from "@/lib/db";
import { saveActionItem, setActionItemStatus } from "@/app/actions";
import { todayISO } from "@/lib/clock";
import { fmtDay } from "@/lib/format";
import { Page } from "@/components/Nav";
import { AccountLink, ButtonLink, Empty, Eyebrow, PageHeader, Section } from "@/components/ui";
import { ActionItems, type ActionItemView } from "@/components/ActionItems";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ who?: string; add?: string; when?: string; page?: string }> }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const users = listUsers();
  const owners = users.map((u) => ({ id: u.id, name: u.display_name }));
  const who = params.who !== user.id && (params.who === "all" || params.who === "unowned" || users.some((u) => u.id === params.who)) ? params.who : "me";
  const ownerName = users.find((u) => u.id === who)?.display_name;
  const scope = who === "all" ? "across all assignees" : who === "me" ? "assigned to you" : who === "unowned" ? "without an owner" : `assigned to ${ownerName}`;
  const emptySummary = who === "all" ? "No open tasks in this view." : who === "me" ? "Nothing assigned to you."
    : who === "unowned" ? "No unassigned follow-ups." : `Nothing assigned to ${ownerName}.`;
  // Writing something down is this page's primary action, and until now it was
  // its last: a quiet button under each account group, one per group, and the
  // one you wanted sat below an empty list. The header control links here, and
  // the Own work group opens because that is where a todo with no customer
  // belongs (DECISIONS #29). A parameter rather than shared client state, so
  // the control stays a link and the editor stays where it lives.
  const addingOwnWork = params.add === "1";
  const ownerUserId = who === "me" ? user.id : who === "unowned" ? null : (who ?? null);

  const allItems = listOpenFollowUps(who === "all" ? {} : who === "unowned" ? { unowned: true } : { ownerUserId });
  const filtered = params.when === "unscheduled" ? allItems.filter(i => i.due === null) : allItems;
  const page = Math.max(1, Math.min(Math.ceil(filtered.length / 50) || 1, Math.floor(Number(params.page)) || 1));
  const items = filtered.slice((page - 1) * 50, page * 50);
  const sources = followUpSources(items, (id) => `/follow-ups${who === "me" ? "" : `?who=${encodeURIComponent(who!)}`}#action-${id}`);
  const today = todayISO();
  const overdue = filtered.filter((i) => i.due !== null && i.due < today);

  // Grouped by account, because that is how you act on them: you open one
  // account and do the three things you owe it.
  const byAccount = new Map<string, typeof items>();
  // Own work first, and present even when empty. It is the only group that has
  // to exist before it has anything in it: every other group appears because a
  // follow-up on that account already exists, but a todo that is not about a
  // customer has no other door into the app — without this there is nowhere to
  // write the first one down.
  byAccount.set(OWN_WORK_ACCOUNT_ID, []);
  for (const i of items) byAccount.set(i.account_id, [...(byAccount.get(i.account_id) ?? []), i]);

  const groups = [...byAccount.entries()].sort(([a, rowsA], [b, rowsB]) => {
    if (addingOwnWork) return a === OWN_WORK_ACCOUNT_ID ? -1 : b === OWN_WORK_ACCOUNT_ID ? 1 : 0;
    return Number(rowsA.length === 0) - Number(rowsB.length === 0);
  });

  const toView = (i: (typeof items)[number]): ActionItemView => ({
    id: i.id,
    text: i.text,
    owner: i.owner,
    ownerUserId: i.owner_user_id ?? null,
    due: i.due,
    status: i.status,
    quote: null,
    version: i.updated_at,
    meetingTitle: null,
    sources: sources.get(i.id),
  });

  const tabs: Array<{ key: string; label: string }> = [
    { key: "all", label: "All" },
    { key: "me", label: "Mine" },
    ...users.filter((u) => u.id !== user.id).map((u) => ({ key: u.id, label: u.display_name })),
    { key: "unowned", label: "Nobody's" },
  ];

  return (
    <Page user={user}>
      <TaskAnchorRecovery />
      <PageHeader
        title="Tasks"
        sub={
          items.length === 0
            ? emptySummary
            : `${filtered.length} open ${scope}${overdue.length > 0 ? `, ${overdue.length} past due` : ""}.`
        }
        actions={
          <ButtonLink href="/follow-ups?add=1#own-work-group" testId="follow-up-add-top">
            Add own work
          </ButtonLink>
        }
      />

      <PlanningCapture me={user.id} />
      <div className="mb-4 flex flex-wrap gap-4 text-label text-accent"><Link href={`/follow-ups?who=${who}`} aria-current={!params.when ? "page" : undefined}>All open tasks ({allItems.length})</Link><Link href={`/follow-ups?who=${who}&when=unscheduled`} aria-current={params.when === "unscheduled" ? "page" : undefined}>Unscheduled ({allItems.filter(i => i.due === null).length})</Link></div>
      <p className="mb-2 text-micro text-ink-muted">Task assignee · independent of account ownership</p>
      <div className="mb-5 flex flex-wrap items-center gap-1.5 text-label">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "me" ? "/follow-ups" : `/follow-ups?who=${t.key}`}
            aria-current={t.key === who ? "page" : undefined}
            className={`rounded-md px-2 py-0.5 transition-colors ${
              t.key === who ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {items.length === 0 && who !== "me" ? (
        <Section title="Clear">
          <Empty>No open follow-ups {scope}. Choose another list or add a follow-up.</Empty>
        </Section>
      ) : (
        <Section title="By account">
          <div className="space-y-5">
            {groups.map(([accountId, rows]) => (
              <div
                key={accountId}
                // The header's Add control links to this anchor, so it needs to
                // be an id and not only a testid. globals.css gives every [id]
                // scroll-margin so it clears the sticky header.
                id={accountId === OWN_WORK_ACCOUNT_ID ? "own-work-group" : undefined}
                data-testid={accountId === OWN_WORK_ACCOUNT_ID ? "own-work-group" : "account-group"}
              >
                <Eyebrow className="mb-1">
                  {accountId === OWN_WORK_ACCOUNT_ID ? (
                    <span className="text-label">Own work</span>
                  ) : (
                    <AccountLink id={accountId} name={rows[0]!.account_name} className="text-label" />
                  )}
                  {" · "}
                  {rows.length} open
                  {/* Undated follow-ups are invisible to Home and to every
                      attention query, which require a due date. Saying so is
                      the only prompt anyone gets to give them one. */}
                  {rows.some((r) => r.due === null) && (
                    <span className="ml-2 font-normal text-ink-muted">
                      {rows.filter((r) => r.due === null).length} with no date
                    </span>
                  )}
                </Eyebrow>
                {/* Editable here, not only on the account.
                    This page exists to answer "what have I got", and it showed
                    an Archive button, no Edit and no Add — while its own
                    heading flagged "N with no date" as the problem. Every
                    attention surface requires a date, so an undated follow-up
                    is invisible to Home forever, and the one screen that said
                    so could not fix it. Bound per account, because that is
                    what saveActionItem takes and this list is grouped by
                    account anyway. */}
                <ActionItems
                  // The header's Add is a link, so pressing it is a soft
                  // navigation: React reconciles this already-mounted client
                  // component rather than remounting it, and a useState
                  // initialiser does not run again — so `startOpen` arrived as
                  // a prop nothing read, and the button did nothing. The key
                  // changes when the flag does, which is what makes it a new
                  // component. Found in the browser; it typechecked and built
                  // perfectly with the bug in it.
                  key={accountId === OWN_WORK_ACCOUNT_ID && addingOwnWork ? "adding" : "idle"}
                  items={rows.map(toView)}
                  setStatus={setActionItemStatus.bind(null, accountId)}
                  save={saveActionItem.bind(null, accountId)}
                  owners={owners}
                  me={user.id}
                  today={today}
                  startOpen={accountId === OWN_WORK_ACCOUNT_ID && addingOwnWork}
                  // Own work is the one group that can be empty, so it is the
                  // one that has to say what belongs in it. Every other group
                  // exists because it already has rows.
                  emptyText={
                    accountId === OWN_WORK_ACCOUNT_ID
                      ? `No own work ${scope}. This is where work that is not about a customer goes — build the forecast, prep the deck, chase the partner agreement.`
                      : ""
                  }
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      {filtered.length > 50 && <nav aria-label="Task pages" className="my-4 flex gap-4 text-label text-accent">{page > 1 && <Link href={`/follow-ups?who=${who}&when=${params.when ?? ""}&page=${page - 1}`}>Previous</Link>}<span>Page {page} of {Math.ceil(filtered.length / 50)}</span>{page * 50 < filtered.length && <Link href={`/follow-ups?who=${who}&when=${params.when ?? ""}&page=${page + 1}`}>Next</Link>}</nav>}
      {overdue.length > 0 && (
        <p className="mt-4 text-micro text-ink-muted">
          Past due: {overdue.map((i) => fmtDay(i.due!)).slice(0, 3).join(", ")}
          {overdue.length > 3 ? ` and ${overdue.length - 3} more` : ""}.
        </p>
      )}
    </Page>
  );
}
