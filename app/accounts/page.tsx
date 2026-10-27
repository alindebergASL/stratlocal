import Link from "next/link";
import { listUsers, requirePageUser } from "@/lib/auth";
import { listAccountSummaries, listArchivedAccounts } from "@/lib/queries/accounts";
import { dayOf, daysBetween, todayISO } from "@/lib/clock";
import { currentFiscalQuarter } from "@/lib/fiscal";
import { fmtMoneyShort, relativeDays } from "@/lib/format";
import { ownerLabels, parseOwnerScope, type OwnerFilter } from "@/lib/queries/owner";
import { Page } from "@/components/Nav";
import { AccountLink, control, Empty, Field, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { ArchivedBlock, type ArchivedGroup } from "@/components/ArchivedBlock";
import { OwnerTabs } from "@/components/OwnerTabs";
import { createAccount, restoreRecord } from "../actions";
import { SignalChips } from "@/components/Signal";
import { currentPlaybook, listPlaybooks } from "@/lib/playbook/store";
import { accountSignals, attentionScore } from "@/lib/queries/accountSignals";

export const dynamic = "force-dynamic";

// An account nobody has written anything down about for this long.
//
// With five to fifteen key accounts, the one that kills you is not the one
// with an overdue task — it is the one you have not thought about since
// March. Three weeks rather than a month: a monthly cadence means the signal
// appears the day you are already late, which is a reminder rather than a
// warning.
const QUIET_AFTER_DAYS = 21;

// Fixed tracks for the figures: the header and each row are separate grids,
// and with `auto` every row sized its own columns, so "Region" sat over
// nothing in particular.
const ACCOUNT_COLS = "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_9rem_7rem_9rem]";

function accountsHref(f: OwnerFilter): string {
  return f === "all" ? "/accounts" : `/accounts?who=${f}`;
}

// Every account, and the way to add one. This was the bottom half of Today,
// which made Today about everything; it has its own address now, and Today
// links here.
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ who?: string | string[]; sort?: string; only?: string; archetype?: string }> }) {
  const user = await requirePageUser();
  const now = new Date();
  const today = todayISO(now);
  const query = await searchParams;
  const scope = parseOwnerScope(typeof query.who === "string" ? query.who : undefined, user.id);
  const users = listUsers();
  const labels = ownerLabels(users, user.id);
  const all = listAccountSummaries(scope);
  const signals = accountSignals(all.map((a) => a.id), now);
  const sig = (id: string) => signals.get(id)!;
  // What needs you first, unless asked for A–Z; and, if asked, only the
  // accounts with a reason to act.
  const byName = query.sort === "name";
  const onlyReasons = query.only === "reasons";
  // Archetypes from every playbook the team has: an account names its own
  // playbook's, and the filter offers each one in use.
  const playbook = currentPlaybook()?.playbook ?? null;
  const allArchetypes = listPlaybooks().flatMap((pb) => currentPlaybook({ slug: pb.slug })?.playbook.archetypes ?? []);
  const archetypeName = (aid: string | null | undefined) => (aid ? (allArchetypes.find((x) => x.id === aid)?.name ?? null) : null);
  const byArchetype = typeof query.archetype === "string" && query.archetype ? query.archetype : null;
  const accounts = (onlyReasons ? all.filter((a) => sig(a.id).reason) : all)
    .filter((a) => !byArchetype || a.archetype_id === byArchetype)
    .slice()
    .sort((a, b) => (byName ? 0 : attentionScore(sig(b.id)) - attentionScore(sig(a.id))));
  const withReason = all.filter((a) => sig(a.id).reason).length;
  const withOverdue = all.filter((a) => sig(a.id).overdue > 0).length;
  const listHref = (over: { sort?: string | null; only?: string | null; archetype?: string | null }) => {
    const p = new URLSearchParams();
    if (scope.filter !== "all") p.set("who", scope.filter);
    const sort = over.sort === undefined ? query.sort : over.sort;
    const only = over.only === undefined ? query.only : over.only;
    const arch = over.archetype === undefined ? byArchetype : over.archetype;
    if (sort) p.set("sort", sort);
    if (only) p.set("only", only);
    if (arch) p.set("archetype", arch);
    const q = p.toString();
    return `/accounts${q ? `?${q}` : ""}`;
  };
  const fq = currentFiscalQuarter(now);
  const pipeline = all.reduce((n, a) => n + (a.open_pipeline_usd ?? 0), 0);
  const archived: ArchivedGroup[] = [
    { kind: "account", label: "Accounts", items: listArchivedAccounts().map((a) => ({ id: a.id, label: a.name })) },
  ];
  // Calendar days in the app's timezone, not elapsed hours: an account last
  // touched at 11pm three weeks ago went quiet three weeks ago.
  const goneQuiet = (at: number | null) => at === null || daysBetween(dayOf(at), today) >= QUIET_AFTER_DAYS;
  const quietCount = all.filter((a) => goneQuiet(a.last_activity_at)).length;

  return (
    <Page user={user}>
      <PageHeader
        title="Accounts"
        sub={
          all.length === 0
            ? undefined
            : [
                `${all.length} account${all.length === 1 ? "" : "s"}`,
                `${fmtMoneyShort(pipeline)} open`,
                withReason ? `${withReason} with a reason to act` : null,
                withOverdue ? `${withOverdue} with overdue follow-ups` : null,
                quietCount ? `${quietCount} quiet for three weeks` : null,
              ]
                .filter(Boolean)
                .join(" · ")
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {users.length > 1 && <OwnerTabs current={scope.filter} labels={labels} href={accountsHref} testId="accounts-owner" />}
        {all.length > 1 && (
          <nav aria-label="Order and filter" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label" data-testid="accounts-order">
            <Link href={listHref({ sort: null })} aria-current={!byName ? "page" : undefined} className={!byName ? "font-semibold text-ink-strong" : "text-accent hover:underline"}>Needs you first</Link>
            <Link href={listHref({ sort: "name" })} aria-current={byName ? "page" : undefined} className={byName ? "font-semibold text-ink-strong" : "text-accent hover:underline"}>A–Z</Link>
            {playbook && all.some((a) => archetypeName(a.archetype_id)) && (
              <span className="flex flex-wrap items-center gap-1.5" data-testid="accounts-archetypes">
                {allArchetypes
                  .filter((x, i) => allArchetypes.findIndex((y) => y.id === x.id) === i && all.some((a) => a.archetype_id === x.id))
                  .map((x) => (
                    <Link key={x.id} href={listHref({ archetype: byArchetype === x.id ? null : x.id })} aria-current={byArchetype === x.id ? "page" : undefined} className={`rounded-full px-2.5 py-0.5 ring-1 ${byArchetype === x.id ? "bg-accent-soft font-semibold text-ink ring-accent-line" : "text-ink-muted ring-line hover:text-ink"}`}>
                      {x.name} ({all.filter((a) => a.archetype_id === x.id).length})
                    </Link>
                  ))}
              </span>
            )}
            {withReason > 0 && (
              <Link href={listHref({ only: onlyReasons ? null : "reasons" })} aria-current={onlyReasons ? "page" : undefined} className={`rounded-full px-2.5 py-0.5 ring-1 ${onlyReasons ? "bg-warning-soft font-semibold text-warning ring-warning-line" : "text-ink ring-line hover:ring-warning-line"}`} data-testid="accounts-only-reasons">
                {onlyReasons ? "✓ " : ""}With a reason to act ({withReason})
              </Link>
            )}
          </nav>
        )}
      </div>

      <section id="accounts" className="mb-8" data-testid="accounts-list">
        {accounts.length === 0 ? (
          <Empty>
            {scope.filter === "all"
              ? "No accounts yet. Add the first one below and import a report into it."
              : `No accounts under “${labels[scope.filter]}”. Set who runs an account in its Account details section.`}
          </Empty>
        ) : (
          <div>
            <div className={`hidden gap-x-4 border-b border-line px-3 pb-2 text-micro font-medium text-ink-muted sm:grid ${ACCOUNT_COLS}`}>
              <div>Account</div>
              <div>Region</div>
              <div className="text-right">Open pipeline</div>
              <div className="text-right">Closing {fq.label}</div>
              <div className="text-right">Last touch</div>
            </div>
            <ul className="mt-1 space-y-0.5">
              {accounts.map((a) => (
                <li key={a.id} className={`grid gap-x-4 gap-y-1 rounded-xl px-3 py-3 transition-colors hover:bg-surface hover:shadow-card sm:items-baseline ${ACCOUNT_COLS}`}>
                  <div className="min-w-0">
                    <AccountLink id={a.id} name={a.name} />
                    {archetypeName(a.archetype_id) && <span className="ml-2 text-micro font-semibold text-ink-muted" data-testid="account-row-archetype">{archetypeName(a.archetype_id)}</span>}
                    {/* What deserves attention, first; who runs it and the
                        CRM id after, small. The id used to be the second
                        line of every row, which made every row read alike. */}
                    <SignalChips accountId={a.id} signals={sig(a.id)} only={["reason", "overdue", "review", "noNextStep"]} className="mt-1" />
                    {(a.crm_id || users.length > 1) && (
                      <div className="mt-0.5 text-micro text-ink-faint">
                        {users.length > 1 && <span>{(a.owner_user_id && users.find((u) => u.id === a.owner_user_id)?.display_name) || "Shared"}</span>}
                        {a.crm_id && users.length > 1 && <span className="mx-1.5">·</span>}
                        {a.crm_id && <span className="tabular-nums">{a.crm_id}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-label text-ink-muted">{a.region ?? "—"}</div>
                  <div className="font-semibold tabular-nums sm:text-right">
                    <span className="mr-2 text-micro font-normal text-ink-muted sm:hidden">Pipeline</span>
                    {fmtMoneyShort(a.open_pipeline_usd)}
                    <span className="ml-1 text-micro font-normal text-ink-muted">
                      / {a.open_deals} deal{a.open_deals === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="tabular-nums sm:text-right">
                    <span className="mr-2 text-micro text-ink-muted sm:hidden">Closing {fq.label}</span>
                    {a.closing_this_fq}
                  </div>
                  {/* MAX(change_log.created_at): "nobody has written anything
                      down", not "nothing has happened". Which is the right
                      thing to be nagged about. */}
                  <div className={`text-label sm:text-right ${goneQuiet(a.last_activity_at) ? "font-medium text-warning" : "text-ink-muted"}`}>
                    {relativeDays(a.last_activity_at, now.getTime())}
                    {goneQuiet(a.last_activity_at) && <span className="ml-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-micro font-medium ring-1 ring-warning-line">quiet</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div id="new-account" className="mb-5">
        <ActionForm
          action={createAccount}
          testId="account-new"
          trigger="New account"
          submitLabel="Add account"
          open={accounts.length === 0}
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

      <ArchivedBlock groups={archived} restore={restoreRecord} title="Archived accounts" />
    </Page>
  );
}
