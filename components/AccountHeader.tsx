import { localOnly } from "@/lib/localMode";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, type AccountRow } from "@/lib/db";
import { accountRevision } from "@/lib/queries/freshness";
import { FreshnessBaseline } from "./AccountFreshness";
import { ButtonLink, Eyebrow } from "./ui";
import { CurrentTabIntoView } from "./CurrentTabIntoView";
import { SignalChips } from "./Signal";
import { accountSignals } from "@/lib/queries/accountSignals";
import { listUsers } from "@/lib/auth";
import { currentPlaybook } from "@/lib/playbook/store";
import { lifecycle } from "@/lib/playbook/lifecycle";

// The top of every account view: who the account is, and the tabs.
//
// The account page was one long scroll of everything on file. It is now an
// Overview with the few things that matter at a glance, and a tab per kind of
// record — each its own route, so a tab is a link you can send, the browser's
// back button works, and the Overview does not pay for lists it does not show.
export type AccountTab = "overview" | "ask" | "deals" | "plan" | "playbook" | "people" | "meetings" | "follow-ups" | "research" | "details" | "email" | "evidence";

type Counts = { deals: number; plays: number; people: number; meetings: number; followUps: number };

function tabCounts(accountId: string): Counts {
  return db()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM deals WHERE account_id = @id AND archived_at IS NULL AND status = 'open') AS deals,
         (SELECT COUNT(*) FROM plays WHERE account_id = @id AND archived_at IS NULL) AS plays,
         (SELECT COUNT(*) FROM contacts WHERE account_id = @id AND archived_at IS NULL) AS people,
         (SELECT COUNT(*) FROM meetings WHERE account_id = @id AND archived_at IS NULL) AS meetings,
         (SELECT COUNT(*) FROM action_items WHERE account_id = @id AND archived_at IS NULL AND status = 'open') AS followUps`,
    )
    .get({ id: accountId }) as Counts;
}

// Five tabs, the records you work in every day (DECISIONS #100). Everything
// else about the account is one menu away, under More.
const MAIN_TABS: AccountTab[] = ["overview", "deals", "people", "meetings", "plan"];

export function accountTabHref(accountId: string, tab: AccountTab): string {
  const base = `/accounts/${accountId}`;
  return tab === "overview" ? base : `${base}/${tab === "plan" ? "plays" : tab}`;
}

export function AccountHeader({ account, tab, actions }: { account: AccountRow; tab: AccountTab; actions?: React.ReactNode }) {
  const id = account.id;
  // A merged account lives in the one it went into; its links land there.
  if (account.merged_into) redirect(`/accounts/${account.merged_into}`);
  if (localOnly()) {
    const localTabs: { label: string; tab: AccountTab }[] = [
      { label: "Overview", tab: "overview" },
      { label: "Evidence & MyAgent", tab: "evidence" },
      { label: "Opportunities", tab: "deals" },
      { label: "Plan", tab: "plan" },
      { label: "People", tab: "people" },
      { label: "Meetings", tab: "meetings" },
      { label: "Follow-ups", tab: "follow-ups" },
      { label: "Details", tab: "details" },
    ];
    return <div className="mb-6 space-y-3">
      <h1 className="font-display text-title font-bold"><Link href={`/accounts/${id}`}>{account.name}</Link></h1>
      <nav aria-label="Account navigation" className="flex flex-wrap gap-x-4 gap-y-1">
        {localTabs.map(item => <Link key={item.tab} href={accountTabHref(id, item.tab)} aria-current={tab === item.tab ? "page" : undefined} className={`py-2 border-b-2 ${tab === item.tab ? "border-accent font-semibold" : "border-transparent"}`}>{item.label}</Link>)}
      </nav>
    </div>;
  }
  const n = tabCounts(id);
  const all: Array<{ tab: AccountTab; label: string; count?: number }> = [
    { tab: "overview", label: "Overview" },
    { tab: "deals", label: "Deals", count: n.deals },
    { tab: "people", label: "People", count: n.people },
    { tab: "meetings", label: "Meetings", count: n.meetings },
    { tab: "plan", label: "Plan", count: n.plays },
    { tab: "follow-ups", label: "Follow-ups", count: n.followUps },
    { tab: "research", label: "Research" },
    { tab: "email", label: "Email" },
    { tab: "playbook", label: "Playbook" },
    { tab: "details", label: "Details" },
  ];
  const tabs = all.filter((t) => MAIN_TABS.includes(t.tab));
  // The playbook is part of the Plan tab now (DECISIONS #105).
  const more = all.filter((t) => !MAIN_TABS.includes(t.tab) && t.tab !== "playbook");
  // On a page reached through More, More says which one you are on.
  const inMore = tab === "playbook" ? undefined : more.find((t) => t.tab === tab);
  const meta = [account.segment, account.region, account.hq].filter(Boolean).join(" · ");
  const signals = accountSignals([id]).get(id)!;
  const playbook = currentPlaybook({ accountId: id })?.playbook ?? null;
  const archetype = account.archetype_id ? (playbook?.archetypes.find((a) => a.id === account.archetype_id)?.name ?? null) : null;
  const step = playbook ? lifecycle(id, playbook).current : null;
  // Who runs it, when the two of you have said; nobody named means shared.
  const users = listUsers();
  const owner = users.length > 1 ? (account.owner_user_id ? (users.find((u) => u.id === account.owner_user_id)?.display_name ?? null) : "Shared") : null;
  return (
    <div className="mb-4 sm:mb-6" data-testid="account-header">
      {/* Research is outside freshness on purpose (lib/freshness.ts). */}
      {tab !== "research" && <FreshnessBaseline revision={accountRevision(id)} />}
      {/* One line on a phone: the name and the menu share it, and the
          eyebrow is left to wider screens, so the work starts higher. */}
      <div className="mb-3 flex items-start justify-between gap-x-4 sm:mb-4 sm:items-end">
        <div className="min-w-0">
          <div className="hidden sm:block">
            <Eyebrow>Account</Eyebrow>
          </div>
          <h1 className="font-display text-title font-extrabold tracking-tight text-ink-strong [overflow-wrap:anywhere] sm:text-display">
            {tab === "overview" ? account.name : <Link href={`/accounts/${id}`} className="hover:text-accent">{account.name}</Link>}
          </h1>
          <p className="mt-0.5 text-label text-ink-muted sm:mt-1">
            {meta || "No segment or region on file"}
            {owner && <span data-testid="account-owner"> · {owner}</span>}
            {archetype && (
              <>
                {" · "}
                <Link href={`/accounts/${id}/playbook`} className="font-semibold text-ink hover:text-accent hover:underline" data-testid="account-archetype">
                  {archetype}
                </Link>
              </>
            )}
            {step && (
              <>
                {" · "}
                <Link href={`/accounts/${id}/playbook#lifecycle`} className="text-ink hover:text-accent hover:underline" data-testid="account-playbook-step">
                  Step {step.index + 1}: {step.step.name}
                </Link>
              </>
            )}
          </p>
          {/* What deserves attention, on every tab, each a link to its place.
              The Overview's own "Needs you" already lists the overdue and the
              next steps, so there the strip keeps to what it does not say. */}
          <SignalChips accountId={id} signals={signals} className="mt-2" only={tab === "overview" ? ["reason", "review", "quiet"] : undefined} />
        </div>
        <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
          {actions}
          <ButtonLink href={`/accounts/${id}/ask`} variant={tab === "ask" ? "primary" : "quiet"} testId="account-ask">Ask</ButtonLink>
        </div>
      </div>
      {/* Five tabs and More, at every width. The strip scrolls inside
          itself, never the page. */}
      <nav aria-label="Account" className="-mx-4 flex items-stretch border-b border-line px-4 sm:mx-0 sm:px-0" data-testid="account-tabs">
        <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const current = t.tab === tab;
            return (
              <li key={t.tab}>
                <Link
                  href={accountTabHref(id, t.tab)}
                  aria-current={current ? "page" : undefined}
                  data-testid={`account-tab-${t.tab}`}
                  className={`-mb-px inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-label font-semibold transition-colors sm:px-3 ${current ? "border-accent text-ink-strong" : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink"}`}
                >
                  {t.label}
                  {t.count !== undefined && <span className={`rounded-full px-1.5 text-micro tabular-nums ${current ? "bg-accent-soft text-ink" : "bg-surface-sunk text-ink-muted"}`}>{t.count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        {/* The rest of the account (Go to) and the things you do to it as a
            whole (Do), behind one button. */}
        <details id="account-tools" className="relative shrink-0" data-testid="account-more">
          <summary
            aria-current={inMore ? "page" : undefined}
            data-testid={inMore ? `account-tab-${inMore.tab}` : "account-more-button"}
            className={`-mb-px inline-flex min-h-11 cursor-pointer list-none items-center gap-1 whitespace-nowrap border-b-2 px-2.5 text-label font-semibold sm:px-3 [&::-webkit-details-marker]:hidden ${inMore ? "border-accent text-ink-strong" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {inMore ? inMore.label : "More"} ▾
          </summary>
          <div className="absolute right-0 z-30 mt-1 flex w-56 flex-col rounded-lg border border-line bg-surface p-1 shadow-raised">
            <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">Go to</p>
            {more.map((t) => (
              <Link
                key={t.tab}
                href={accountTabHref(id, t.tab)}
                aria-current={t.tab === tab ? "page" : undefined}
                data-testid={`account-more-${t.tab}`}
                className={`flex min-h-11 items-center justify-between rounded-md px-3 text-label hover:bg-surface-sunk sm:min-h-9 ${t.tab === tab ? "font-semibold text-ink-strong" : "text-ink"}`}
              >
                {t.label}
                {t.count !== undefined && <span className="text-micro tabular-nums text-ink-muted">{t.count}</span>}
              </Link>
            ))}
            <p className="mt-1 border-t border-line px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">Do</p>
            <Link href={`/accounts/${id}/import`} className="flex min-h-11 items-center rounded-md px-3 text-label text-ink hover:bg-surface-sunk sm:min-h-9">Import report</Link>
            {/* "One page" is live — everything on file, read together on a
                call. "Hand over" is a snapshot with an ask in it, on a link
                somebody without a login can open. */}
            <Link href={`/accounts/${id}/summary`} className="flex min-h-11 items-center rounded-md px-3 text-label text-ink hover:bg-surface-sunk sm:min-h-9">One page</Link>
            <Link href={`/accounts/${id}/handoff`} className="flex min-h-11 items-center rounded-md px-3 text-label text-ink hover:bg-surface-sunk sm:min-h-9" data-testid="handoff-link">Hand over</Link>
            <Link href={`/activity?account=${id}`} className="flex min-h-11 items-center rounded-md px-3 text-label text-ink hover:bg-surface-sunk sm:min-h-9">What changed here</Link>
          </div>
        </details>
      </nav>
      <CurrentTabIntoView />
    </div>
  );
}
